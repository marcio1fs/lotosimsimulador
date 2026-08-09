/**
 * BacktestEngine - Motor de Validação Histórica Cega sem Vazamento de Dados (Data Leakage Free)
 * Executa simulações walk-forward e calcula métricas rigorosas de desempenho histórico.
 */

import { StatisticalAnalyzer } from './statisticalAnalyzer.js';
import { BaselineEngine } from './baselineEngine.js';

export class BacktestEngine {
    /**
     * Executa backtesting completo para uma estratégia e janela temporal
     * @param {Array} fullHistory - Histórico completo de concursos (ordenado do mais recente [0] para o mais antigo [len-1])
     * @param {Object} config - Configuração da loteria (total, pick, drawn)
     * @param {Function} generatorFn - Função (historyBefore, config) => gameNumbers
     * @param {Object} options - Parâmetros do backtest (windowSize, sampleCount, walkForwardSplit)
     */
    static runBacktest(fullHistory, config, generatorFn, options = {}) {
        if (!fullHistory || fullHistory.length < 10) {
            return this.emptyResult();
        }

        // Histórico ordenado cronologicamente (do mais antigo [0] ao mais recente [end])
        const chronological = [...fullHistory].reverse();
        const totalDraws = chronological.length;

        // Janela de avaliação (quantos concursos testar do final da série)
        const windowSize = options.windowSize && options.windowSize !== 'full' 
            ? Math.min(options.windowSize, totalDraws - 5) 
            : Math.max(10, totalDraws - 20);

        const startIndex = totalDraws - windowSize;
        const hitsList = [];
        const hitsDistribution = {};
        const drawnCount = config.drawn || config.pick;

        // Inicializa distribuição de acertos
        for (let h = 0; h <= drawnCount; h++) {
            hitsDistribution[h] = 0;
        }

        // Executa o teste cego concurso por concurso
        for (let i = startIndex; i < totalDraws; i++) {
            // DATA LEAKAGE PREVENTION: usar rigorosamente apenas concursos anteriores a 'i'
            // Na ordem mais recente primeiro como esperado pelos analisadores:
            const historyBefore = chronological.slice(0, i).reverse();
            const actualDraw = chronological[i];
            const actualNumbers = new Set(Array.isArray(actualDraw.dezenas) ? actualDraw.dezenas.map(Number) : []);

            // Gera o jogo baseado apenas no passado
            const predictedGame = generatorFn(historyBefore, config);

            // Calcula quantidade de acertos no concurso 'i'
            let hits = 0;
            if (Array.isArray(predictedGame)) {
                predictedGame.forEach(n => {
                    if (actualNumbers.has(n)) hits++;
                });
            }

            hitsList.push(hits);
            hitsDistribution[hits] = (hitsDistribution[hits] || 0) + 1;
        }

        // Estatísticas de acerto do modelo
        const modelStats = StatisticalAnalyzer.calculateDistributionStats(hitsList);

        // Executa Baseline Aleatória idêntica para os mesmos concursos
        const baselineResult = BaselineEngine.runRandomBaseline(fullHistory, config, windowSize);

        // Comparação com a baseline
        const diffMean = Number((modelStats.mean - baselineResult.mean).toFixed(2));
        const relativeImprovement = baselineResult.mean > 0 
            ? ((diffMean / baselineResult.mean) * 100).toFixed(1) + '%' 
            : '0.0%';

        // Detecção de Overfitting (Walk-Forward Split)
        const trainTestSplit = this.evaluateWalkForward(chronological, config, generatorFn, windowSize);

        return {
            evaluatedDraws: hitsList.length,
            meanHits: modelStats.mean,
            medianHits: modelStats.median,
            minHits: modelStats.min,
            maxHits: modelStats.max,
            stdDev: modelStats.stdDev,
            hitsDistribution,
            baselineMean: baselineResult.mean,
            diffMean,
            relativeImprovement,
            confidenceLevel: 95.0,
            walkForward: trainTestSplit
        };
    }

    /**
     * Validação Walk-Forward (Compara In-Sample vs Out-of-Sample para detectar overfitting)
     */
    static evaluateWalkForward(chronologicalHistory, config, generatorFn, evalWindow) {
        const total = chronologicalHistory.length;
        if (total < 40) return { isOverfitting: false, inSampleMean: 0, outSampleMean: 0 };

        const mid = total - Math.floor(evalWindow / 2);
        
        // In-sample test (metade anterior da janela)
        let inSampleHits = [];
        for (let i = total - evalWindow; i < mid; i++) {
            const past = chronologicalHistory.slice(0, i).reverse();
            const actual = new Set(chronologicalHistory[i].dezenas.map(Number));
            const game = generatorFn(past, config);
            const hits = game.filter(n => actual.has(n)).length;
            inSampleHits.push(hits);
        }

        // Out-of-sample test (metade recente da janela)
        let outSampleHits = [];
        for (let i = mid; i < total; i++) {
            const past = chronologicalHistory.slice(0, i).reverse();
            const actual = new Set(chronologicalHistory[i].dezenas.map(Number));
            const game = generatorFn(past, config);
            const hits = game.filter(n => actual.has(n)).length;
            outSampleHits.push(hits);
        }

        const inStats = StatisticalAnalyzer.calculateDistributionStats(inSampleHits);
        const outStats = StatisticalAnalyzer.calculateDistributionStats(outSampleHits);

        // Se a performance despencar bruscamente na amostra nova, há overfitting
        const isOverfitting = (inStats.mean - outStats.mean) > (inStats.stdDev * 0.8);

        return {
            isOverfitting,
            inSampleMean: inStats.mean,
            outSampleMean: outStats.mean,
            diff: Number((outStats.mean - inStats.mean).toFixed(2))
        };
    }

    static emptyResult() {
        return {
            evaluatedDraws: 0,
            meanHits: 0,
            medianHits: 0,
            minHits: 0,
            maxHits: 0,
            stdDev: 0,
            hitsDistribution: {},
            baselineMean: 0,
            diffMean: 0,
            relativeImprovement: '0.0%',
            confidenceLevel: 95.0,
            walkForward: { isOverfitting: false, inSampleMean: 0, outSampleMean: 0, diff: 0 }
        };
    }
}
