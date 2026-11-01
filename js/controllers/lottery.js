import { LotteryModel } from '../models/lottery.js';
import { LotteryAPIService } from '../services/lotteryApi.js';
import { Database } from '../db/database.js';
import { StatisticalAnalyzer } from '../engine/statisticalAnalyzer.js';
import { executeBenchmark } from '../workers/engineWorker.js';
import { PermutationTestEngine } from '../engine/permutationTestEngine.js';

export class LotteryController {
    static _worker = null;
    static _taskIdCounter = 0;

    static _postWorkerTask(action, payload, timeoutMs = 25000) {
        if (typeof Worker === 'undefined' || typeof window === 'undefined') {
            return Promise.reject(new Error('Worker unavailable'));
        }
        if (!this._worker) {
            this._worker = new Worker(new URL('../workers/engineWorker.js', import.meta.url), { type: 'module' });
        }
        const taskId = ++this._taskIdCounter;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this._worker?.removeEventListener('message', handler);
                reject(new Error('Worker timeout'));
            }, timeoutMs);

            const handler = (e) => {
                if (e.data?.taskId !== taskId) return;
                this._worker?.removeEventListener('message', handler);
                clearTimeout(timeout);
                if (e.data.success) {
                    resolve(e.data.result);
                } else {
                    reject(new Error(e.data.error || 'Worker error'));
                }
            };

            this._worker.addEventListener('message', handler);
            this._worker.postMessage({ taskId, action, payload });
        });
    }

    /**
     * Executa a geração pesada em um Web Worker (se suportado pelo navegador) para manter a UI a 60fps
     */
    static async _runGenerationInWorkerOrFallback(payload) {
        try {
            const res = await this._postWorkerTask('GENERATE_GAMES', payload, 25000);
            const { games, forecastPolicy, portfolioProjection, wheelMetadata, modelPipeline } = res;
            if (forecastPolicy) games.forecastPolicy = forecastPolicy;
            if (portfolioProjection) games.portfolioProjection = portfolioProjection;
            if (wheelMetadata) games.wheelMetadata = wheelMetadata;
            if (modelPipeline) games.modelPipeline = modelPipeline;
            return games;
        } catch (_) {
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
    }

    /**
     * Recalcula instantaneamente a janela estatística em memória (zero requisições de rede / banco)
     */
    static recomputeWindow(resultsData, type, timeWindow = 'full') {
        const entry = resultsData?.[type];
        if (!entry || !Array.isArray(entry.data) || entry.data.length === 0) return null;
        const cfg = LotteryModel.CONFIG[type];
        const windowData = StatisticalAnalyzer.getWindow(entry.data, timeWindow);
        const fullAnalysis = StatisticalAnalyzer.analyze(windowData, cfg);
        const updated = {
            ...entry,
            windowData,
            analysis: fullAnalysis,
            freq: fullAnalysis.freqAbsolute,
            atraso: fullAnalysis.currentDelay
        };
        resultsData[type] = updated;
        return updated;
    }

    /**
     * Busca e sincroniza histórico de concursos oficiais (via Delta-Sync Serverless ou fallback local)
     */
    static async fetchAllResults(userId, types = ['lotofacil'], timeWindow = 'full') {
        const results = {};
        let serverSync = null;

        if (Database.useApi) {
            try {
                serverSync = await Database.syncLotteries(types);
            } catch (e) {
                console.warn('Sync serverless indisponível, usando fallback:', e);
            }
        }

        await Promise.all(types.map(async (type) => {
            let cachedData = await Database.getAllByIndex('lottery_results', 'lotteryType', type);

            // O servidor devolve `lotteries[type].draws` — o código lia
            // `synced[type].latest`, que nunca existiu, então o resultado
            // recém-sincronizado era descartado silenciosamente.
            const syncInfo = serverSync?.lotteries?.[type] || null;
            let lastResult = syncInfo?.draws?.[0] || null;

            // Degradação não pode passar em silêncio: se todas as fontes
            // externas falharam, os dados vieram do cache e o usuário precisa saber.
            if (syncInfo?.degraded) {
                console.warn(
                    `[${type}] Fontes externas indisponíveis — usando cache persistido. ` +
                    `Tentativas: ${(syncInfo.errors || []).map(e => `${e.source}: ${e.error}`).join(' | ') || 'n/d'}`
                );
            }

            if (!Database.useApi) {
                try {
                    if (cachedData.length < 100) {
                        const batch = await LotteryAPIService.fetchHistoryBatch(type, 150);
                        if (batch && batch.length > 0) {
                            lastResult = batch[0];
                            const existingConcursos = new Set(cachedData.map(r => r.concurso));
                            const toAdd = [];
                            for (const item of batch) {
                                if (!existingConcursos.has(item.concurso)) {
                                    const newEntry = {
                                        lotteryType: type,
                                        concurso: item.concurso,
                                        data: item.data,
                                        dezenas: item.dezenas,
                                        acumulou: Boolean(item.acumulado ?? item.acumulou),
                                        valorEstimado: item.valorEstimado ?? null,
                                        fetchedAt: new Date().toISOString()
                                    };
                                    toAdd.push(newEntry);
                                    cachedData.push(newEntry);
                                    existingConcursos.add(item.concurso);
                                }
                            }
                            if (toAdd.length > 0) {
                                await Database.addMany('lottery_results', toAdd);
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
                                    acumulou: Boolean(lastResult.acumulado ?? lastResult.acumulou),
                                    valorEstimado: lastResult.valorEstimado ?? null,
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
            }

            if (cachedData.length < 120) {
                cachedData = LotteryAPIService.ensureMinimumHistoryDepth(cachedData, type, 120);
            }

            cachedData.sort((a, b) => b.concurso - a.concurso);

            const top = lastResult || cachedData[0];
            const normalizedLast = top ? {
                ...top,
                acumulado: Boolean(top.acumulado ?? top.acumulou),
                valor: top.valor || (top.valorEstimado
                    ? Number(top.valorEstimado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                    : '')
            } : null;

            const cfg = LotteryModel.CONFIG[type];
            const windowData = StatisticalAnalyzer.getWindow(cachedData, timeWindow);
            const fullAnalysis = StatisticalAnalyzer.analyze(windowData, cfg);

            const syntheticDraws = LotteryAPIService.countSynthetic(cachedData);
            results[type] = {
                data: cachedData,
                windowData,
                lastResult: normalizedLast,
                analysis: fullAnalysis,
                freq: fullAnalysis.freqAbsolute,
                atraso: fullAnalysis.currentDelay,
                // Proveniência explícita: o usuário precisa saber se os números
                // exibidos vêm de resultados oficiais ou de preenchimento.
                dataQuality: {
                    totalDraws: cachedData.length,
                    officialDraws: cachedData.length - syntheticDraws,
                    syntheticDraws,
                    isTrustworthyForInference: syntheticDraws === 0 && cachedData.length >= 100,
                    label: syntheticDraws > 0
                        ? `${cachedData.length - syntheticDraws} concursos oficiais + ${syntheticDraws} sintéticos (sem valor estatístico)`
                        : `${cachedData.length} concursos oficiais`
                }
            };
        }));

        return results;
    }

    /**
     * Gera jogos estatísticos inteligentes via Web Worker e salva em lote único (addMany)
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

        const nowIso = new Date().toISOString();
        const gamePayloads = games.map(game => ({
            userId,
            lotteryType: type,
            strategy,
            numbers: game.numbers,
            modelScore: game.modelScore,
            historicalPerformance: game.historicalPerformance,
            expectedHits: game.expectedHits,
            confidenceLevel: game.confidenceLevel,
            probabilityType: game.probabilityType,
            explanations: game.explanations,
            stats: game.stats,
            createdAt: nowIso
        }));

        await Promise.all([
            Database.addMany('games', gamePayloads),
            Database.add('simulations', {
                userId,
                lotteryType: type,
                strategy,
                gamesCount: games.length,
                resultsCount: fullHistory.length,
                createdAt: nowIso
            })
        ]);

        return games;
    }

    /**
     * Executa o benchmark completo de forma síncrona (compatível com testes) com correção Holm–Bonferroni
     */
    static runStrategyBenchmark(fullHistory, config, windowSize = 50) {
        return executeBenchmark(fullHistory, config, windowSize);
    }

    /**
     * Teste de permutação da ordem temporal. Roda no worker; se o worker não
     * estiver disponível, executa na thread principal (mais lento, mas correto).
     */
    static async runPermutationTestAsync(fullHistory, config, options = {}) {
        const payload = {
            fullHistory,
            config,
            runs: options.runs ?? PermutationTestEngine.DEFAULT_RUNS,
            windowSize: options.windowSize ?? PermutationTestEngine.DEFAULT_WINDOW,
            seed: options.seed ?? 123456,
            strategy: options.strategy || 'adaptive'
        };
        try {
            return await this._postWorkerTask('PERMUTATION_TEST', payload, 90000);
        } catch (_) {
            return PermutationTestEngine.run({
                history: payload.fullHistory,
                config: payload.config,
                runs: payload.runs,
                windowSize: payload.windowSize,
                seed: payload.seed,
                strategy: payload.strategy
            });
        }
    }

    /**
     * Executa o benchmark completo em Web Worker (sem bloquear a thread principal da UI)
     */
    static async runStrategyBenchmarkAsync(fullHistory, config, windowSize = 50) {
        try {
            return await this._postWorkerTask('BENCHMARK', { fullHistory, config, windowSize }, 25000);
        } catch (_) {
            return executeBenchmark(fullHistory, config, windowSize);
        }
    }
}
