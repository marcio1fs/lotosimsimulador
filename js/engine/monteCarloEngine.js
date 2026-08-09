/**
 * MonteCarloEngine - Simulação Monte Carlo para Análise de Robustez e Estabilidade de Estratégias
 * Simula milhares de sorteios sintéticos para avaliar dispersão e estabilidade de modelos.
 */

import { StatisticalAnalyzer } from './statisticalAnalyzer.js';
import { SeededRandom } from './prng.js';

export class MonteCarloEngine {
    /**
     * Executa simulação Monte Carlo sobre um jogo candidato ou estratégia
     * @param {Array<number>} candidateGame - Jogo a ser testado
     * @param {Object} config - Configuração da loteria
     * @param {number} iterations - Quantidade de simulações (padrão: 5000)
     * @param {Object} options - mode: 'synthetic'|'bootstrap', history: array, seed: number
     */
    /**
     * Executa simulação Monte Carlo sobre um jogo candidato ou estratégia
     * @param {Array<number>} candidateGame - Jogo a ser testado
     * @param {Object} config - Configuração da loteria
     * @param {number} iterations - Quantidade de simulações (padrão: 10000)
     * @param {Object} options - mode: 'synthetic'|'bootstrap', history: array, seed: number
     */
    static simulateCandidate(candidateGame, config, iterations = 10000, options = {}) {
        const candidateSet = new Set(candidateGame);
        const drawnCount = config.drawn || config.pick;
        const total = config.total;
        const hitsList = [];
        const seed = options.seed ?? 123456;
        const prng = new SeededRandom(seed);
        const mode = options.mode || 'synthetic';
        
        // Histórico passado estritamente (sem concursos futuros)
        const history = options.history || [];

        for (let i = 0; i < iterations; i++) {
            let syntheticDraw = new Set();
            
            if (mode === 'bootstrap' && history.length > 0) {
                // Amostragem cega com reposição do histórico passado
                const randIndex = prng.nextInt(0, history.length - 1);
                const draw = history[randIndex];
                const nums = draw.dezenas ? draw.dezenas.map(Number) : [];
                syntheticDraw = new Set(nums);
            } else {
                // Sorteio sintético uniforme determinístico via PRNG
                while (syntheticDraw.size < drawnCount) {
                    syntheticDraw.add(prng.nextInt(1, total));
                }
            }

            let hits = 0;
            candidateGame.forEach(n => {
                if (syntheticDraw.has(n)) hits++;
            });
            hitsList.push(hits);
        }

        const stats = StatisticalAnalyzer.calculateDistributionStats(hitsList);
        
        // P(hits >= K)
        const cumulativeProbabilities = {};
        let cumulativeCount = iterations;
        for (let k = 0; k <= drawnCount; k++) {
            cumulativeProbabilities[k] = Number((cumulativeCount / iterations).toFixed(6));
            cumulativeCount -= (stats.distribution[k] || 0);
        }
        
        // Stability Score (0 a 100): combina menor coeficiente de variação com consistência em relação ao esperado
        const expectedMean = (config.pick * drawnCount) / total;
        const cv = stats.mean > 0 ? (stats.stdDev / stats.mean) : 1;
        const relativeDev = Math.abs(stats.mean - expectedMean) / (expectedMean || 1);
        const rawStability = 100 - (cv * 40 + relativeDev * 60);
        const stabilityScore = Number(Math.max(0, Math.min(100, rawStability)).toFixed(2));

        return {
            iterations,
            seed,
            meanHits: stats.mean,
            stdDev: stats.stdDev,
            variance: stats.variance,
            stabilityScore,
            empiricalDistribution: stats.distribution,
            cumulativeProbabilities,
            disclaimer: 'Simulação Monte Carlo avalia a estabilidade estatística.'
        };
    }

    /**
     * Calcula o Coverage Score (0-100) para um portfólio de jogos gerados
     * Avalia quantidade de jogos, dezenas únicas, ocupação do volante e desvio de concentração.
     */
    static calculateCoverageScore(games, config) {
        if (!games || !Array.isArray(games) || games.length === 0) return 0;
        const total = config?.total || 25;
        const pick = config?.pick || 15;
        const totalPositions = games.length * pick;

        const uniqueNumbers = new Set();
        const numberCounts = {};

        games.forEach(g => {
            const nums = Array.isArray(g) ? g : (g.numbers || []);
            nums.forEach(n => {
                const num = Number(n);
                if (Number.isFinite(num)) {
                    uniqueNumbers.add(num);
                    numberCounts[num] = (numberCounts[num] || 0) + 1;
                }
            });
        });

        if (uniqueNumbers.size === 0) return 0;

        // Proporção de dezenas do volante cobertas
        const totalCoverageRatio = uniqueNumbers.size / total;
        // Proporção de dezenas únicas em relação à capacidade máxima do lote
        const maxPossibleUnique = Math.min(total, totalPositions);
        const positionCoverageRatio = uniqueNumbers.size / maxPossibleUnique;

        // Penalidade por hiper-concentração de frequência entre as dezenas escolhidas
        const counts = Object.values(numberCounts);
        const meanCount = counts.reduce((a, b) => a + b, 0) / counts.length;
        const variance = counts.reduce((s, c) => s + Math.pow(c - meanCount, 2), 0) / counts.length;
        const stdDev = Math.sqrt(variance);
        const concentrationPenalty = meanCount > 0 ? (stdDev / meanCount) : 0;

        // Score ponderado determinístico de 0 a 100
        const rawCoverage = (totalCoverageRatio * 60 + positionCoverageRatio * 40) * Math.max(0.4, 1 - concentrationPenalty * 0.3);
        const coverageScore = Number(Math.max(0, Math.min(100, rawCoverage)).toFixed(1));
        return Number.isFinite(coverageScore) ? coverageScore : 0;
    }

    /**
     * Alias para compatibilidade
     */
    static calculatePortfolioCoverage(games, config) {
        return this.calculateCoverageScore(games, config);
    }

    /**
     * Calcula o Diversification Score (0-100) para um portfólio de jogos
     * Baseia-se no complemento da distância média de Jaccard entre todos os pares do lote.
     */
    static calculateDiversificationScore(games, config) {
        if (!games || !Array.isArray(games) || games.length <= 1) return 100;

        let totalSimilarity = 0;
        let pairCount = 0;

        for (let i = 0; i < games.length; i++) {
            const gameA = Array.isArray(games[i]) ? games[i] : (games[i].numbers || []);
            const setA = new Set(gameA.map(Number));

            for (let j = i + 1; j < games.length; j++) {
                const gameB = Array.isArray(games[j]) ? games[j] : (games[j].numbers || []);
                const setB = new Set(gameB.map(Number));

                let intersection = 0;
                setA.forEach(n => { if (setB.has(n)) intersection++; });
                const union = new Set([...gameA.map(Number), ...gameB.map(Number)]).size;
                const similarity = union > 0 ? intersection / union : 0;

                totalSimilarity += similarity;
                pairCount++;
            }
        }

        if (pairCount === 0) return 100;

        const avgSimilarity = totalSimilarity / pairCount;
        // Quanto menor a similaridade média entre os pares, maior a diversificação (0-100)
        const divScore = Number(((1 - avgSimilarity) * 100).toFixed(1));
        return Number.isFinite(divScore) ? Math.max(0, Math.min(100, divScore)) : 100;
    }
}

