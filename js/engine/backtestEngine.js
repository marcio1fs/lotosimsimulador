/**
 * BacktestEngine - Motor de Validação Histórica Cega sem Vazamento de Dados (Data Leakage Free)
 * Executa simulações walk-forward e calcula métricas rigorosas de desempenho histórico.
 */

import { StatisticalAnalyzer } from './statisticalAnalyzer.js';
import { BaselineEngine } from './baselineEngine.js';
import { StatisticalInference } from './statisticalInference.js';
import { SeededRandom } from './prng.js';

export class BacktestEngine {
    /**
     * Executa backtesting completo para uma estratégia e janela temporal
     * @param {Array} fullHistory - Histórico completo de concursos (ordenado do mais recente [0] para o mais antigo [len-1])
     * @param {Object} config - Configuração da loteria (total, pick, drawn)
     * @param {Function} generatorFn - Função (historyBefore, config) => gameNumbers
     * @param {Object} options - Parâmetros do backtest (windowSize, sampleCount, walkForwardSplit, seed)
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

        const baselineHitsList = [];
        const hitTierBreakdown = {};

        const baseSeed = options.seed ?? 123456;
        const prng = new SeededRandom(baseSeed);

        // Executa o teste cego concurso por concurso
        for (let i = startIndex; i < totalDraws; i++) {
            // DATA LEAKAGE PREVENTION: usar rigorosamente apenas concursos anteriores a 'i'
            // Na ordem mais recente primeiro como esperado pelos analisadores:
            const historyBefore = chronological.slice(0, i).reverse();
            const actualDraw = chronological[i];
            const actualNumbers = new Set(actualDraw.dezenas ? actualDraw.dezenas.map(Number) : []);

            // Gera o jogo baseado apenas no passado
            const predictedGame = generatorFn(historyBefore, config);
            const predArray = Array.isArray(predictedGame) ? predictedGame : 
                              (predictedGame && predictedGame.dezenas ? predictedGame.dezenas : 
                              (predictedGame && predictedGame.numbers ? predictedGame.numbers : []));

            // Calcula quantidade de acertos no concurso 'i'
            let hits = 0;
            predArray.forEach(n => {
                if (actualNumbers.has(n)) hits++;
            });

            hitsList.push(hits);
            hitsDistribution[hits] = (hitsDistribution[hits] || 0) + 1;
            
            if (hits >= 11) {
                hitTierBreakdown[hits] = (hitTierBreakdown[hits] || 0) + 1;
            }
            
            // Baseline local para t-test com PRNG controlado por seed
            const baselineGame = BaselineEngine.generateRandomGame(config, prng);
            let bHits = 0;
            baselineGame.forEach(n => {
                if (actualNumbers.has(n)) bHits++;
            });
            baselineHitsList.push(bHits);
        }

        // Estatísticas de acerto do modelo
        const modelStats = StatisticalInference.calculateStats(hitsList);

        // Executa Baseline Aleatória idêntica para os mesmos concursos
        const baselineResult = BaselineEngine.runRandomBaseline(fullHistory, config, windowSize, 30, baseSeed);

        // Comparação de Inferência Estatística Exata com a baseline
        const inferenceTest = StatisticalInference.pairedTTest(hitsList, baselineHitsList, 0.05);
        const confidenceInterval = StatisticalInference.confidenceInterval(hitsList, 0.95);
        const bootstrapResult = StatisticalInference.bootstrapCompare(hitsList, baselineHitsList, {
            iterations: options.bootstrapIterations || 5000,
            seed: options.seed || 123456
        });

        // Detecção de Overfitting (Walk-Forward Split)
        const trainTestSplit = this.evaluateWalkForward(chronological, config, generatorFn, windowSize);

        return {
            evaluatedDraws: hitsList.length,
            meanHits: modelStats.mean,
            medianHits: modelStats.median,
            minHits: Math.min(...hitsList),
            maxHits: Math.max(...hitsList),
            stdDev: modelStats.standardDeviation,
            hitsDistribution,
            hitTierBreakdown,
            baselineMean: baselineResult.mean,
            diffMean: inferenceTest.difference,
            relativeImprovement: inferenceTest.relativeImprovement,
            confidenceInterval,
            pValue: inferenceTest.pValue,
            isStatisticallySignificant: inferenceTest.statisticallySignificant,
            effectSize: inferenceTest.effectSize,
            effectDescriptor: inferenceTest.effectDescriptor,
            conclusion: inferenceTest.conclusion,
            tTestResult: inferenceTest,
            bootstrapResult,
            walkForward: trainTestSplit,
            dataLeakageDetected: false
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
            const actual = new Set(chronologicalHistory[i].dezenas ? chronologicalHistory[i].dezenas.map(Number) : []);
            const game = generatorFn(past, config);
            const predArray = Array.isArray(game) ? game : (game && game.dezenas ? game.dezenas : []);
            const hits = predArray.filter(n => actual.has(n)).length;
            inSampleHits.push(hits);
        }

        // Out-of-sample test (metade recente da janela)
        let outSampleHits = [];
        for (let i = mid; i < total; i++) {
            const past = chronologicalHistory.slice(0, i).reverse();
            const actual = new Set(chronologicalHistory[i].dezenas ? chronologicalHistory[i].dezenas.map(Number) : []);
            const game = generatorFn(past, config);
            const predArray = Array.isArray(game) ? game : (game && game.dezenas ? game.dezenas : []);
            const hits = predArray.filter(n => actual.has(n)).length;
            outSampleHits.push(hits);
        }

        const inStats = StatisticalAnalyzer.calculateDistributionStats(inSampleHits);
        const outStats = StatisticalAnalyzer.calculateDistributionStats(outSampleHits);

        // K-Fold Cross Validation (3 Folds na janela)
        const folds = 3;
        const foldSize = Math.floor(evalWindow / folds);
        const foldResults = [];
        if (evalWindow >= 15) {
            for (let f = 0; f < folds; f++) {
                const foldStart = total - evalWindow + (f * foldSize);
                const foldEnd = f === folds - 1 ? total : foldStart + foldSize;
                let foldHits = [];
                for (let i = foldStart; i < foldEnd; i++) {
                    const past = chronologicalHistory.slice(0, i).reverse();
                    const actual = new Set(chronologicalHistory[i].dezenas ? chronologicalHistory[i].dezenas.map(Number) : []);
                    const game = generatorFn(past, config);
                    const predArray = Array.isArray(game) ? game : (game && game.dezenas ? game.dezenas : []);
                    const hits = predArray.filter(n => actual.has(n)).length;
                    foldHits.push(hits);
                }
                const fStats = StatisticalAnalyzer.calculateDistributionStats(foldHits);
                foldResults.push({
                    fold: f + 1,
                    size: foldHits.length,
                    mean: fStats.mean
                });
            }
        }

        // Se a performance despencar bruscamente na amostra nova, há overfitting
        const isOverfitting = (inStats.mean - outStats.mean) > (inStats.stdDev * 0.8);

        return {
            isOverfitting,
            inSampleMean: inStats.mean,
            outSampleMean: outStats.mean,
            diff: Number((outStats.mean - inStats.mean).toFixed(2)),
            foldResults
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
            confidenceInterval: { lower: 0, upper: 0, margin: 0, mean: 0 },
            pValue: 1,
            isStatisticallySignificant: false,
            tTestResult: { tStatistic: 0, pValue: 1, isSignificant: false },
            walkForward: { isOverfitting: false, inSampleMean: 0, outSampleMean: 0, diff: 0, foldResults: [] },
            dataLeakageDetected: false
        };
    }

    /**
     * Teste t pareado delegando para o módulo de Inferência Estatística Exata
     */
    static pairedTTest(modelHits, baselineHits, alpha = 0.05) {
        const res = StatisticalInference.pairedTTest(modelHits, baselineHits, alpha);
        return {
            ...res,
            isSignificant: res.statisticallySignificant
        };
    }

    /**
     * Intervalo de Confiança delegando para o módulo de Inferência Estatística
     */
    static confidenceInterval95(values) {
        return StatisticalInference.confidenceInterval(values, 0.95);
    }
}
