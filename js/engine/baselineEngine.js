/**
 * BaselineEngine - Gerador e Avaliador de Referência Aleatória (Baseline)
 * Permite comparar se qualquer modelo ou estratégia realmente supera a escolha aleatória.
 */

import { StatisticalAnalyzer } from './statisticalAnalyzer.js';
import { SeededRandom } from './prng.js';

export class BaselineEngine {
    /**
     * Gera um jogo estritamente aleatório sem viés estatístico
     * @param {Object} config - Configuração da loteria
     */
    static generateRandomGame(config, prng = null) {
        const total = config.total;
        const pick = config.pick;
        const numbers = new Set();
        const rand = prng || new SeededRandom();

        while (numbers.size < pick) {
            const num = rand.nextInt(1, total);
            numbers.add(num);
        }

        return [...numbers].sort((a, b) => a - b);
    }

    /**
     * Executa simulação aleatória sobre o histórico de concursos
     * @param {Array} fullHistory - Histórico de concursos
     * @param {Object} config - Configuração da loteria
     * @param {number} windowSize - Quantidade de concursos testados
     * @param {number} simulationsPerDraw - Quantas escolhas aleatórias por concurso para estabilizar a média
     */
    static runRandomBaseline(fullHistory, config, windowSize = 50, simulationsPerDraw = 30, seed = null) {
        if (!fullHistory || fullHistory.length === 0) {
            return { mean: 0, median: 0, stdDev: 0, min: 0, max: 0 };
        }

        const sample = fullHistory.slice(0, Math.min(windowSize, fullHistory.length));
        const hitsList = [];

        const prng = new SeededRandom(seed);
        
        sample.forEach(draw => {
            const actual = new Set(Array.isArray(draw.dezenas) ? draw.dezenas.map(Number) : []);

            for (let s = 0; s < simulationsPerDraw; s++) {
                const randomGame = this.generateRandomGame(config, prng);
                let hits = 0;
                randomGame.forEach(n => {
                    if (actual.has(n)) hits++;
                });
                hitsList.push(hits);
            }
        });

        const stats = StatisticalAnalyzer.calculateDistributionStats(hitsList);
        const drawn = config.drawn || config.pick;
        stats.theoreticalExpected = Number(((config.pick * drawn) / config.total).toFixed(4));
        
        return stats;
    }
}
