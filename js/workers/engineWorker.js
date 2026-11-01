/**
 * EngineWorker - Web Worker para Processamento Matemático Assíncrono sem Travar a UI (60fps)
 * Executa GameGenerator, BacktestEngine, MonteCarloEngine, Simulated Annealing, Cadeias de Markov
 * e Benchmark de Estratégias com Correção de Holm–Bonferroni em background thread.
 */

import { LotteryModel } from '../models/lottery.js';
import { StatisticalAnalyzer } from '../engine/statisticalAnalyzer.js';
import { BacktestEngine } from '../engine/backtestEngine.js';
import { GameGenerator } from '../engine/gameGenerator.js';
import { BaselineEngine } from '../engine/baselineEngine.js';
import { PermutationTestEngine } from '../engine/permutationTestEngine.js';

/**
 * Correção step-down de Holm–Bonferroni para controlar falsos positivos (FWER)
 * ao testar múltiplas estratégias simultaneamente contra a baseline aleatória.
 */
export function applyHolmBonferroni(results, alpha = 0.05) {
    if (!Array.isArray(results)) return results;
    const testable = results.filter(
        r => r.strategyId !== 'random' && typeof r.pValue === 'number' && Number.isFinite(r.pValue)
    );
    const m = testable.length;
    if (m === 0) return results;

    const ordered = [...testable].sort((a, b) => a.pValue - b.pValue);
    let maxAdj = 0;
    let rejectedAllSoFar = true;

    ordered.forEach((item, idx) => {
        const factor = m - idx;
        const adj = Math.min(1, Math.max(maxAdj, item.pValue * factor));
        maxAdj = adj;
        item.adjustedPValue = Number(adj.toFixed(6));
        if (rejectedAllSoFar && adj < alpha && item.diff > 0) {
            item.isSignificant = true;
        } else {
            rejectedAllSoFar = false;
            item.isSignificant = false;
        }
    });

    for (const r of results) {
        if (r.strategyId === 'random' || r.adjustedPValue === undefined) {
            r.adjustedPValue = typeof r.pValue === 'number' ? r.pValue : 1;
            if (r.strategyId === 'random') r.isSignificant = false;
        }
    }
    return results;
}

export function executeBenchmark(fullHistory, config, windowSize = 50) {
    const strategies = [
        { id: 'wheeling', name: 'Fechamento Combinatório + Annealing' },
        { id: 'anti_crowd', name: 'Prêmio Sozinho (Anti-Multidão EV+)' },
        { id: 'markov', name: 'Cadeias de Markov (Transição t-1 → t)' },
        { id: 'adaptive', name: 'Modelo Adaptativo (Multifatorial)' },
        { id: 'weighted', name: 'Ponderado (Frequência)' },
        { id: 'hot', name: 'Quentes (Maior Saída)' },
        { id: 'cold', name: 'Frios (Atrasados)' },
        { id: 'random', name: 'Aleatório (Baseline)' }
    ];

    const results = [];

    for (const strat of strategies) {
        if (strat.id === 'random') {
            const generatorFn = (past, cfg) => BaselineEngine.generateRandomGame(cfg);
            const bt = BacktestEngine.runBacktest(fullHistory, config, generatorFn, { windowSize, bootstrapIterations: 1500 });
            results.push({
                strategyId: strat.id,
                strategy: strat.name,
                meanHits: bt.baselineMean,
                baselineMean: bt.baselineMean,
                diff: 0.0,
                relativeImprovement: '0.0%',
                pValue: 1,
                adjustedPValue: 1,
                isSignificant: false,
                confidenceInterval: null
            });
        } else {
            const generatorFn = (past, cfg) => {
                const analysis = StatisticalAnalyzer.analyzeFast(past, cfg);
                return GameGenerator.generateSingleCandidate(cfg.apiName, analysis, strat.id, [], [], cfg);
            };
            const bt = BacktestEngine.runBacktest(fullHistory, config, generatorFn, { windowSize, bootstrapIterations: 1500 });
            results.push({
                strategyId: strat.id,
                strategy: strat.name,
                meanHits: bt.meanHits,
                baselineMean: bt.baselineMean,
                diff: bt.diffMean,
                relativeImprovement: bt.relativeImprovement,
                pValue: bt.pValue,
                isSignificant: bt.isStatisticallySignificant,
                confidenceInterval: bt.confidenceInterval
            });
        }
    }

    applyHolmBonferroni(results, 0.05);
    results.sort((a, b) => b.meanHits - a.meanHits);
    return results;
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    self.onmessage = (event) => {
        const { taskId, action, payload } = event.data || {};
        try {
            if (action === 'GENERATE_GAMES') {
                const { type, fullHistory, strategy, fixed, excluded, gamesCount, timeWindow, seed } = payload;
                const games = LotteryModel.generateSmartGames(
                    type,
                    fullHistory,
                    strategy,
                    fixed,
                    excluded,
                    gamesCount,
                    timeWindow,
                    seed
                );

                self.postMessage({
                    taskId,
                    success: true,
                    result: {
                        games: [...games],
                        forecastPolicy: games.forecastPolicy || null,
                        portfolioProjection: games.portfolioProjection || null,
                        wheelMetadata: games.wheelMetadata || null,
                        modelPipeline: games.modelPipeline || null
                    }
                });
            } else if (action === 'PERMUTATION_TEST') {
                // Teste de aleatorização temporal: roda o pipeline inteiro em
                // históricos com a ordem embaralhada. Caro por construção —
                // por isso vive aqui, sob demanda, e nunca no caminho de geração.
                const { fullHistory, config, runs, windowSize, seed, strategy } = payload;
                const result = PermutationTestEngine.run({
                    history: fullHistory,
                    config,
                    runs,
                    windowSize,
                    seed,
                    strategy
                });
                self.postMessage({ taskId, success: true, result });
            } else if (action === 'BENCHMARK') {
                const { fullHistory, config, windowSize } = payload;
                const benchmark = executeBenchmark(fullHistory, config, windowSize || 50);
                self.postMessage({ taskId, success: true, result: benchmark });
            } else {
                self.postMessage({
                    taskId,
                    success: false,
                    error: `Ação desconhecida no worker: ${action}`
                });
            }
        } catch (err) {
            self.postMessage({
                taskId,
                success: false,
                error: err?.message || String(err)
            });
        }
    };
}
