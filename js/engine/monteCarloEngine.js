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
    static simulateCandidate(candidateGame, config, iterations = 5000, options = {}) {
        const candidateSet = new Set(candidateGame);
        const drawnCount = config.drawn || config.pick;
        const total = config.total;
        const hitsList = [];
        const seed = options.seed ?? Date.now();
        const prng = new SeededRandom(seed);
        const mode = options.mode || 'synthetic';
        
        const history = options.history || [];

        for (let i = 0; i < iterations; i++) {
            let syntheticDraw = new Set();
            
            if (mode === 'bootstrap' && history.length > 0) {
                // Amostragem com reposição do histórico
                const randIndex = prng.nextInt(0, history.length - 1);
                const draw = history[randIndex];
                const nums = draw.dezenas ? draw.dezenas.map(Number) : [];
                syntheticDraw = new Set(nums);
            } else {
                // Sorteio sintético uniforme
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
        
        // Stability Score
        const expectedMean = (config.pick * drawnCount) / total;
        const expectedStdDev = Math.sqrt(iterations * (config.pick/total) * (1 - config.pick/total) * ((total - drawnCount)/(total - 1))) / Math.sqrt(iterations); // roughly
        // We use empirical coefficient of variation or just how close mean is to theoretical for stability
        const relativeError = Math.abs(stats.mean - expectedMean) / expectedMean;
        const stabilityScore = Math.max(0, Math.min(100, 100 - (relativeError * 100)));

        return {
            iterations,
            seed,
            meanHits: stats.mean,
            stdDev: stats.stdDev,
            stabilityScore: Number(stabilityScore.toFixed(2)),
            empiricalDistribution: stats.distribution,
            cumulativeProbabilities,
            disclaimer: 'Simulação Monte Carlo avalia a estabilidade estatística.'
        };
    }
}
