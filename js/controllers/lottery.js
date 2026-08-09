import { LotteryModel } from '../models/lottery.js';
import { LotteryAPIService } from '../services/lotteryApi.js';
import { Database } from '../db/database.js';
import { StatisticalAnalyzer } from '../engine/statisticalAnalyzer.js';
import { BacktestEngine } from '../engine/backtestEngine.js';
import { GameGenerator } from '../engine/gameGenerator.js';

export class LotteryController {
    /**
     * Busca e sincroniza histórico de concursos oficiais
     */
    static async fetchAllResults(userId, types = ['lotofacil'], timeWindow = 'full') {
        const results = {};

        await Promise.all(types.map(async (type) => {
            let lastResult = null;
            try {
                const apiData = await LotteryAPIService.fetchLatest(type);
                if (apiData) {
                    lastResult = apiData;
                }
            } catch (e) {
                console.error(`Erro ao buscar ${type}:`, e);
            }

            // Busca cache local
            let cachedData = await Database.getAllByIndex('lottery_results', 'lotteryType', type);

            // Adiciona novo resultado se não existir
            if (lastResult) {
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

            // Ordena histórico por concurso (mais recente primeiro)
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
     * Gera jogos estatísticos inteligentes
     */
    static async generateGames(userId, type, strategy, resultsData, fixed = [], excluded = [], timeWindow = 'full') {
        const fullHistory = resultsData.data || [];
        const cfg = LotteryModel.CONFIG[type];
        if (!cfg || fullHistory.length === 0) return [];

        const games = LotteryModel.generateSmartGames(
            type,
            fullHistory,
            strategy,
            fixed,
            excluded,
            10,
            timeWindow
        );

        // Salva jogos e simulação no banco
        for (const game of games) {
            await Database.add('games', {
                userId,
                lotteryType: type,
                strategy,
                numbers: JSON.stringify(game.numbers),
                probability: game.probability,
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
            { id: 'adaptive', name: 'Modelo Adaptativo (Estatístico)' },
            { id: 'weighted', name: 'Ponderado (Frequência)' },
            { id: 'hot', name: 'Quentes (Maior Saída)' },
            { id: 'cold', name: 'Frios (Atrasados)' },
            { id: 'random', name: 'Aleatório (Baseline)' }
        ];

        const results = [];

        strategies.forEach(strat => {
            if (strat.id === 'random') {
                const generatorFn = (past, cfg) => GameGenerator.generateSingleCandidate(cfg.apiName, StatisticalAnalyzer.analyze(past, cfg), 'weighted', [], [], cfg);
                const bt = BacktestEngine.runBacktest(fullHistory, config, generatorFn, { windowSize });
                results.push({
                    strategy: strat.name,
                    meanHits: bt.baselineMean,
                    baselineMean: bt.baselineMean,
                    diff: 0.0,
                    relativeImprovement: '0.0%'
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
                    relativeImprovement: bt.relativeImprovement
                });
            }
        });

        results.sort((a, b) => b.meanHits - a.meanHits);
        return results;
    }
}
