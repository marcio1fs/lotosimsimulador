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
     * Avalia diversificação, amplitude e ausência de hiper-concentração.
     */
    static calculatePortfolioCoverage(games, config) {
        if (!games || games.length === 0) return 0;
        const total = config.total;
        const uniqueNumbers = new Set();
        const numberCounts = {};

        games.forEach(g => {
            const nums = g.numbers || g;
            nums.forEach(n => {
                uniqueNumbers.add(n);
                numberCounts[n] = (numberCounts[n] || 0) + 1;
            });
        });

        const uniqueRatio = uniqueNumbers.size / total;
        // Fator de uniformidade (desvio padrão das frequências no portfólio)
        const counts = Object.values(numberCounts);
        const meanCount = counts.reduce((a, b) => a + b, 0) / (uniqueNumbers.size || 1);
        const countVar = counts.reduce((s, c) => s + Math.pow(c - meanCount, 2), 0) / (counts.length || 1);
        const uniformityPenalty = Math.sqrt(countVar) / (games.length || 1);

        const coverageScore = Number(Math.max(0, Math.min(100, (uniqueRatio * 100) - (uniformityPenalty * 20))).toFixed(1));
        return coverageScore;
    }
}

