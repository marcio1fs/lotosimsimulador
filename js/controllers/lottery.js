import { LotteryModel } from '../models/lottery.js';
import { LotteryAPIService } from '../services/lotteryApi.js';
import { Database } from '../db/database.js';
import { StatisticalAnalyzer } from '../engine/statisticalAnalyzer.js';
import { BacktestEngine } from '../engine/backtestEngine.js';
import { GameGenerator } from '../engine/gameGenerator.js';
import { BaselineEngine } from '../engine/baselineEngine.js';

export class LotteryController {
    static _worker = null;
    static _taskIdCounter = 0;

    /**
     * Executa a geração pesada em um Web Worker (se suportado pelo navegador) para manter a UI a 60fps
     */
    static async _runGenerationInWorkerOrFallback(payload) {
        if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
            try {
                if (!this._worker) {
                    this._worker = new Worker(new URL('../workers/engineWorker.js', import.meta.url), { type: 'module' });
                }
                const taskId = ++this._taskIdCounter;

                return await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Worker timeout'));
                    }, 25000);

                    const handler = (e) => {
                        if (e.data?.taskId !== taskId) return;
                        this._worker.removeEventListener('message', handler);
                        clearTimeout(timeout);
                        if (e.data.success) {
                            const { games, forecastPolicy, portfolioProjection, wheelMetadata, modelPipeline } = e.data.result;
                            if (forecastPolicy) games.forecastPolicy = forecastPolicy;
                            if (portfolioProjection) games.portfolioProjection = portfolioProjection;
                            if (wheelMetadata) games.wheelMetadata = wheelMetadata;
                            if (modelPipeline) games.modelPipeline = modelPipeline;
                            resolve(games);
                        } else {
                            reject(new Error(e.data.error || 'Worker error'));
                        }
                    };

                    this._worker.addEventListener('message', handler);
                    this._worker.postMessage({ taskId, action: 'GENERATE_GAMES', payload });
                });
            } catch (workerErr) {
                console.warn('Web Worker indisponível, executando na thread principal:', workerErr);
            }
        }

        return LotteryModel.generateSmartGames(
            payload.type,
            payload.fullHistory,
            payload.strategy,
            payload.fixed,
            payload.excluded,
            payload.gamesCount,
            payload.timeWindow,
            payload.seed
        );
    }

    /**
     * Busca e sincroniza histórico de concursos oficiais (em lote ou incremental)
     */
    static async fetchAllResults(userId, types = ['lotofacil'], timeWindow = 'full') {
        const results = {};

        await Promise.all(types.map(async (type) => {
            let cachedData = await Database.getAllByIndex('lottery_results', 'lotteryType', type);
            let lastResult = null;

            try {
                if (cachedData.length < 100) {
                    const batch = await LotteryAPIService.fetchHistoryBatch(type, 150);
                    if (batch && batch.length > 0) {
                        lastResult = batch[0];
                        const existingConcursos = new Set(cachedData.map(r => r.concurso));
                        for (const item of batch) {
                            if (!existingConcursos.has(item.concurso)) {
                                const newEntry = {
                                    lotteryType: type,
                                    concurso: item.concurso,
                                    data: item.data,
                                    dezenas: item.dezenas,
                                    fetchedAt: new Date().toISOString()
                                };
                                await Database.add('lottery_results', newEntry);
                                cachedData.push(newEntry);
                                existingConcursos.add(item.concurso);
                            }
                        }
                    }
                } else {
                    const apiData = await LotteryAPIService.fetchLatest(type);
                    if (apiData) {
                        lastResult = apiData;
                        const exists = cachedData.find(r => r.concurso === lastResult.concurso);
                        if (!exists) {
                            const newEntry = {
                                lotteryType: type,
                                concurso: lastResult.concurso,
                                data: lastResult.data,
                                dezenas: lastResult.dezenas,
                                fetchedAt: new Date().toISOString()
                            };
                            await Database.add('lottery_results', newEntry);
                            cachedData.unshift(newEntry);
                        }
                    }
                }
            } catch (e) {
                console.error(`Erro ao buscar ${type}:`, e);
            }

            if (cachedData.length < 120) {
                cachedData = LotteryAPIService.ensureMinimumHistoryDepth(cachedData, type, 120);
            }

            cachedData.sort((a, b) => b.concurso - a.concurso);

            const cfg = LotteryModel.CONFIG[type];
            const windowData = StatisticalAnalyzer.getWindow(cachedData, timeWindow);
            const fullAnalysis = StatisticalAnalyzer.analyze(windowData, cfg);

            results[type] = {
                data: cachedData,
                windowData,
                lastResult: lastResult || cachedData[0],
                analysis: fullAnalysis,
                freq: fullAnalysis.freqAbsolute,
                atraso: fullAnalysis.currentDelay
            };
        }));

        return results;
    }

    /**
     * Gera jogos estatísticos inteligentes via Web Worker (com fallback síncrono)
     */
    static async generateGames(userId, type, strategy, resultsData, fixed = [], excluded = [], timeWindow = 'full', gamesCount = 10) {
        const fullHistory = resultsData.data || [];
        const cfg = LotteryModel.CONFIG[type];
        if (!cfg || fullHistory.length === 0) return [];

        const games = await this._runGenerationInWorkerOrFallback({
            type,
            fullHistory,
            strategy,
            fixed,
            excluded,
            gamesCount,
            timeWindow,
            seed: 123456
        });

        for (const game of games) {
            await Database.add('games', {
                userId,
                lotteryType: type,
                strategy,
                numbers: JSON.stringify(game.numbers),
                modelScore: game.modelScore,
                historicalPerformance: game.historicalPerformance,
                expectedHits: game.expectedHits,
                confidenceLevel: game.confidenceLevel,
                probabilityType: game.probabilityType,
                explanations: JSON.stringify(game.explanations),
                stats: JSON.stringify(game.stats),
                createdAt: new Date().toISOString()
            });
        }

        await Database.add('simulations', {
            userId,
            lotteryType: type,
            strategy,
            gamesCount: games.length,
            resultsCount: fullHistory.length,
            createdAt: new Date().toISOString()
        });

        return games;
    }

    /**
     * Executa o benchmark completo comparando todas as estratégias contra a Baseline Aleatória
     */
    static runStrategyBenchmark(fullHistory, config, windowSize = 50) {
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

        strategies.forEach(strat => {
            if (strat.id === 'random') {
                const generatorFn = (past, cfg) => BaselineEngine.generateRandomGame(cfg);
                const bt = BacktestEngine.runBacktest(fullHistory, config, generatorFn, { windowSize });
                results.push({
                    strategy: strat.name,
                    meanHits: bt.baselineMean,
                    baselineMean: bt.baselineMean,
                    diff: 0.0,
                    relativeImprovement: '0.0%',
                    pValue: 1,
                    isSignificant: false,
                    confidenceInterval: null
                });
            } else {
                const generatorFn = (past, cfg) => {
                    const analysis = StatisticalAnalyzer.analyze(past, cfg);
                    return GameGenerator.generateSingleCandidate(cfg.apiName, analysis, strat.id, [], [], cfg);
                };
                const bt = BacktestEngine.runBacktest(fullHistory, config, generatorFn, { windowSize });
                results.push({
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
        });

        results.sort((a, b) => b.meanHits - a.meanHits);
        return results;
    }
}
