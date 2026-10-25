import { Database } from '../db/database.js';

/**
 * Model: User - Operações de usuário e autenticação criptográfica (PBKDF2 / SHA-256 via Web Crypto API)
 */
export class UserModel {
    /**
     * Hash legado apenas para retrocompatibilidade de migração transparente de contas antigas
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
     * Verifica uma senha contra o hash armazenado (suporta PBKDF2 e migra hashes legados automaticamente)
     */
    static async verifyPasswordAsync(password, storedHash) {
        if (!storedHash || typeof storedHash !== 'string') return { valid: false, needsUpgrade: false };

        if (storedHash.startsWith('pbkdf2$')) {
            const parts = storedHash.split('$');
            const saltHex = parts[2];
            if (!saltHex) return { valid: false, needsUpgrade: false };
            const computed = await this.hashPasswordAsync(password, saltHex);
            return { valid: computed === storedHash, needsUpgrade: false };
        }

        // Fallback para contas criadas antes da atualização criptográfica
        const legacyValid = storedHash === this._legacyHashPassword(password);
        return { valid: legacyValid, needsUpgrade: legacyValid };
    }

    static generateToken() {
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    }

    static async register(name, email, password) {
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const exists = await Database.getByIndex('users', 'email', normalizedEmail);
        if (exists) return { success: false, error: 'E-mail já cadastrado' };
        if (!name || name.trim().length < 3) return { success: false, error: 'Nome deve ter pelo menos 3 caracteres' };
        if (!password || password.length < 6) return { success: false, error: 'Senha deve ter pelo menos 6 caracteres' };

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
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const user = await Database.getByIndex('users', 'email', normalizedEmail);
        if (!user) return { success: false, error: 'E-mail não encontrado', field: 'email' };

        const verification = await this.verifyPasswordAsync(password, user.password);
        if (!verification.valid) {
            return { success: false, error: 'Senha incorreta', field: 'password' };
        }

        // Se a conta usava hash legado, atualiza silenciosamente para PBKDF2-SHA256
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

        return { success: true, user, session: { id: sessionId, token } };
    }

    static async validateSession() {
        if (typeof localStorage === 'undefined' || typeof sessionStorage === 'undefined') return null;
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
        if (typeof localStorage !== 'undefined') localStorage.removeItem('loteria_session_token');
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('loteria_session_token');
    }

    static async changePassword(userId, currentPass, newPass) {
        const user = await Database.get('users', userId);
        if (!user) return { success: false, error: 'Usuário não encontrado' };

        const verification = await this.verifyPasswordAsync(currentPass, user.password);
        if (!verification.valid) return { success: false, error: 'Senha atual incorreta' };
        if (!newPass || newPass.length < 6) return { success: false, error: 'A nova senha deve ter no mínimo 6 caracteres' };

        user.password = await this.hashPasswordAsync(newPass);
        await Database.update('users', user);
        return { success: true };
    }

    static async getStats(userId) {
        return await Database.get('user_stats', userId) || { userId, gamesGenerated: 0, simulations: 0, resultsAnalyzed: 0 };
    }

    static async updateStats(userId, stats) {
        const current = await this.getStats(userId);
        await Database.update('user_stats', { ...current, ...stats, userId });
    }
}
