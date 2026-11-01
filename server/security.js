import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { isLegacyHash, legacyDeadlineReached, LEGACY_HASH_SUNSET_LABEL } from '../shared/passwordPolicy.js';

export { isLegacyHash };

export const COOKIE_NAME = 'lm_session';
export const SESSION_DAYS = 30;

/**
 * Hash legado (inseguro) usado pelas versões antigas do app.
 *
 * @deprecated Item 6.12: só é calculado para converter contas antigas e deixa de
 * existir em 31/01/2027 (`LEGACY_HASH_SUNSET_LABEL`). Não use em conta nova.
 */
export function legacyHash(password) {
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
        hash = ((hash << 5) - hash) + password.charCodeAt(i);
        hash = hash & hash;
    }
    return 'h_' + Math.abs(hash).toString(36) + '_' + Buffer.from(password).toString('base64').substring(0, 12);
}

export const isPbkdf2Hash = (stored) => typeof stored === 'string' && stored.startsWith('pbkdf2$');

export async function hashPassword(password) {
    return bcrypt.hash(password, 12);
}

/**
 * Verifica senha contra bcrypt ($2a$/$2b$), PBKDF2-SHA256 (pbkdf2$iter$salt$hash) ou hash legado (h_...).
 *
 * Retorna `{ ok, upgradedHash?, legacy?, legacyExpired? }` — `upgradedHash` vem
 * preenchido quando um hash legado ou PBKDF2 migra para bcrypt.
 *
 * O hash legado tem prazo (item 6.12): até `LEGACY_HASH_SUNSET_LABEL` ele é
 * verificado e convertido; depois disso a verificação é **recusada** e o hash
 * nem chega a ser calculado — não sobra oráculo para confirmar senha antiga.
 * `now` existe para o teste conseguir simular os dois lados do prazo.
 */
export async function verifyPassword(password, stored, { now = Date.now() } = {}) {
    if (!stored || typeof stored !== 'string') return { ok: false };

    if (isPbkdf2Hash(stored)) {
        const parts = stored.split('$');
        const iterations = parseInt(parts[1], 10) || 100000;
        const saltHex = parts[2];
        const expectedHex = parts[3];
        if (!saltHex || !expectedHex || iterations < 1000 || iterations > 1000000) return { ok: false };
        const saltBuf = Buffer.from(saltHex, 'hex');
        const expectedBuf = Buffer.from(expectedHex, 'hex');
        const derived = crypto.pbkdf2Sync(String(password), saltBuf, iterations, expectedBuf.length, 'sha256');
        const ok = derived.length === expectedBuf.length && crypto.timingSafeEqual(derived, expectedBuf);
        return ok ? { ok: true, upgradedHash: await hashPassword(password) } : { ok: false };
    }

    if (isLegacyHash(stored)) {
        if (legacyDeadlineReached(now)) return { ok: false, legacyExpired: true };
        const a = Buffer.from(legacyHash(password));
        const b = Buffer.from(stored);
        const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
        return ok ? { ok: true, upgradedHash: await hashPassword(password), legacy: true } : { ok: false };
    }

    return { ok: await bcrypt.compare(password, stored) };
}

export const generateToken = () => crypto.randomBytes(32).toString('hex');
/** Apenas o hash do token é salvo no banco. */
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export function parseCookies(header = '') {
    const out = {};
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
    return out;
}

export function buildCookie(token, { remember, secure }) {
    const parts = [`${COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (secure) parts.push('Secure');
    if (remember) parts.push(`Max-Age=${SESSION_DAYS * 86400}`);
    return parts.join('; ');
}

export const clearCookie = (secure) =>
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

export const isValidEmail = (e) => typeof e === 'string' && e.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
