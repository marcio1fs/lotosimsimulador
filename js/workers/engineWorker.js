/**
 * EngineWorker - Web Worker para Processamento Matemático Assíncrono sem Travar a UI (60fps)
 * Executa GameGenerator, BacktestEngine, MonteCarloEngine, Simulated Annealing e Cadeias de Markov
 * em background thread.
 */

import { LotteryModel } from '../models/lottery.js';

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
