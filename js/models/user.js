import { Database } from '../db/database.js';
import { isLegacyHash, legacyDeadlineReached, LEGACY_HASH_SUNSET_LABEL } from '../../shared/passwordPolicy.js';

async function authFetch(path, method = 'POST', body = undefined) {
    const opts = { method, credentials: 'include', headers: {} };
    if (body !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
}

/**
 * Model: User - Autenticação segura via API Serverless (bcrypt + HttpOnly Cookie)
 * com fallback local criptográfico PBKDF2-SHA256 (Web Crypto API) para modo offline.
 */
export class UserModel {
    /**
     * Hash legado (reversível) das versões antigas do app.
     *
     * @deprecated Item 6.12: existe só para converter contas antigas no login e
     * deixa de ser aceito em 31/01/2027 (`LEGACY_HASH_SUNSET_LABEL`). O prazo é o
     * mesmo do servidor e vive em `shared/passwordPolicy.js`.
     */
    static _legacyHashPassword(password) {
        let hash = 0;
        for (let i = 0; i < password.length; i++) {
            const char = password.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        const b64 = typeof btoa === 'function'
            ? btoa(password)
            : Buffer.from(password, 'utf-8').toString('base64');
        return 'h_' + Math.abs(hash).toString(36) + '_' + b64.substring(0, 12);
    }

    /**
     * Gera um hash criptográfico irreversível PBKDF2-HMAC-SHA256 com salt aleatório de 128 bits
     * Formato: pbkdf2$100000$<salt_hex>$<hash_hex>
     */
    static async hashPasswordAsync(password, customSaltHex = null) {
        const saltBytes = new Uint8Array(16);
        if (customSaltHex) {
            for (let i = 0; i < 16; i++) {
                saltBytes[i] = parseInt(customSaltHex.slice(i * 2, i * 2 + 2), 16) || 0;
            }
        } else {
            crypto.getRandomValues(saltBytes);
        }

        const saltHex = Array.from(saltBytes, b => b.toString(16).padStart(2, '0')).join('');
        const enc = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            enc.encode(String(password)),
            { name: 'PBKDF2' },
            false,
            ['deriveBits']
        );

        const derivedBits = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: saltBytes,
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            256
        );

        const hashHex = Array.from(new Uint8Array(derivedBits), b => b.toString(16).padStart(2, '0')).join('');
        return `pbkdf2$100000$${saltHex}$${hashHex}`;
    }

    /**
     * Verifica uma senha contra o hash armazenado no modo local.
     *
     * PBKDF2 é o formato atual. O hash legado (`h_…`) só é aceito até o prazo do
     * item 6.12 — e, quando aceito, a conta é convertida para PBKDF2 em seguida
     * (`needsUpgrade`). Depois do prazo a verificação é recusada sem sequer
     * calcular o hash antigo.
     *
     * `now` existe para o teste simular os dois lados do prazo.
     */
    static async verifyPasswordAsync(password, storedHash, { now = Date.now() } = {}) {
        if (!storedHash || typeof storedHash !== 'string') return { valid: false, needsUpgrade: false };

        if (storedHash.startsWith('pbkdf2$')) {
            const parts = storedHash.split('$');
            const saltHex = parts[2];
            if (!saltHex) return { valid: false, needsUpgrade: false };
            const computed = await this.hashPasswordAsync(password, saltHex);
            return { valid: computed === storedHash, needsUpgrade: false };
        }

        if (!isLegacyHash(storedHash)) return { valid: false, needsUpgrade: false };
        if (legacyDeadlineReached(now)) return { valid: false, needsUpgrade: false, legacyExpired: true };

        const legacyValid = storedHash === this._legacyHashPassword(password);
        return { valid: legacyValid, needsUpgrade: legacyValid, legacy: legacyValid };
    }

    static generateToken() {
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }

    static async register(name, email, password) {
        if (Database.useApi) {
            const { ok, data } = await authFetch('/api/auth/register', 'POST', { name, email, password });
            return ok ? { success: true } : { success: false, error: data.error || 'Falha ao criar conta' };
        }

        const normalizedEmail = String(email || '').trim().toLowerCase();
        const exists = await Database.getByIndex('users', 'email', normalizedEmail);
        if (exists) return { success: false, error: 'E-mail já cadastrado' };
        if (!name || name.trim().length < 3) return { success: false, error: 'Nome deve ter pelo menos 3 caracteres' };
        if (!password || password.length < 8) return { success: false, error: 'Senha deve ter pelo menos 8 caracteres' };

        const securePasswordHash = await this.hashPasswordAsync(password);
        const userId = await Database.add('users', {
            name: name.trim(),
            email: normalizedEmail,
            password: securePasswordHash,
            createdAt: new Date().toISOString()
        });

        await Database.add('user_stats', { userId, gamesGenerated: 0, simulations: 0, resultsAnalyzed: 0 });
        await Database.add('auto_settings', {
            userId,
            autoFetch: false,
            autoGenerate: false,
            autoConference: false,
            autoAllLotteries: false,
            intervalMinutes: 30,
            active: false
        });
        return { success: true };
    }

    static async login(email, password, remember) {
        if (Database.useApi) {
            const { ok, data } = await authFetch('/api/auth/login', 'POST', { email, password, remember });
            return ok
                ? {
                    success: true,
                    user: data.user,
                    session: data.session,
                    // Senha vinha do formato antigo e foi convertida agora (item 6.12).
                    passwordUpgraded: Boolean(data.passwordUpgraded)
                }
                : { success: false, error: data.error || 'E-mail ou senha incorretos', field: data.field || 'password' };
        }

        const normalizedEmail = String(email || '').trim().toLowerCase();
        const user = await Database.getByIndex('users', 'email', normalizedEmail);
        if (!user) return { success: false, error: 'E-mail ou senha incorretos', field: 'password' };

        const verification = await this.verifyPasswordAsync(password, user.password);
        if (verification.legacyExpired) {
            return {
                success: false,
                field: 'password',
                error: `Esta conta usa o formato de senha antigo, desativado em ${LEGACY_HASH_SUNSET_LABEL}. ` +
                    'Crie uma conta nova — o formato antigo permitia recuperar a senha a partir do banco local.'
            };
        }
        if (!verification.valid) {
            return { success: false, error: 'E-mail ou senha incorretos', field: 'password' };
        }

        if (verification.needsUpgrade) {
            user.password = await this.hashPasswordAsync(password);
            await Database.update('users', user);
        }

        const token = this.generateToken();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        const sessionId = await Database.add('sessions', {
            userId: user.id,
            token,
            createdAt: new Date().toISOString(),
            expiresAt: expiresAt.toISOString()
        });

        if (typeof localStorage !== 'undefined' && typeof sessionStorage !== 'undefined') {
            if (remember) localStorage.setItem('loteria_session_token', token);
            else sessionStorage.setItem('loteria_session_token', token);
        }

        const { password: _ignored, ...safeUser } = user;
        return { success: true, user: safeUser, session: { id: sessionId }, passwordUpgraded: Boolean(verification.legacy) };
    }

    static async validateSession() {
        if (Database.useApi) {
            const { ok, data } = await authFetch('/api/auth/me', 'GET');
            return ok && data.user ? { user: data.user, session: data.session } : null;
        }

        if (typeof localStorage === 'undefined' || typeof sessionStorage === 'undefined') return null;
        const token = localStorage.getItem('loteria_session_token') || sessionStorage.getItem('loteria_session_token');
        if (!token) return null;
        const session = await Database.getByIndex('sessions', 'token', token);
        if (!session || new Date(session.expiresAt) < new Date()) {
            if (session) await Database.delete('sessions', session.id);
            return null;
        }
        const user = await Database.get('users', session.userId);
        if (!user) return null;
        const { password: _ignored, ...safeUser } = user;
        return { user: safeUser, session: { id: session.id } };
    }

    static async logout(sessionId) {
        if (Database.useApi) {
            await authFetch('/api/auth/logout', 'POST', {}).catch(() => {});
        } else if (sessionId) {
            await Database.delete('sessions', sessionId).catch(() => {});
        }
        if (typeof localStorage !== 'undefined') localStorage.removeItem('loteria_session_token');
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('loteria_session_token');
    }

    static async changePassword(userId, currentPass, newPass) {
        if (Database.useApi) {
            const { ok, data } = await authFetch('/api/auth/change-password', 'POST', { currentPass, newPass });
            return ok ? { success: true } : { success: false, error: data.error || 'Erro ao alterar senha' };
        }

        const user = await Database.get('users', userId);
        if (!user) return { success: false, error: 'Usuário não encontrado' };

        const verification = await this.verifyPasswordAsync(currentPass, user.password);
        if (!verification.valid) return { success: false, error: 'Senha atual incorreta' };
        if (!newPass || newPass.length < 8) return { success: false, error: 'A nova senha deve ter no mínimo 8 caracteres' };

        user.password = await this.hashPasswordAsync(newPass);
        await Database.update('users', user);
        return { success: true };
    }

    static async deleteAccount(userId, password) {
        if (Database.useApi) {
            const { ok, data } = await authFetch('/api/auth/delete-account', 'POST', { password });
            return ok ? { success: true } : { success: false, error: data.error || 'Erro ao excluir conta' };
        }

        const user = await Database.get('users', userId);
        if (!user) return { success: false, error: 'Usuário não encontrado' };
        const verification = await this.verifyPasswordAsync(password, user.password);
        if (!verification.valid) return { success: false, error: 'Senha incorreta' };

        await Database.delete('users', userId);
        await Database.delete('user_stats', userId).catch(() => {});
        await Database.delete('auto_settings', userId).catch(() => {});
        if (typeof localStorage !== 'undefined') localStorage.removeItem('loteria_session_token');
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('loteria_session_token');
        return { success: true };
    }

    static async getStats(userId) {
        return await Database.get('user_stats', userId) || { userId, gamesGenerated: 0, simulations: 0, resultsAnalyzed: 0 };
    }

    static async updateStats(userId, stats) {
        const current = await this.getStats(userId);
        await Database.update('user_stats', { ...current, ...stats, userId });
    }

    static async incrementStats(userId, { gamesDelta = 0, simulationsDelta = 0, resultsAnalyzed = null } = {}) {
        if (Database.useApi) {
            const updated = await Database.incrementStats({ gamesDelta, simulationsDelta, resultsAnalyzed });
            if (updated) return updated;
        }
        const current = await this.getStats(userId);
        const next = {
            ...current,
            userId,
            gamesGenerated: (current.gamesGenerated || 0) + (gamesDelta || 0),
            simulations: (current.simulations || 0) + (simulationsDelta || 0),
            resultsAnalyzed: resultsAnalyzed !== null && resultsAnalyzed !== undefined ? resultsAnalyzed : (current.resultsAnalyzed || 0)
        };
        await Database.update('user_stats', next);
        return next;
    }
}
