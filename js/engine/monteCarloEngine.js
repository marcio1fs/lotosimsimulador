/**
 * MonteCarloEngine - Simulação Monte Carlo para Análise de Robustez e Estabilidade de Estratégias
 * Simula milhares de sorteios sintéticos para avaliar dispersão e estabilidade de modelos.
 */

import { StatisticalAnalyzer } from './statisticalAnalyzer.js';
import { BaselineEngine } from './baselineEngine.js';

export class MonteCarloEngine {
    /**
     * Executa simulação Monte Carlo sobre um jogo candidato ou estratégia
     * @param {Array<number>} candidateGame - Jogo a ser testado
     * @param {Object} config - Configuração da loteria
     * @param {number} iterations - Quantidade de simulações (padrão: 5000)
     */
    static simulateCandidate(candidateGame, config, iterations = 2000) {
        const candidateSet = new Set(candidateGame);
        const drawnCount = config.drawn || config.pick;
        const total = config.total;
        const hitsList = [];

        for (let i = 0; i < iterations; i++) {
            // Sorteio sintético uniforme
            const syntheticDraw = new Set();
            while (syntheticDraw.size < drawnCount) {
                syntheticDraw.add(Math.floor(Math.random() * total) + 1);
            }

            let hits = 0;
            candidateGame.forEach(n => {
                if (syntheticDraw.has(n)) hits++;
            });
            hitsList.push(hits);
        }

        const stats = StatisticalAnalyzer.calculateDistributionStats(hitsList);

        return {
            iterations,
            meanHits: stats.mean,
            medianHits: stats.median,
            stdDev: stats.stdDev,
            maxHits: stats.max,
            minHits: stats.min,
            distribution: stats.distribution,
            disclaimer: 'Simulação Monte Carlo avalia a estabilidade estatística teórica do jogo frente a sorteios sintéticos.'
        };
    }
}
