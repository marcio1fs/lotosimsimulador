/**
 * ProbabilityEngine
 *
 * Calculates the theoretical hit distribution without simulation, as well as
 * Portfolio-Level Cumulative Odds, Gaussian Space Reduction Odds, and Multi-Tier Prize Probabilities.
 */
import { GaussianFilterEngine } from './gaussianFilterEngine.js';

export class ProbabilityEngine {
    static combinationCount(total, choose) {
        if (!Number.isInteger(total) || !Number.isInteger(choose) || choose < 0 || choose > total) return 0n;

        const k = Math.min(choose, total - choose);
        let result = 1n;
        for (let i = 1; i <= k; i++) {
            result = (result * BigInt(total - k + i)) / BigInt(i);
        }
        return result;
    }

    static probabilityToOdds(probability) {
        if (!Number.isFinite(probability) || probability <= 0) return 'n/a';
        if (probability >= 1) return '1 em 1';
        return `1 em ${Math.round(1 / probability).toLocaleString('pt-BR')}`;
    }

    /**
     * Retorna as faixas oficiais de premiação da modalidade
     */
    static getPrizeTiers(config) {
        const total = Number(config?.total);
        if (total === 25) return [11, 12, 13, 14, 15]; // Lotofácil
        if (total === 60) return [4, 5, 6];            // Mega-Sena (Quadra, Quina, Sena)
        if (total === 80) return [2, 3, 4, 5];         // Quina (Duque, Terno, Quadra, Quina)
        if (total === 100) return [15, 16, 17, 18, 19, 20]; // Lotomania
        const drawn = Number(config?.drawn ?? config?.pick);
        return [Math.max(1, drawn - 2), Math.max(1, drawn - 1), drawn];
    }

    /**
     * Returns P(H = k), P(H >= k), mean, standard deviation, and a central
     * 95% predictive interval for the next fair draw.
     */
    static hypergeometric(config, selectedCount = config?.pick) {
        const total = Number(config?.total);
        const drawn = Number(config?.drawn ?? config?.pick);
        const selected = Number(selectedCount);

        if (![total, drawn, selected].every(Number.isInteger) || total <= 0 || drawn < 0 || selected < 0 || drawn > total || selected > total) {
            return this.emptyResult();
        }

        const denominator = this.combinationCount(total, drawn);
        const minHits = Math.max(0, drawn - (total - selected));
        const maxHits = Math.min(selected, drawn);
        const distribution = {};
        const cumulativeProbabilities = {};

        for (let hits = minHits; hits <= maxHits; hits++) {
            const numerator = this.combinationCount(selected, hits) * this.combinationCount(total - selected, drawn - hits);
            distribution[hits] = Number(numerator) / Number(denominator);
        }

        let cumulative = 0;
        for (let hits = maxHits; hits >= minHits; hits--) {
            cumulative += distribution[hits] || 0;
            cumulativeProbabilities[hits] = cumulative;
        }
        for (let hits = 0; hits < minHits; hits++) cumulativeProbabilities[hits] = 1;
        for (let hits = maxHits + 1; hits <= drawn; hits++) cumulativeProbabilities[hits] = 0;

        const mean = (selected * drawn) / total;
        const variance = total > 1
            ? drawn * (selected / total) * (1 - (selected / total)) * ((total - drawn) / (total - 1))
            : 0;
        const predictionInterval = {
            confidenceLevel: 0.95,
            lower: this.quantile(distribution, minHits, maxHits, 0.025),
            upper: this.quantile(distribution, minHits, maxHits, 0.975)
        };
        const fullHitProbability = distribution[maxHits] || 0;

        return {
            method: 'Hipergeometrica exata',
            selectedCount: selected,
            drawnCount: drawn,
            minHits,
            maxHits,
            expectedHits: Number(mean.toFixed(6)),
            variance: Number(variance.toFixed(6)),
            stdDev: Number(Math.sqrt(variance).toFixed(6)),
            distribution,
            cumulativeProbabilities,
            predictionInterval,
            fullHitProbability,
            fullHitOdds: this.probabilityToOdds(fullHitProbability)
        };
    }

    /**
     * Calcula a Projeção Combinatória da Carteira Completa (Portfólio de Jogos + Poda Gaussiana + Fechamento)
     * Demonstra matematicamente:
     * 1. Chance Bruta de 1 Bilhete
     * 2. Chance Acumulada da Carteira (N bilhetes únicos ortogonais)
     * 3. Chance Efetiva no Espaço Amostral Podado (após eliminação das caudas gaussianas mortas)
     * 4. Probabilidade de Premiação em Qualquer Faixa (ex: Quadra/Quina/Sena ou 11..15 pontos)
     */
    static calculatePortfolioProjection(config, ticketCount = 10, selectedCount = config?.pick, diversificationScore = 75) {
        const single = this.hypergeometric(config, selectedCount);
        const spaceReduction = GaussianFilterEngine.estimateSpaceReduction(config);
        const prizeTiers = this.getPrizeTiers(config);
        const minPrizeTier = prizeTiers[0];

        const tickets = Math.max(1, Number(ticketCount) || 1);
        const rawSingleProb = single.fullHitProbability || 0;

        // Jogos distintos para o prêmio máximo são eventos mutuamente exclusivos (só 1 combinação é sorteada)
        // Logo, para N jogos distintos, P(Acerto Máximo na Carteira) = N * P(1 jogo)
        const portfolioFullHitProb = Math.min(1, rawSingleProb * tickets);

        // No espaço amostral filtrado (condicionado a o sorteio cair dentro do núcleo central Gaussiano ~85% dos casos):
        const effectiveFilteredSpaceCombinations = Math.max(1, Math.round((1 / (rawSingleProb || 1)) * spaceReduction.retentionRatio));
        const effectivePortfolioProbInGaussianCore = Math.min(1, tickets / effectiveFilteredSpaceCombinations);

        // Probabilidade de acertar ao menos a faixa mínima de prêmio (ex: >= 11 na Lotofácil, >= 4 na Mega, >= 2 na Quina)
        const singleAnyPrizeProb = single.cumulativeProbabilities[minPrizeTier] || 0;
        // Fator de ortogonalidade (diversificação por distância de Hamming aumenta cobertura sem sobreposição)
        const orthogonalityFactor = 0.65 + 0.35 * (Math.min(100, Math.max(0, diversificationScore || 75)) / 100);
        const portfolioAnyPrizeProb = 1 - Math.pow(Math.max(0, 1 - singleAnyPrizeProb), tickets * orthogonalityFactor);

        // Detalhamento por faixa de prêmio na carteira
        const tierProbabilities = {};
        prizeTiers.forEach(tier => {
            const pSingle = single.cumulativeProbabilities[tier] || 0;
            const pPortfolio = tier === single.maxHits
                ? portfolioFullHitProb
                : (1 - Math.pow(Math.max(0, 1 - pSingle), tickets * orthogonalityFactor));
            tierProbabilities[tier] = {
                singleProbability: pSingle,
                singleOdds: this.probabilityToOdds(pSingle),
                portfolioProbability: pPortfolio,
                portfolioOdds: this.probabilityToOdds(pPortfolio),
                portfolioPercentage: `${(pPortfolio * 100).toFixed(pPortfolio > 0.01 ? 2 : 4)}%`
            };
        });

        const totalFactorGain = Number((tickets * spaceReduction.precisionMultiplier).toFixed(1));

        return {
            ticketCount: tickets,
            rawSingleOdds: single.fullHitOdds,
            portfolioDirectOdds: this.probabilityToOdds(portfolioFullHitProb),
            gaussianCoreSpaceSize: effectiveFilteredSpaceCombinations.toLocaleString('pt-BR'),
            gaussianCorePortfolioOdds: this.probabilityToOdds(effectivePortfolioProbInGaussianCore),
            spacePrunedPercentage: `${spaceReduction.prunedPercentage}%`,
            spacePrecisionMultiplier: `${spaceReduction.precisionMultiplier}x`,
            totalFactorGain: `${totalFactorGain}x`,
            minPrizeTier,
            anyPrizePortfolioProbability: Number((portfolioAnyPrizeProb * 100).toFixed(2)),
            anyPrizePortfolioOdds: this.probabilityToOdds(portfolioAnyPrizeProb),
            tierProbabilities
        };
    }

    static quantile(distribution, minHits, maxHits, threshold) {
        let cumulative = 0;
        for (let hits = minHits; hits <= maxHits; hits++) {
            cumulative += distribution[hits] || 0;
            if (cumulative >= threshold) return hits;
        }
        return maxHits;
    }

    static emptyResult() {
        return {
            method: 'Hipergeometrica exata', selectedCount: 0, drawnCount: 0, minHits: 0, maxHits: 0,
            expectedHits: 0, variance: 0, stdDev: 0, distribution: {}, cumulativeProbabilities: {},
            predictionInterval: { confidenceLevel: 0.95, lower: 0, upper: 0 }, fullHitProbability: 0, fullHitOdds: 'n/a'
        };
    }
}
