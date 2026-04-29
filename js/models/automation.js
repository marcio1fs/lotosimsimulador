import { Database } from '../db/database.js';

/**
 * Model: Automation - Automation settings and state
 */
export class AutomationModel {
    static state = { active: false, autoFetch: false, autoGenerate: false, autoConference: false, autoAllLotteries: false, intervalMinutes: 30, timer: null, nextRun: null, execCountToday: 0, log: [] };

    static async load(userId) {
        const settings = await Database.get('auto_settings', userId);
        if (settings) {
            this.state.autoFetch = settings.autoFetch || false;
            this.state.autoGenerate = settings.autoGenerate || false;
            this.state.autoConference = settings.autoConference || false;
            this.state.autoAllLotteries = settings.autoAllLotteries || false;
            this.state.intervalMinutes = settings.intervalMinutes || 30;
            this.state.active = settings.active || false;
        }
        const logs = await Database.getAllByIndex('auto_log', 'userId', userId);
        this.state.log = logs.slice(-50).map(l => ({ time: new Date(l.timestamp).toLocaleTimeString('pt-BR'), type: l.type, message: l.message }));
        return this.state;
    }

    static async save(userId) {
        const settings = await Database.get('auto_settings', userId);
        if (settings) {
            Object.assign(settings, { 
                autoFetch: this.state.autoFetch, 
                autoGenerate: this.state.autoGenerate, 
                autoConference: this.state.autoConference, 
                autoAllLotteries: this.state.autoAllLotteries, 
                intervalMinutes: this.state.intervalMinutes, 
                active: this.state.active 
            });
            await Database.update('auto_settings', settings);
        }
    }

    static addLog(type, message) {
        this.state.log.unshift({ time: new Date().toLocaleTimeString('pt-BR'), type, message });
        if (this.state.log.length > 50) this.state.log.pop();
    }
}
