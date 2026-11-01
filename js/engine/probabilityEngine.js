/**
 * ProbabilityEngine
 *
 * Calculates the theoretical hit distribution without simulation, as well as
 * Portfolio-Level Cumulative Odds, Gaussian Space Reduction Odds, Multi-Tier Prize Probabilities,
 * and Official Caixa Financial Cost / Expected Return (Bankroll & Bolão Management).
 */
import { GaussianFilterEngine } from './gaussianFilterEngine.js';

export const OFFICIAL_TICKET_PRICES = {
    25: 3.50,  // Lotofácil (R$ 3,50 aposta simples de 15 dezenas)
    60: 6.00,  // Mega-Sena (R$ 6,00 aposta simples de 6 dezenas)
    80: 3.00,  // Quina (R$ 3,00 aposta simples de 5 dezenas)
    100: 3.00  // Lotomania (R$ 3,00 aposta única de 50 dezenas)
};

export const ESTIMATED_PRIZE_PAYOUTS = {
    25: { 11: 7.00, 12: 14.00, 13: 35.00, 14: 1850.00, 15: 1700000.00 },
    60: { 4: 1150.00, 5: 52000.00, 6: 35000000.00 },
    80: { 2: 4.50, 3: 140.00, 4: 8500.00, 5: 5000000.00 },
    100: { 15: 9.00, 16: 45.00, 17: 320.00, 18: 2800.00, 19: 65000.00, 20: 4500000.00 }
};

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
     * Calcula o custo financeiro oficial da carteira, divisão de cotas de Bolão e simulação de Teimosinha
     */
    static calculateFinancialSummary(config, ticketCount = 10, bolaoShares = 5) {
        const total = Number(config?.total);
        const unitPrice = OFFICIAL_TICKET_PRICES[total] || 3.50;
        const tickets = Math.max(1, Number(ticketCount) || 1);
        const totalInvestment = Number((unitPrice * tickets).toFixed(2));
        const shares = Math.max(1, Number(bolaoShares) || 5);
        const costPerShare = Number((totalInvestment / shares).toFixed(2));

        const formatBRL = (val) => val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

        return {
            unitPrice,
            unitPriceFormatted: formatBRL(unitPrice),
            ticketCount: tickets,
            totalInvestment,
            totalInvestmentFormatted: formatBRL(totalInvestment),
            bolaoShares: shares,
            costPerShare,
            costPerShareFormatted: formatBRL(costPerShare),
            teimosinha3DrawsFormatted: formatBRL(totalInvestment * 3),
            teimosinha6DrawsFormatted: formatBRL(totalInvestment * 6)
        };
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
     * Calcula a Projeção Combinatória e Financeira da Carteira Completa
     */
    static calculatePortfolioProjection(config, ticketCount = 10, selectedCount = config?.pick, diversificationScore = 75) {
        const single = this.hypergeometric(config, selectedCount);
        const spaceReduction = GaussianFilterEngine.estimateSpaceReduction(config);
        const prizeTiers = this.getPrizeTiers(config);
        const minPrizeTier = prizeTiers[0];
        const financial = this.calculateFinancialSummary(config, ticketCount);

        const tickets = Math.max(1, Number(ticketCount) || 1);
        const rawSingleProb = single.fullHitProbability || 0;

        // Sena: eventos mutuamente exclusivos entre bilhetes distintos ⟹ valor EXATO.
        const portfolioFullHitProb = Math.min(1, rawSingleProb * tickets);

        // CORREÇÃO DE INTEGRIDADE (auditoria v1.2)
        // Antes: `tickets / espacoPodado` e um "fator de ortogonalidade" inventado
        // (0.65 + 0.35·diversificação) eram aplicados aqui, produzindo frases como
        // "Ganho de Eficiência Combinatória: 5x". Isso é falso: descartar combinações
        // consideradas improváveis NÃO altera a probabilidade de nenhuma combinação
        // específica — o sorteio não sabe quais combinações o app descartou.
        // O que a poda faz é reduzir o espaço PESQUISADO na geração (custo), não a chance.
        const spaceReductionInfo = {
            prunedPercentage: spaceReduction.prunedPercentage,
            retentionRatio: spaceReduction.retentionRatio,
            searchSpaceReduction: `${spaceReduction.prunedPercentage}% de combinações deixaram de ser geradas`,
            oddsImpact: 'Nenhum. A poda reduz o espaço pesquisado, não aumenta a probabilidade de acerto.'
        };

        const singleAnyPrizeProb = single.cumulativeProbabilities[minPrizeTier] || 0;
        // Limite superior rigoroso (desigualdade da união): P(∪Aᵢ) ≤ ΣP(Aᵢ).
        // Sem os bilhetes reais não é possível o limite inferior de Bonferroni;
        // `FutureProjectionEngine.portfolioCoverage` calcula-o quando recebe os jogos.
        const portfolioAnyPrizeProb = Math.min(1, tickets * singleAnyPrizeProb);
        const portfolioAnyPrizeLower = null;

        const tierProbabilities = {};
        prizeTiers.forEach(tier => {
            const pSingle = single.cumulativeProbabilities[tier] || 0;
            const isTopTier = tier === single.maxHits;
            const pPortfolio = isTopTier
                ? portfolioFullHitProb
                : Math.min(1, tickets * pSingle);
            tierProbabilities[tier] = {
                singleProbability: pSingle,
                singleOdds: this.probabilityToOdds(pSingle),
                portfolioProbability: pPortfolio,
                portfolioOdds: this.probabilityToOdds(pPortfolio),
                portfolioPercentage: `${(pPortfolio * 100).toFixed(pPortfolio > 0.01 ? 2 : 4)}%`,
                exact: isTopTier,
                method: isTopTier ? 'exato (mutuamente exclusivos)' : 'limite superior (união)'
            };
        });

        return {
            ticketCount: tickets,
            rawSingleOdds: single.fullHitOdds,
            portfolioDirectOdds: this.probabilityToOdds(portfolioFullHitProb),
            portfolioDirectProbability: portfolioFullHitProb,
            // Campos mantidos por compatibilidade, agora com o valor HONESTO:
            // a poda não altera as odds, então o "núcleo gaussiano" tem exatamente
            // a mesma probabilidade da carteira direta.
            gaussianCorePortfolioOdds: this.probabilityToOdds(portfolioFullHitProb),
            gaussianCoreOddsAreUnchanged: true,
            spacePrunedPercentage: `${spaceReduction.prunedPercentage}%`,
            spaceReduction: spaceReductionInfo,
            // Nome antigo preservado, com semântica corrigida (redução do espaço pesquisado).
            totalFactorGain: `${Number((1 / Math.max(1e-9, spaceReduction.retentionRatio)).toFixed(1))}x menos combinações geradas`,
            minPrizeTier,
            anyPrizePortfolioProbability: Number((portfolioAnyPrizeProb * 100).toFixed(4)),
            anyPrizePortfolioOdds: this.probabilityToOdds(portfolioAnyPrizeProb),
            anyPrizePortfolioLowerBound: portfolioAnyPrizeLower,
            anyPrizePortfolioMethod: 'Limite superior (desigualdade da união). Use FutureProjectionEngine.portfolioCoverage com os bilhetes reais para limites de Bonferroni.',
            tierProbabilities,
            financial
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
