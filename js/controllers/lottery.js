import { LotteryModel } from '../models/lottery.js';
import { LotteryAPIService } from '../services/lotteryApi.js';
import { Database } from '../db/database.js';

export class LotteryController {
    static async fetchAllResults(userId, types = ['lotofacil']) {
        const results = {};
        
        // Processa todos os tipos em paralelo para maior performance
        await Promise.all(types.map(async (type) => {
            let lastResult = null;
            try { 
                const apiData = await LotteryAPIService.fetchLatest(type); 
                if (apiData) {
                    lastResult = LotteryAPIService.parseResult(apiData, type);
                }
            } catch (e) {
                console.error(`Erro ao buscar ${type}:`, e);
            }

            // Busca histórico real do cache local
            let cachedData = await Database.getAllByIndex('lottery_results', 'lotteryType', type);
            
            // Se buscou novo resultado, adiciona ao cache se não existir
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

            results[type] = { 
                data: cachedData, 
                lastResult: lastResult || cachedData[0], 
                analysis: LotteryModel.analyzeFrequencies(cachedData, type) 
            };
        }));

        return results;
    }

    static async generateGames(userId, type, strategy, resultsData, fixed = [], excluded = []) {
        const analysis = resultsData.analysis;
        if (!analysis) return [];
        
        const games = [];
        for (let i = 0; i < 10; i++) {
            const gameData = LotteryModel.generateSmartGame(type, analysis, strategy, fixed, excluded);
            const score = LotteryModel.calculateScore(gameData.numbers, type, analysis);
            
            games.push({ 
                numbers: gameData.numbers, 
                probability: score, 
                stats: gameData.stats,
                id: Date.now() + i 
            });
        }

        // Salva jogos no DB
        for (const game of games) {
            await Database.add('games', { 
                userId, 
                lotteryType: type, 
                strategy, 
                numbers: JSON.stringify(game.numbers), 
                probability: game.probability, 
                stats: JSON.stringify(game.stats),
                createdAt: new Date().toISOString() 
            });
        }

        // Salva simulação
        await Database.add('simulations', { 
            userId, 
            lotteryType: type, 
            strategy, 
            gamesCount: 10, 
            resultsCount: resultsData.data.length, 
            createdAt: new Date().toISOString() 
        });

        return games;
    }
}

