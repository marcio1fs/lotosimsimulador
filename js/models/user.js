import { Database } from '../db/database.js';

/**
 * Model: User - User operations
 */
export class UserModel {
    static hashPassword(password) {
        let hash = 0;
        for (let i = 0; i < password.length; i++) {
            const char = password.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return 'h_' + Math.abs(hash).toString(36) + '_' + btoa(password).substring(0, 12);
    }

    static generateToken() {
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }

    static async register(name, email, password) {
        const exists = await Database.getByIndex('users', 'email', email);
        if (exists) return { success: false, error: 'E-mail já cadastrado' };
        if (name.length < 3) return { success: false, error: 'Nome deve ter pelo menos 3 caracteres' };
        if (password.length < 6) return { success: false, error: 'Senha deve ter pelo menos 6 caracteres' };
        const userId = await Database.add('users', { name, email, password: this.hashPassword(password), createdAt: new Date().toISOString() });
        await Database.add('user_stats', { userId, gamesGenerated: 0, simulations: 0, resultsAnalyzed: 0 });
        await Database.add('auto_settings', { userId, autoFetch: false, autoGenerate: false, autoConference: false, autoAllLotteries: false, intervalMinutes: 30, active: false });
        return { success: true };
    }

    static async login(email, password, remember) {
        const user = await Database.getByIndex('users', 'email', email);
        if (!user) return { success: false, error: 'E-mail não encontrado', field: 'email' };
        if (user.password !== this.hashPassword(password)) return { success: false, error: 'Senha incorreta', field: 'password' };
        const token = this.generateToken();
        const expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + 30);
        const sessionId = await Database.add('sessions', { userId: user.id, token, createdAt: new Date().toISOString(), expiresAt: expiresAt.toISOString() });
        if (remember) localStorage.setItem('loteria_session_token', token);
        else sessionStorage.setItem('loteria_session_token', token);
        return { success: true, user, session: { id: sessionId, token } };
    }

    static async validateSession() {
        const token = localStorage.getItem('loteria_session_token') || sessionStorage.getItem('loteria_session_token');
        if (!token) return null;
        const session = await Database.getByIndex('sessions', 'token', token);
        if (!session || new Date(session.expiresAt) < new Date()) {
            if (session) await Database.delete('sessions', session.id);
            return null;
        }
        const user = await Database.get('users', session.userId);
        return user ? { user, session } : null;
    }

    static async logout(sessionId) {
        if (sessionId) await Database.delete('sessions', sessionId).catch(() => {});
        localStorage.removeItem('loteria_session_token');
        sessionStorage.removeItem('loteria_session_token');
    }

    static async changePassword(userId, currentPass, newPass) {
        const user = await Database.get('users', userId);
        if (!user) return { success: false, error: 'Usuário não encontrado' };
        if (user.password !== this.hashPassword(currentPass)) return { success: false, error: 'Senha atual incorreta' };
        if (newPass.length < 6) return { success: false, error: 'Mínimo 6 caracteres' };
        user.password = this.hashPassword(newPass);
        await Database.update('users', user);
        return { success: true };
    }

    static async getStats(userId) {
        return await Database.get('user_stats', userId) || { gamesGenerated: 0, simulations: 0, resultsAnalyzed: 0 };
    }

    static async updateStats(userId, stats) {
        const current = await this.getStats(userId);
        await Database.update('user_stats', { ...current, ...stats });
    }
}
