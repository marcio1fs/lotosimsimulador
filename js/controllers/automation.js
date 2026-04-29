import { AutomationModel } from '../models/automation.js';
import { LotteryController } from './lottery.js';
import { UserModel } from '../models/user.js';

export class AutomationController {
    static start(onCycle) {
        this.stop();
        const ms = AutomationModel.state.intervalMinutes * 60 * 1000;
        AutomationModel.state.timer = setInterval(() => onCycle(), ms);
        AutomationModel.state.nextRun = new Date(Date.now() + ms);
    }

    static stop() {
        if (AutomationModel.state.timer) { 
            clearInterval(AutomationModel.state.timer); 
            AutomationModel.state.timer = null; 
        }
        AutomationModel.state.nextRun = null;
    }

    static async executeCycle(userId, appState) {
        AutomationModel.state.execCountToday++;
        AutomationModel.addLog('info', `Execução automática #${AutomationModel.state.execCountToday}`);
        const types = AutomationModel.state.autoAllLotteries ? ['lotofacil','mega','lotomania','quina'] : [appState.currentLottery];
        
        try {
            if (AutomationModel.state.autoFetch) {
                AutomationModel.addLog('fetch', 'Sincronizando dados...');
                const results = await LotteryController.fetchAllResults(userId, types);
                Object.assign(appState.resultsData, results);
                appState.dataReady = true;
            }
            if (AutomationModel.state.autoGenerate && appState.dataReady) {
                AutomationModel.addLog('generate', 'Gerando simulações...');
                for (const type of types) {
                    const rd = appState.resultsData[type];
                    if (rd) {
                        appState.currentLottery = type;
                        const games = await LotteryController.generateGames(userId, type, appState.currentStrategy, rd);
                        appState.generatedGames = games;
                        const stats = await UserModel.getStats(userId);
                        stats.gamesGenerated += 10; stats.simulations += 1;
                        await UserModel.updateStats(userId, stats);
                    }
                }
            }
            if (AutomationModel.state.autoConference && appState.generatedGames.length > 0) {
                const type = appState.currentLottery;
                const last = appState.resultsData[type]?.lastResult;
                if (last?.dezenas) {
                    const drawn = last.dezenas.map(d => parseInt(d));
                    const hits = appState.generatedGames.map(g => ({ ...g, hitCount: g.numbers.filter(n => drawn.includes(n)).length }));
                    const maxHit = Math.max(...hits.map(h => h.hitCount));
                    AutomationModel.addLog('conference', `Melhor performance: ${maxHit} acertos`);
                }
            }
            await AutomationModel.save(userId);
        } catch (e) { 
            AutomationModel.addLog('error', e.message); 
            console.error('Automation error:', e);
        }
    }
}
