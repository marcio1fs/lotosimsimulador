import { neon } from '@neondatabase/serverless';
import { TABLES, sanitizePayload, rowToCamel, toSnake } from './tables.js';
import {
    COOKIE_NAME,
    SESSION_DAYS,
    hashPassword,
    verifyPassword,
    generateToken,
    hashToken,
    parseCookies,
    buildCookie,
    clearCookie,
    isValidEmail
} from './security.js';
import { syncLotteries } from './lotterySync.js';
import { evaluateSameSiteRequest, parseAllowedOrigins, hasJsonContentType } from './originPolicy.js';
import { LEGACY_HASH_SUNSET_LABEL } from '../shared/passwordPolicy.js';
import {
    RESET_REQUESTS_PER_HOUR_PER_EMAIL,
    RESET_REQUESTS_PER_HOUR_PER_IP,
    VERIFY_RESENDS_PER_HOUR,
    buildResetLink,
    buildVerifyLink,
    isTokenExpired,
    isValidRecoveryToken,
    passwordProblem,
    redactEmail,
    resetTokenExpiry,
    verifyTokenExpiry
} from '../shared/accountRecovery.js';
import {
    EMAIL_NOT_CONFIGURED_MESSAGE,
    isEmailConfigured,
    resetPasswordMessage,
    sendEmail,
    verifyEmailMessage
} from './email.js';
import { clientIp } from './clientIp.js';
import { consumeRateLimit, limitForRequest, rateLimitMessage } from './rateLimit.js';

const MAX_BODY = 512 * 1024;
const MAX_FAILS = 5; // tentativas de login falhas...
const FAIL_WINDOW_MIN = 15; // ...dentro desta janela bloqueiam novas tentativas

let _sql = null;

/**
 * Injeta uma implementação de SQL (usada só pelos testes).
 *
 * A conexão vive em variável de módulo para não reconectar a cada requisição fria.
 * O efeito colateral é que a suíte não teria como testar as rotas de recuperação
 * sem um banco de verdade. Este gancho resolve isso; `null` restaura o normal.
 * Nada em produção chama esta função.
 */
export function _setSqlForTests(fake) {
    _sql = fake || null;
}

export function getSql() {
    if (!_sql) {
        const url = process.env.DATABASE_URL;
        if (!url) throw new HttpError(500, 'DATABASE_URL não configurada no servidor');
        _sql = neon(url);
    }
    return _sql;
}

class HttpError extends Error {
    constructor(status, message, extra = {}) {
        super(message);
        this.status = status;
        this.extra = extra;
    }
}

function send(res, status, body, headers = {}) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    res.end(JSON.stringify(body));
}

async function readBody(req) {
    if (req.body !== undefined && req.body !== null) {
        if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
        return req.body;
    }
    const chunks = [];
    let size = 0;
    for await (const c of req) {
        size += c.length;
        if (size > MAX_BODY) throw new HttpError(413, 'Requisição muito grande');
        chunks.push(c);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : {};
}

const isSecure = req => req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';

const normalizeEmail = value =>
    String(value || '')
        .trim()
        .toLowerCase();

/**
 * Usuário exposto para o cliente.
 *
 * `emailVerified` indefinido (coluna ausente porque o schema novo ainda não rodou)
 * conta como verificado: sem a migração não existe verificação, e mostrar aviso
 * permanente para todo mundo por causa disso seria pior que o aviso em si.
 */
const publicUser = u => ({
    id: Number(u.id),
    name: u.name,
    email: u.email,
    role: u.role,
    createdAt: u.created_at,
    emailVerified: u.email_verified === undefined ? true : Boolean(u.email_verified),
    emailVerifiedAt: u.email_verified_at || null
});

/** Base pública para montar os links que vão no e-mail. */
function publicBaseUrl(req) {
    const configured = process.env.APP_BASE_URL;
    if (configured) return String(configured).replace(/\/+$/, '');
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
        .split(',')[0]
        .trim();
    const proto = String(req.headers['x-forwarded-proto'] || (process.env.NODE_ENV === 'production' ? 'https' : 'http'))
        .split(',')[0]
        .trim();
    return `${proto}://${host || 'localhost'}`;
}

// ---------------------------------------------------------------- sessão
async function getSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return null;
    const sql = getSql();
    const rows = await sql.query(
        `SELECT s.id AS session_id, s.expires_at, u.id, u.name, u.email, u.role, u.created_at,
                u.email_verified, u.email_verified_at
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token = $1 LIMIT 1`,
        [hashToken(token)]
    );
    const row = rows[0];
    if (!row) return null;
    if (new Date(row.expires_at) < new Date()) {
        await sql.query('DELETE FROM sessions WHERE id = $1', [row.session_id]);
        return null;
    }
    return { sessionId: Number(row.session_id), user: publicUser(row) };
}

async function requireSession(req) {
    const s = await getSession(req);
    if (!s) throw new HttpError(401, 'Não autenticado');
    return s;
}

async function createSession(req, res, userId, remember) {
    const sql = getSql();
    const token = generateToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
    const rows = await sql.query('INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3) RETURNING id', [
        userId,
        hashToken(token),
        expires.toISOString()
    ]);
    // limpeza oportunista de sessões e tentativas expiradas
    sql.query('DELETE FROM sessions WHERE expires_at < NOW()').catch(() => {});
    sql.query(`DELETE FROM login_attempts WHERE at < NOW() - INTERVAL '1 day'`).catch(() => {});
    res.setHeader('Set-Cookie', buildCookie(token, { remember, secure: isSecure(req) }));
    return Number(rows[0].id);
}

// ---------------------------------------------------------------- rate limit
async function assertNotLocked(ip, email) {
    const rows = await getSql().query(
        `SELECT COUNT(*)::int AS n FROM login_attempts
          WHERE at > NOW() - ($3 || ' minutes')::interval AND (ip = $1 OR email = $2)`,
        [ip, email, String(FAIL_WINDOW_MIN)]
    );
    if (rows[0].n >= MAX_FAILS) {
        throw new HttpError(429, `Muitas tentativas. Tente novamente em ${FAIL_WINDOW_MIN} minutos.`);
    }
}
const recordFail = (ip, email) => getSql().query('INSERT INTO login_attempts (ip, email) VALUES ($1, $2)', [ip, email]);
const clearFails = email => getSql().query('DELETE FROM login_attempts WHERE email = $1', [email]);

// ------------------------------------------------- recuperação de conta
/**
 * Limite por e-mail **e** por IP.
 *
 * Por e-mail: o alvo é a caixa de entrada de uma pessoa específica — três
 * mensagens por hora já é mais do que o suficiente para recuperar a senha.
 * Por IP: sem isso, um script com 10 mil endereços diferentes inundaria 10 mil
 * caixas passando pelo limite de e-mail de cada uma.
 *
 * O erro é 429 nas duas contagens, sem dizer qual estourou.
 */
async function assertRecoveryAllowed({ ip, email, kind, maxEmail, maxIp }) {
    const rows = await getSql().query(
        `SELECT COUNT(*) FILTER (WHERE email = $1)::int AS by_email,
                COUNT(*) FILTER (WHERE ip = $2)::int AS by_ip
           FROM recovery_requests
          WHERE kind = $3 AND at > NOW() - INTERVAL '1 hour'`,
        [email, ip, kind]
    );
    const row = rows[0] || {};
    if (Number(row.by_email) >= maxEmail || Number(row.by_ip) >= maxIp) {
        throw new HttpError(429, 'Muitos pedidos em pouco tempo. Tente novamente em 1 hora.');
    }
}

const recordRecoveryRequest = ({ ip, email, kind }) =>
    getSql().query('INSERT INTO recovery_requests (ip, email, kind) VALUES ($1, $2, $3)', [ip, email, kind]);

/** Emite (e grava o hash de) um token de verificação, invalidando os anteriores. */
async function issueVerificationToken(sql, user) {
    const token = generateToken();
    await sql.transaction([
        sql.query('DELETE FROM email_verifications WHERE user_id = $1', [user.id]),
        sql.query('INSERT INTO email_verifications (user_id, token, expires_at) VALUES ($1, $2, $3)', [
            user.id,
            hashToken(token),
            verifyTokenExpiry().toISOString()
        ])
    ]);
    return token;
}

/**
 * Enfileira o e-mail sem esperar a entrega.
 *
 * O `void` é a parte importante: se a resposta esperasse o provedor, quem pede a
 * redefinição de um e-mail cadastrado demoraria centenas de milissegundos e quem
 * pede de um e-mail qualquer responderia na hora — diferença de tempo que diz
 * "esta conta existe". Com o envio fora do caminho da resposta, os dois casos
 * respondem igual e em tempo igual.
 */
function queueEmail(build, context) {
    try {
        const message = build();
        void sendEmail(message).catch(error => console.error(`[email] ${context}:`, error?.message || error));
    } catch (error) {
        console.error(`[email] falha ao montar a mensagem (${context}):`, error?.message || error);
    }
}

// ---------------------------------------------------------------- auth
const GENERIC_LOGIN_ERROR = 'E-mail ou senha incorretos';

/** Resposta do pedido de redefinição — idêntica exista ou não a conta. */
const GENERIC_RESET_SENT =
    'Se este e-mail estiver cadastrado, enviamos um link para redefinir a senha. Confira também a caixa de spam.';

/** Mesma mensagem para token inexistente, expirado, usado ou malformado. */
const INVALID_RESET_MESSAGE = 'Link de redefinição inválido ou expirado. Peça um novo.';
const INVALID_VERIFY_MESSAGE = 'Link de confirmação inválido ou expirado. Peça um novo pela tela inicial.';
/** Só aparece para quem já tem sessão válida — não é oráculo de existência de conta. */
const LEGACY_EXPIRED_MESSAGE =
    `Sua senha está no formato antigo, desativado em ${LEGACY_HASH_SUNSET_LABEL}. ` +
    'Defina uma senha nova entrando em contato com o suporte do projeto.';

const auth = {
    async register(req, res, body) {
        const name = String(body.name || '').trim();
        const email = String(body.email || '')
            .trim()
            .toLowerCase();
        const password = String(body.password || '');
        if (name.length < 3 || name.length > 100) throw new HttpError(400, 'Nome deve ter entre 3 e 100 caracteres');
        if (!isValidEmail(email)) throw new HttpError(400, 'E-mail inválido');
        if (password.length < 8 || password.length > 128)
            throw new HttpError(400, 'Senha deve ter entre 8 e 128 caracteres');

        const sql = getSql();
        const hash = await hashPassword(password);
        const rows = await sql.query(
            `INSERT INTO users (name, email, password) VALUES ($1, $2, $3)
             ON CONFLICT (email) DO NOTHING RETURNING id`,
            [name, email, hash]
        );
        if (!rows[0]) throw new HttpError(409, 'E-mail já cadastrado');
        const userId = rows[0].id;
        await sql.transaction([
            sql.query('INSERT INTO user_stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]),
            sql.query('INSERT INTO auto_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId])
        ]);

        // Verificação de e-mail: a conta já existe e funciona, mas o endereço
        // ainda não foi provado. Falha aqui não derruba o cadastro — só informa
        // que o e-mail não saiu (`verificationSent: false`), e a tela pede para
        // reenviar depois. Fingir que enviou seria pior.
        let verificationSent = false;
        if (isEmailConfigured()) {
            try {
                const token = await issueVerificationToken(sql, { id: userId });
                queueEmail(
                    () => verifyEmailMessage({ to: email, name, link: buildVerifyLink(publicBaseUrl(req), token) }),
                    `verificação user=${userId}`
                );
                verificationSent = true;
            } catch (error) {
                console.error(`[auth] não foi possível emitir a verificação para user=${userId}:`, error);
            }
        }
        return { success: true, verificationSent, emailConfigured: isEmailConfigured() };
    },

    async login(req, res, body) {
        const email = String(body.email || '')
            .trim()
            .toLowerCase();
        const password = String(body.password || '');
        const ip = clientIp(req);
        if (!email || !password) throw new HttpError(400, GENERIC_LOGIN_ERROR);
        await assertNotLocked(ip, email);

        const sql = getSql();
        const rows = await sql.query('SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1', [email]);
        const user = rows[0];
        const check = user ? await verifyPassword(password, user.password) : { ok: false };
        if (check.legacyExpired) {
            // Item 6.12: o formato `h_…` deixou de ser aceito em LEGACY_HASH_SUNSET_LABEL.
            // A resposta é a MESMA de senha errada: dizer "sua conta é antiga"
            // transformaria qualquer senha num oráculo de existência de conta.
            console.warn(
                `[auth] login recusado: conta ${user.id} ainda tem hash legado (formato desativado em ${LEGACY_HASH_SUNSET_LABEL})`
            );
            await recordFail(ip, email);
            throw new HttpError(401, GENERIC_LOGIN_ERROR, { field: 'password' });
        }
        if (!check.ok) {
            await recordFail(ip, email);
            throw new HttpError(401, GENERIC_LOGIN_ERROR, { field: 'password' });
        }
        if (check.upgradedHash) {
            await sql.query('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [
                check.upgradedHash,
                user.id
            ]);
        }
        if (check.legacy) {
            console.warn(`[auth] conta ${user.id}: hash legado convertido para bcrypt; peça uma senha nova ao usuário`);
        }
        await clearFails(email);
        const sessionId = await createSession(req, res, user.id, Boolean(body.remember));
        return {
            success: true,
            user: publicUser(user),
            session: { id: sessionId },
            // A tela usa isto para pedir uma senha nova na hora (item 6.12).
            passwordUpgraded: Boolean(check.legacy)
        };
    },

    async me(req) {
        const s = await getSession(req);
        return s ? { user: s.user, session: { id: s.sessionId } } : { user: null };
    },

    async logout(req, res) {
        const s = await getSession(req);
        if (s) await getSql().query('DELETE FROM sessions WHERE id = $1', [s.sessionId]);
        res.setHeader('Set-Cookie', clearCookie(isSecure(req)));
        return { success: true };
    },

    async changePassword(req, res, body) {
        const s = await requireSession(req);
        const current = String(body.currentPass || '');
        const next = String(body.newPass || '');
        if (next.length < 8 || next.length > 128) throw new HttpError(400, 'Senha deve ter entre 8 e 128 caracteres');
        const sql = getSql();
        const rows = await sql.query('SELECT password FROM users WHERE id = $1', [s.user.id]);
        const check = await verifyPassword(current, rows[0]?.password);
        if (check.legacyExpired) throw new HttpError(400, LEGACY_EXPIRED_MESSAGE);
        if (!check.ok) throw new HttpError(400, 'Senha atual incorreta');
        await sql.query('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [
            await hashPassword(next),
            s.user.id
        ]);
        await sql.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [s.user.id, s.sessionId]);
        return { success: true };
    },

    async deleteAccount(req, res, body) {
        const s = await requireSession(req);
        const password = String(body.password || '');
        const sql = getSql();
        const rows = await sql.query('SELECT password FROM users WHERE id = $1', [s.user.id]);
        const check = await verifyPassword(password, rows[0]?.password);
        if (check.legacyExpired) throw new HttpError(400, LEGACY_EXPIRED_MESSAGE);
        if (!check.ok) throw new HttpError(400, 'Senha incorreta');
        // ON DELETE CASCADE remove sessions, games, simulations, user_stats, auto_settings, auto_log
        await sql.query('DELETE FROM users WHERE id = $1', [s.user.id]);
        res.setHeader('Set-Cookie', clearCookie(isSecure(req)));
        return { success: true };
    },

    /**
     * Pedido de redefinição de senha.
     *
     * A resposta é **sempre a mesma** — exista a conta ou não. É a única forma de
     * o formulário não virar um verificador de e-mails cadastrados, que é dado
     * pessoal de terceiro. O limite de pedidos também é aplicado antes de olhar
     * o banco: assim o 429 não depende de a conta existir.
     *
     * A ordem importa: configuração → limite → grava o pedido → consulta o banco.
     * Se o 503 de "não configurado" aparecesse só para contas reais, ele mesmo
     * seria o oráculo.
     */
    async forgotPassword(req, res, body) {
        const email = normalizeEmail(body.email);
        const ip = clientIp(req);
        if (!isValidEmail(email)) throw new HttpError(400, 'E-mail inválido');
        if (!isEmailConfigured()) throw new HttpError(503, EMAIL_NOT_CONFIGURED_MESSAGE);

        await assertRecoveryAllowed({
            ip,
            email,
            kind: 'reset',
            maxEmail: RESET_REQUESTS_PER_HOUR_PER_EMAIL,
            maxIp: RESET_REQUESTS_PER_HOUR_PER_IP
        });
        await recordRecoveryRequest({ ip, email, kind: 'reset' });

        const sql = getSql();
        const rows = await sql.query('SELECT id, name, email FROM users WHERE LOWER(email) = $1 LIMIT 1', [email]);
        const user = rows[0];

        if (user) {
            try {
                const token = generateToken();
                await sql.transaction([
                    // Pedir de novo invalida o link anterior: dois links válidos ao
                    // mesmo tempo dobram o que um atacante com a caixa postal pode usar.
                    sql.query('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL', [user.id]),
                    sql.query('INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)', [
                        user.id,
                        hashToken(token),
                        resetTokenExpiry().toISOString()
                    ])
                ]);
                queueEmail(
                    () =>
                        resetPasswordMessage({
                            to: user.email,
                            name: user.name,
                            link: buildResetLink(publicBaseUrl(req), token)
                        }),
                    `reset user=${user.id}`
                );
                console.warn(`[auth] pedido de redefinição emitido para ${redactEmail(email)}`);
            } catch (error) {
                // Falha ao gravar/enviar não pode virar resposta diferente: seria
                // o mesmo oráculo pela porta dos fundos.
                console.error('[auth] falha ao emitir redefinição:', error);
            }
        }

        return { success: true, message: GENERIC_RESET_SENT };
    },

    /**
     * Consome o token e troca a senha.
     *
     * Token inválido, expirado, já usado ou de formato errado devolvem **a mesma**
     * mensagem: distinguir "não existe" de "expirou" contaria ao atacante qual
     * palpite chegou perto. Tudo é 400 com o mesmo texto.
     */
    async resetPassword(req, res, body) {
        const token = String(body.token || '').trim();
        const password = String(body.password || '');
        if (!isValidRecoveryToken(token)) throw new HttpError(400, INVALID_RESET_MESSAGE);

        const problem = passwordProblem(password);
        if (problem) throw new HttpError(400, problem);

        const sql = getSql();
        // O e-mail vem junto só para limpar o bloqueio de força bruta da conta:
        // quem provou posse da caixa postal provou que não é um atacante de fora.
        const rows = await sql.query(
            `SELECT r.id, r.user_id, r.expires_at, r.used_at, u.email
               FROM password_resets r JOIN users u ON u.id = r.user_id
              WHERE r.token = $1 LIMIT 1`,
            [hashToken(token)]
        );
        const row = rows[0];
        if (!row || row.used_at || isTokenExpired(row.expires_at)) throw new HttpError(400, INVALID_RESET_MESSAGE);

        await sql.transaction([
            sql.query(
                `UPDATE users
                    SET password = $1,
                        email_verified = TRUE,
                        email_verified_at = COALESCE(email_verified_at, NOW()),
                        updated_at = NOW()
                  WHERE id = $2`,
                [await hashPassword(password), row.user_id]
            ),
            sql.query('UPDATE password_resets SET used_at = NOW() WHERE id = $1', [row.id]),
            sql.query('DELETE FROM password_resets WHERE user_id = $1 AND id <> $2', [row.user_id, row.id]),
            // Senha trocada encerra as sessões: se o motivo do reset foi invasão,
            // deixar a sessão do invasor viva anularia a troca.
            sql.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]),
            sql.query('DELETE FROM email_verifications WHERE user_id = $1', [row.user_id])
        ]);
        await clearFails(normalizeEmail(row.email || ''));

        res.setHeader('Set-Cookie', clearCookie(isSecure(req)));
        return { success: true, message: 'Senha redefinida. Entre com a senha nova.' };
    },

    /** Confirma a posse do e-mail a partir do link. */
    async verifyEmail(req, res, body) {
        const token = String(body.token || '').trim();
        if (!isValidRecoveryToken(token)) throw new HttpError(400, INVALID_VERIFY_MESSAGE);

        const sql = getSql();
        const rows = await sql.query(
            'SELECT id, user_id, expires_at FROM email_verifications WHERE token = $1 LIMIT 1',
            [hashToken(token)]
        );
        const row = rows[0];
        if (!row || isTokenExpired(row.expires_at)) throw new HttpError(400, INVALID_VERIFY_MESSAGE);

        await sql.transaction([
            sql.query(
                `UPDATE users
                    SET email_verified = TRUE,
                        email_verified_at = COALESCE(email_verified_at, NOW()),
                        updated_at = NOW()
                  WHERE id = $1`,
                [row.user_id]
            ),
            sql.query('DELETE FROM email_verifications WHERE user_id = $1', [row.user_id])
        ]);
        return { success: true, message: 'E-mail confirmado.' };
    },

    /** Reenvia o link de verificação para quem já está logado. */
    async resendVerification(req, _res, _body) {
        const s = await requireSession(req);
        if (!isEmailConfigured()) throw new HttpError(503, EMAIL_NOT_CONFIGURED_MESSAGE);
        if (s.user.emailVerified) return { success: true, alreadyVerified: true, verificationSent: false };

        const ip = clientIp(req);
        await assertRecoveryAllowed({
            ip,
            email: normalizeEmail(s.user.email),
            kind: 'verify',
            maxEmail: VERIFY_RESENDS_PER_HOUR,
            maxIp: RESET_REQUESTS_PER_HOUR_PER_IP
        });
        await recordRecoveryRequest({ ip, email: normalizeEmail(s.user.email), kind: 'verify' });

        const sql = getSql();
        const token = await issueVerificationToken(sql, { id: s.user.id });
        queueEmail(
            () =>
                verifyEmailMessage({
                    to: s.user.email,
                    name: s.user.name,
                    link: buildVerifyLink(publicBaseUrl(req), token)
                }),
            `reenvio verificação user=${s.user.id}`
        );
        return { success: true, verificationSent: true };
    }
};

// ---------------------------------------------------------------- dados
function indexColumn(cfg, name) {
    const col = toSnake(String(name || ''));
    if (!cfg.indexes.includes(col)) throw new HttpError(400, 'Índice não permitido');
    return col;
}

function assertTable(store) {
    if (!Object.hasOwn(TABLES, store)) throw new HttpError(403, 'Tabela não permitida');
    return TABLES[store];
}

function scope(cfg, userId, params, startIdx) {
    if (!cfg.owner) return { sql: '', params };
    params.push(userId);
    return { sql: ` AND "${cfg.owner}" = $${startIdx}`, params };
}

const dbOps = {
    async add(session, { store, data }) {
        const cfg = assertTable(store);
        const payload = sanitizePayload(store, data);
        if (cfg.owner) payload[cfg.owner] = session.user.id;
        const cols = Object.keys(payload);
        if (!cols.length) throw new HttpError(400, 'Dados vazios');
        const names = cols.map(c => `"${c}"`).join(', ');
        const ph = cols.map((_, i) => `$${i + 1}`).join(', ');
        let conflict = '';
        if (cfg.conflict) {
            const upd = cols
                .filter(c => !['lottery_type', 'concurso'].includes(c))
                .map(c => `"${c}" = EXCLUDED."${c}"`);
            conflict = upd.length
                ? ` ON CONFLICT ${cfg.conflict} DO UPDATE SET ${upd.join(', ')}`
                : ` ON CONFLICT ${cfg.conflict} DO NOTHING`;
        } else if (cfg.pk === cfg.owner) {
            const upd = cols.filter(c => c !== cfg.pk).map(c => `"${c}" = EXCLUDED."${c}"`);
            conflict = upd.length
                ? ` ON CONFLICT ("${cfg.pk}") DO UPDATE SET ${upd.join(', ')}`
                : ` ON CONFLICT ("${cfg.pk}") DO NOTHING`;
        }
        const rows = await getSql().query(
            `INSERT INTO "${store}" (${names}) VALUES (${ph})${conflict} RETURNING *`,
            cols.map(c => payload[c])
        );
        const r = rowToCamel(rows[0] || {});
        return { result: r.id ?? r.userId ?? 0 };
    },

    /** Multi-row INSERT real em uma única query HTTP no Neon (10x menos latência). */
    async addMany(session, { store, items }) {
        if (!Array.isArray(items) || items.length === 0) return { result: [] };
        if (items.length > 200) throw new HttpError(400, 'Lote muito grande');
        const cfg = assertTable(store);

        const payloads = items.map(d => {
            const p = sanitizePayload(store, d);
            if (cfg.owner) p[cfg.owner] = session.user.id;
            return p;
        });

        // União ordenada das colunas presentes no lote
        const colSet = new Set();
        for (const p of payloads) for (const k of Object.keys(p)) colSet.add(k);
        const cols = [...colSet];
        if (!cols.length) throw new HttpError(400, 'Dados vazios');

        const names = cols.map(c => `"${c}"`).join(', ');
        const values = [];
        const tuples = payloads.map((p, rowIdx) => {
            const base = rowIdx * cols.length;
            const placeholders = cols.map((c, colIdx) => {
                values.push(p[c] !== undefined ? p[c] : null);
                return `$${base + colIdx + 1}`;
            });
            return `(${placeholders.join(', ')})`;
        });

        let conflict = '';
        if (cfg.conflict) {
            const upd = cols
                .filter(c => !['lottery_type', 'concurso'].includes(c))
                .map(c => `"${c}" = EXCLUDED."${c}"`);
            conflict = upd.length
                ? ` ON CONFLICT ${cfg.conflict} DO UPDATE SET ${upd.join(', ')}`
                : ` ON CONFLICT ${cfg.conflict} DO NOTHING`;
        }

        const rows = await getSql().query(
            `INSERT INTO "${store}" (${names}) VALUES ${tuples.join(', ')}${conflict} RETURNING "${cfg.pk}"`,
            values
        );
        return { result: rows.map(r => Number(r[cfg.pk])) };
    },

    /** Atualização atômica de contadores do usuário (sem race condition read-modify-write). */
    async incrementStats(session, { gamesDelta = 0, simulationsDelta = 0, resultsAnalyzed = null }) {
        const gDelta = Math.max(0, parseInt(gamesDelta, 10) || 0);
        const sDelta = Math.max(0, parseInt(simulationsDelta, 10) || 0);
        const hasResults = resultsAnalyzed !== null && resultsAnalyzed !== undefined;
        const rVal = hasResults ? Math.max(0, parseInt(resultsAnalyzed, 10) || 0) : 0;

        const rows = await getSql().query(
            `INSERT INTO user_stats (user_id, games_generated, simulations, results_analyzed, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (user_id) DO UPDATE SET
               games_generated = user_stats.games_generated + EXCLUDED.games_generated,
               simulations = user_stats.simulations + EXCLUDED.simulations,
               results_analyzed = CASE WHEN $5::boolean THEN EXCLUDED.results_analyzed ELSE user_stats.results_analyzed END,
               updated_at = NOW()
             RETURNING *`,
            [session.user.id, gDelta, sDelta, rVal, hasResults]
        );
        return { result: rowToCamel(rows[0] || {}) };
    },

    async get(session, { store, id }) {
        const cfg = assertTable(store);
        const params = [id];
        const sc = scope(cfg, session.user.id, params, 2);
        const rows = await getSql().query(
            `SELECT * FROM "${store}" WHERE "${cfg.pk}" = $1${sc.sql} LIMIT 1`,
            sc.params
        );
        return { result: rows[0] ? rowToCamel(rows[0]) : null };
    },

    async getAllByIndex(session, { store, index, value }) {
        const cfg = assertTable(store);
        const col = indexColumn(cfg, index);
        const params = [value];
        const sc = scope(cfg, session.user.id, params, 2);
        const rows = await getSql().query(
            `SELECT * FROM "${store}" WHERE "${col}" = $1${sc.sql} ORDER BY ${cfg.order}`,
            sc.params
        );
        return { result: rows.map(rowToCamel) };
    },

    async getByIndex(session, { store, index, value }) {
        const r = await dbOps.getAllByIndex(session, { store, index, value });
        return { result: r.result[0] || null };
    },

    async update(session, { store, data }) {
        const cfg = assertTable(store);
        if (cfg.noUpdate) throw new HttpError(403, 'Atualização não permitida');
        const payload = sanitizePayload(store, data);
        const id = cfg.pk === cfg.owner ? session.user.id : data?.id;
        if (!id) return dbOps.add(session, { store, data });
        const cols = Object.keys(payload).filter(c => c !== cfg.pk && c !== cfg.owner);
        if (!cols.length) return { result: null };
        const params = cols.map(c => payload[c]);
        params.push(id);
        const sc = scope(cfg, session.user.id, params, params.length + 1);
        const set = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
        const rows = await getSql().query(
            `UPDATE "${store}" SET ${set} WHERE "${cfg.pk}" = $${cols.length + 1}${sc.sql} RETURNING *`,
            sc.params
        );
        return { result: rows[0] ? rowToCamel(rows[0]) : null };
    },

    async delete(session, { store, id }) {
        const cfg = assertTable(store);
        if (cfg.noUpdate) throw new HttpError(403, 'Remoção não permitida');
        const params = [id];
        const sc = scope(cfg, session.user.id, params, 2);
        await getSql().query(`DELETE FROM "${store}" WHERE "${cfg.pk}" = $1${sc.sql}`, sc.params);
        return { result: null };
    },

    async count(session, { store }) {
        if (store === 'users' || store === 'sessions') {
            if (session.user.role !== 'admin') return { result: 0 };
            const rows = await getSql().query(`SELECT COUNT(*)::int AS count FROM "${store}"`);
            return { result: rows[0].count };
        }
        const cfg = assertTable(store);
        const params = [];
        let where = '';
        if (cfg.owner) {
            params.push(session.user.id);
            where = ` WHERE "${cfg.owner}" = $1`;
        }
        const rows = await getSql().query(`SELECT COUNT(*)::int AS count FROM "${store}"${where}`, params);
        return { result: rows[0].count };
    }
};

// ---------------------------------------------------------------- roteador
export async function handler(req, res) {
    try {
        const url = new URL(req.url, 'http://localhost');
        const path = url.pathname.replace(/\/+$/, '');
        const method = req.method;

        // Limite por rota antes de qualquer trabalho: é o único ponto por onde toda
        // requisição passa, e contar depois de consultar o banco seria contar o que
        // o abuso já causou.
        const dbMatch = path.match(/^\/api\/db\/(\w+)$/);
        const dbOp = dbMatch && Object.hasOwn(dbOps, dbMatch[1]) ? dbMatch[1] : null;
        const limit = limitForRequest({ path, method, dbOp });
        if (limit) {
            const key = clientIp(req);
            let outcome = null;
            try {
                outcome = await consumeRateLimit(getSql(), limit, { key });
            } catch (error) {
                // Sem `DATABASE_URL` o contador não existe — e sem banco nenhuma rota
                // funciona mesmo. Deixar esse erro subir trocaria a resposta útil do
                // roteador (401, 503) por um 500 de infraestrutura.
                if (!(error instanceof HttpError) || !/DATABASE_URL/.test(error.message)) throw error;
                console.warn('[rate-limit] DATABASE_URL ausente: limite ignorado nesta requisição');
            }
            if (outcome) {
                res.setHeader('X-RateLimit-Limit', String(outcome.max));
                res.setHeader('X-RateLimit-Remaining', String(outcome.remaining));
                if (!outcome.allowed) {
                    res.setHeader('Retry-After', String(outcome.retryAfterSeconds));
                    throw new HttpError(429, rateLimitMessage(limit), { retryAfter: outcome.retryAfterSeconds });
                }
            }
        }

        if (path === '/api/health' && method === 'GET') {
            await getSql().query('SELECT 1');
            return send(res, 200, { ok: true });
        }
        if (method !== 'POST' && !(method === 'GET' && path === '/api/auth/me')) {
            throw new HttpError(405, 'Método não permitido');
        }
        if (method === 'POST') {
            if (!hasJsonContentType(req)) {
                throw new HttpError(415, 'Content-Type deve ser application/json');
            }
            // Item 6.13: a checagem anterior era `if (origin && ...)` — passava sem
            // Origin (fail-open) e devolvia 500 para `Origin: null`. Agora é
            // fail-closed e olha também o Sec-Fetch-Site, que a página não forja.
            const originCheck = evaluateSameSiteRequest(req, {
                allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS)
            });
            if (!originCheck.allowed) {
                throw new HttpError(403, 'Origem não permitida', { reason: originCheck.reason });
            }
        }

        let body = {};
        if (method === 'POST') {
            try {
                body = await readBody(req);
            } catch (e) {
                if (e instanceof HttpError) throw e;
                throw new HttpError(400, 'JSON inválido');
            }
        }

        const routes = {
            '/api/auth/register': () => auth.register(req, res, body),
            '/api/auth/login': () => auth.login(req, res, body),
            '/api/auth/me': () => auth.me(req),
            '/api/auth/logout': () => auth.logout(req, res),
            '/api/auth/change-password': () => auth.changePassword(req, res, body),
            '/api/auth/delete-account': () => auth.deleteAccount(req, res, body),
            '/api/auth/forgot-password': () => auth.forgotPassword(req, res, body),
            '/api/auth/reset-password': () => auth.resetPassword(req, res, body),
            '/api/auth/verify-email': () => auth.verifyEmail(req, res, body),
            '/api/auth/resend-verification': () => auth.resendVerification(req, res, body)
        };
        if (Object.hasOwn(routes, path)) return send(res, 200, await routes[path]());

        if (path === '/api/lottery/sync' && method === 'POST') {
            await requireSession(req);
            return send(res, 200, await syncLotteries(getSql(), body));
        }

        if (dbOp) {
            const session = await requireSession(req);
            return send(res, 200, await dbOps[dbOp](session, body));
        }
        throw new HttpError(404, 'Rota não encontrada');
    } catch (e) {
        if (e instanceof HttpError) return send(res, e.status, { success: false, error: e.message, ...e.extra });
        console.error('[api] erro interno:', e);
        return send(res, 500, { success: false, error: 'Erro interno do servidor' });
    }
}
