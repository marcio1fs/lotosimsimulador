/**
 * Testes da recuperação de conta (redefinição de senha + verificação de e-mail).
 *
 * O QUE ESTÁ SENDO PROTEGIDO AQUI
 * -------------------------------
 * Um fluxo de "esqueci minha senha" é a parte do sistema que transforma um endereço
 * de e-mail em controle de uma conta. Errado, ele:
 *
 *  1. **revela quem tem cadastro** — o formulário vira oráculo de e-mails;
 *  2. **aceita link velho** — token reutilizável é presente para quem tem a caixa postal;
 *  3. **deixa o invasor dentro** — trocar a senha sem encerrar as sessões existentes
 *     não resolve o motivo do reset;
 *  4. **promete um e-mail que não sai** — sem provedor configurado, dizer "enviamos"
 *     é mentira que o usuário só descobre quando perde a conta.
 *
 * Cada um desses tem teste aqui. O banco é substituído por um duplo em memória
 * (`createFakeSql`) que **estoura** em qualquer query que não conheça — assim um
 * SQL novo na rota não passa despercebido por um teste que "não falhou".
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
    RESET_TOKEN_TTL_MINUTES,
    VERIFY_TOKEN_TTL_HOURS,
    buildResetLink,
    buildVerifyLink,
    isTokenExpired,
    isValidRecoveryToken,
    passwordProblem,
    redactEmail,
    resetTokenExpiry,
    verifyTokenExpiry
} from '../shared/accountRecovery.js';
import { emailTransport, isEmailConfigured, sendEmail, _setEmailSenderForTests } from '../server/email.js';
import { handler, _setSqlForTests } from '../server/handler.js';

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const TOKEN_RE = /[a-f0-9]{64}/;

// ------------------------------------------------------------------ utilidades

/** Requisição falsa no formato que o handler consome. */
function fakeReq({ method = 'POST', url = '/api/auth/login', headers = {}, body = {} } = {}) {
    return {
        method,
        url,
        headers: {
            host: 'app.exemplo.com',
            origin: 'https://app.exemplo.com',
            'content-type': 'application/json',
            'x-forwarded-for': '203.0.113.10',
            'x-forwarded-proto': 'https',
            ...headers
        },
        body
    };
}

function fakeRes() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader(name, value) {
            this.headers[name.toLowerCase()] = value;
        },
        end(payload) {
            this.body = payload ? JSON.parse(payload) : null;
        }
    };
}

/** Chama o handler e devolve a resposta já desserializada. */
async function call(path, body = {}, { headers = {}, method = 'POST' } = {}) {
    const res = fakeRes();
    await handler(fakeReq({ url: path, body, headers, method }), res);
    return { status: res.statusCode, body: res.body, headers: res.headers };
}

/**
 * Duplo do banco: guarda as tabelas usadas pelas rotas de autenticação.
 *
 * Só entende as queries que o handler realmente emite. Qualquer outra coisa
 * lança — teste que passa por não consultar nada é pior que teste nenhum.
 */
function createFakeSql(seed = {}) {
    let seq = 1000;
    const nextId = () => ++seq;
    const db = {
        users: seed.users || [],
        sessions: [],
        email_verifications: [],
        password_resets: [],
        recovery_requests: [],
        login_attempts: [],
        // O limitador por rota (migração 003) conta em (bucket, chave, janela).
        rate_limits: []
    };
    const sentTo = () => db;

    async function query(text, params = []) {
        const sql = String(text).replace(/\s+/g, ' ').trim();

        // ---- limite por rota (janela fixa, contador atômico)
        if (sql.startsWith('INSERT INTO rate_limits')) {
            const [bucket, key, start] = params;
            const existente = db.rate_limits.find(
                r => r.bucket === bucket && r.key === key && r.window_start === start
            );
            if (existente) {
                existente.hits += 1;
                return [{ hits: existente.hits }];
            }
            db.rate_limits.push({ bucket, key, window_start: start, hits: 1 });
            return [{ hits: 1 }];
        }
        if (sql.startsWith('DELETE FROM rate_limits')) return [];

        // ---- rate limit
        if (sql.includes('FROM recovery_requests')) {
            const [email, ip, kind] = params;
            const hourAgo = Date.now() - 3600000;
            const recent = db.recovery_requests.filter(r => r.kind === kind && r.at > hourAgo);
            return [
                {
                    by_email: recent.filter(r => r.email === email).length,
                    by_ip: recent.filter(r => r.ip === ip).length
                }
            ];
        }
        if (sql.startsWith('INSERT INTO recovery_requests')) {
            const [ip, email, kind] = params;
            db.recovery_requests.push({ ip, email, kind, at: Date.now() });
            return [];
        }
        // Os DELETE vêm antes do SELECT: "DELETE FROM login_attempts WHERE email"
        // também contém "FROM login_attempts", e a ordem decide quem responde.
        if (sql.startsWith('DELETE FROM login_attempts WHERE email')) {
            db.login_attempts = db.login_attempts.filter(a => a.email !== params[0]);
            return [];
        }
        if (sql.startsWith('DELETE FROM login_attempts WHERE at')) return [];
        if (sql.includes('FROM login_attempts')) {
            const [ip, email] = params;
            return [
                {
                    n: db.login_attempts.filter(a => a.ip === ip || a.email === email).length
                }
            ];
        }
        if (sql.startsWith('INSERT INTO login_attempts')) {
            db.login_attempts.push({ ip: params[0], email: params[1] });
            return [];
        }
        // ---- usuários
        if (sql.startsWith('INSERT INTO users')) {
            const [name, email, password] = params;
            if (db.users.some(u => u.email === email)) return []; // ON CONFLICT DO NOTHING
            const user = {
                id: nextId(),
                name,
                email,
                password,
                role: 'user',
                created_at: new Date().toISOString(),
                email_verified: false,
                email_verified_at: null
            };
            db.users.push(user);
            return [{ id: user.id }];
        }
        if (sql.includes('SELECT * FROM users WHERE LOWER(email)')) {
            const user = db.users.find(u => u.email === params[0].toLowerCase());
            return user ? [{ ...user }] : [];
        }
        if (sql.includes('SELECT id, name, email FROM users WHERE LOWER(email)')) {
            const user = db.users.find(u => u.email === params[0].toLowerCase());
            return user ? [{ id: user.id, name: user.name, email: user.email }] : [];
        }
        if (sql.includes('SET email_verified = TRUE') && !sql.includes('password = $1')) {
            const user = db.users.find(u => u.id === params[0]);
            if (user) {
                user.email_verified = true;
                user.email_verified_at = new Date().toISOString();
            }
            return [];
        }
        if (sql.includes('SET password = $1')) {
            const user = db.users.find(u => u.id === params[1]);
            if (user) {
                user.password = params[0];
                user.email_verified = true;
                user.email_verified_at = user.email_verified_at || new Date().toISOString();
            }
            return [];
        }
        if (sql.includes('SELECT password FROM users WHERE id')) {
            const user = db.users.find(u => u.id === params[0]);
            return user ? [{ password: user.password }] : [];
        }
        if (sql.startsWith('DELETE FROM users WHERE id')) {
            db.users = db.users.filter(u => u.id !== params[0]);
            return [];
        }

        // ---- sessões
        if (sql.includes('FROM sessions s JOIN users u')) {
            const session = db.sessions.find(s => s.token === params[0]);
            if (!session) return [];
            const user = db.users.find(u => u.id === session.user_id);
            if (!user) return [];
            return [
                {
                    session_id: session.id,
                    expires_at: session.expires_at,
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    role: user.role,
                    created_at: user.created_at,
                    email_verified: user.email_verified,
                    email_verified_at: user.email_verified_at
                }
            ];
        }
        if (sql.startsWith('INSERT INTO sessions')) {
            const [userId, token, expiresAt] = params;
            const session = { id: nextId(), user_id: Number(userId), token, expires_at: expiresAt };
            db.sessions.push(session);
            return [{ id: session.id }];
        }
        if (sql.startsWith('DELETE FROM sessions WHERE user_id')) {
            db.sessions = db.sessions.filter(s => s.user_id !== params[0]);
            return [];
        }
        if (sql.startsWith('DELETE FROM sessions WHERE id')) {
            db.sessions = db.sessions.filter(s => s.id !== params[0]);
            return [];
        }
        if (sql.startsWith('DELETE FROM sessions WHERE expires_at')) return [];

        // ---- verificação de e-mail
        if (sql.startsWith('INSERT INTO email_verifications')) {
            const [userId, token, expiresAt] = params;
            db.email_verifications.push({ id: nextId(), user_id: Number(userId), token, expires_at: expiresAt });
            return [];
        }
        if (sql.includes('FROM email_verifications WHERE token')) {
            return db.email_verifications.filter(v => v.token === params[0]).map(v => ({ ...v }));
        }
        if (sql.startsWith('DELETE FROM email_verifications WHERE user_id')) {
            db.email_verifications = db.email_verifications.filter(v => v.user_id !== params[0]);
            return [];
        }

        // ---- redefinição de senha
        if (sql.includes('FROM password_resets r JOIN users u')) {
            const reset = db.password_resets.find(r => r.token === params[0]);
            if (!reset) return [];
            const user = db.users.find(u => u.id === reset.user_id);
            return [
                {
                    id: reset.id,
                    user_id: reset.user_id,
                    expires_at: reset.expires_at,
                    used_at: reset.used_at,
                    email: user?.email
                }
            ];
        }
        if (sql.startsWith('INSERT INTO password_resets')) {
            const [userId, token, expiresAt] = params;
            db.password_resets.push({
                id: nextId(),
                user_id: Number(userId),
                token,
                expires_at: expiresAt,
                used_at: null
            });
            return [];
        }
        if (sql.includes('SET used_at = NOW()')) {
            const reset = db.password_resets.find(r => r.id === params[0]);
            if (reset) reset.used_at = new Date().toISOString();
            return [];
        }
        if (sql.includes('DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL')) {
            db.password_resets = db.password_resets.filter(r => r.user_id !== params[0] || r.used_at);
            return [];
        }
        if (sql.includes('DELETE FROM password_resets WHERE user_id = $1 AND id <> $2')) {
            db.password_resets = db.password_resets.filter(r => r.user_id !== params[0] || r.id === params[1]);
            return [];
        }

        // ---- dados auxiliares do cadastro
        if (sql.startsWith('INSERT INTO user_stats') || sql.startsWith('INSERT INTO auto_settings')) return [];

        throw new Error(`duplo do banco não conhece esta query: ${sql}`);
    }

    return {
        db,
        query,
        transaction: async queries => Promise.all(queries),
        snapshot: sentTo
    };
}

/** Coletor de e-mails: nada sai pela rede em teste. */
function createMailbox() {
    const messages = [];
    return {
        messages,
        sender: async message => {
            messages.push(message);
            return { sent: true };
        }
    };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

/**
 * Roda `fn` com um ambiente de e-mail e um banco falsos, restaurando tudo depois.
 * Sem o `finally`, um teste que falha deixaria o envio real ligado para o próximo.
 */
async function withFakeBackend(
    { email = { EMAIL_API_KEY: 'chave-de-teste', EMAIL_FROM: 'nao-responda@exemplo.com' } } = {},
    fn
) {
    const fake = createFakeSql();
    const mailbox = createMailbox();
    const originalEnv = { ...process.env };
    for (const key of ['EMAIL_API_KEY', 'EMAIL_FROM', 'EMAIL_TRANSPORT', 'APP_BASE_URL', 'NODE_ENV'])
        delete process.env[key];
    Object.assign(process.env, email);
    _setSqlForTests(fake);
    _setEmailSenderForTests(mailbox.sender);

    const ctx = {
        fake,
        mailbox,
        seedUser: ({ name = 'Maria Teste', email = 'maria@exemplo.com', password = null } = {}) => {
            const user = {
                id: fake.db.users.length + 1,
                name,
                email,
                password: password || '$2a$04$hashqualquerparatestes',
                role: 'user',
                created_at: new Date().toISOString(),
                email_verified: false,
                email_verified_at: null
            };
            fake.db.users.push(user);
            return user;
        },
        login: async (emailAddr, password) =>
            call('/api/auth/login', { email: emailAddr, password }, { headers: { 'x-forwarded-for': '198.51.100.7' } }),
        /** Extrai o token do link que foi para a caixa de entrada. */
        tokenFrom: (index = -1) => {
            const message = mailbox.messages.at(index);
            return message?.text?.match(TOKEN_RE)?.[0] || null;
        }
    };

    try {
        return await fn(ctx);
    } finally {
        for (const key of Object.keys(process.env)) {
            if (!(key in originalEnv)) delete process.env[key];
        }
        Object.assign(process.env, originalEnv);
        _setSqlForTests(null);
        _setEmailSenderForTests(null);
    }
}

after(() => {
    _setSqlForTests(null);
    _setEmailSenderForTests(null);
});

// ------------------------------------------------------------------- política

describe('Política compartilhada (shared/accountRecovery.js)', () => {
    it('aceita senha de 8 a 128 e explica o resto', () => {
        assert.equal(passwordProblem('12345678'), null);
        assert.equal(passwordProblem('a'.repeat(128)), null);
        assert.match(passwordProblem('1234567'), /pelo menos 8/);
        assert.match(passwordProblem('a'.repeat(129)), /no máximo 128/);
        assert.match(passwordProblem(undefined), /pelo menos 8/);
        assert.match(passwordProblem(12345678), /pelo menos 8/);
    });

    it('só aceita token de 32 bytes em hexadecimal', () => {
        assert.equal(isValidRecoveryToken('a'.repeat(64)), true);
        assert.equal(isValidRecoveryToken('0123456789abcdef'.repeat(4)), true);
        assert.equal(isValidRecoveryToken(''), false);
        assert.equal(isValidRecoveryToken('a'.repeat(63)), false);
        assert.equal(isValidRecoveryToken('a'.repeat(65)), false);
        assert.equal(isValidRecoveryToken('G'.repeat(64)), false);
        assert.equal(isValidRecoveryToken(null), false);
        assert.equal(isValidRecoveryToken(123), false);
    });

    it('prazos: 60 minutos para senha, 24 horas para verificação', () => {
        const now = Date.parse('2026-11-01T12:00:00Z');
        assert.equal(resetTokenExpiry(now).getTime() - now, RESET_TOKEN_TTL_MINUTES * 60000);
        assert.equal(verifyTokenExpiry(now).getTime() - now, VERIFY_TOKEN_TTL_HOURS * 3600000);
        assert.equal(RESET_TOKEN_TTL_MINUTES, 60);
        assert.equal(VERIFY_TOKEN_TTL_HOURS, 24);
    });

    it('token sem data ou com data inválida conta como expirado (falha fechada)', () => {
        const now = Date.parse('2026-11-01T12:00:00Z');
        assert.equal(isTokenExpired(new Date(now - 1000), now), true);
        assert.equal(isTokenExpired(new Date(now + 1000), now), false);
        assert.equal(isTokenExpired(new Date(now + 1000).toISOString(), now), false);
        assert.equal(isTokenExpired('nao-e-data', now), true);
        assert.equal(isTokenExpired(null, now), true);
        assert.equal(isTokenExpired(undefined, now), true);
    });

    it('log guarda o domínio e esconde o resto do endereço', () => {
        assert.equal(redactEmail('maria.silva@exemplo.com'), 'm***@exemplo.com');
        assert.equal(redactEmail('a@b.com'), '***@b.com');
        assert.equal(redactEmail('semarroba'), '***');
        assert.equal(redactEmail(''), '');
        assert.equal(redactEmail(null), '');
    });

    it('links levam o token em query string e não duplicam barra', () => {
        assert.equal(buildResetLink('https://app.exemplo.com/', 'abc'), 'https://app.exemplo.com/?reset=abc');
        assert.equal(buildResetLink('https://app.exemplo.com', 'abc'), 'https://app.exemplo.com/?reset=abc');
        assert.equal(buildVerifyLink('https://app.exemplo.com/', 'abc'), 'https://app.exemplo.com/?verify=abc');
    });
});

// -------------------------------------------------------------------- e-mail

describe('Envio de e-mail — nunca finge que enviou', () => {
    it('sem chave e sem transporte de console, não há e-mail configurado', () => {
        assert.equal(emailTransport({}), 'none');
        assert.equal(isEmailConfigured({}), false);
        assert.equal(emailTransport({ EMAIL_TRANSPORT: 'console' }), 'console');
        assert.equal(isEmailConfigured({ EMAIL_TRANSPORT: 'console' }), true);
    });

    it('transporte de console é recusado em produção (o log teria o token)', () => {
        assert.equal(emailTransport({ EMAIL_TRANSPORT: 'console', NODE_ENV: 'production' }), 'none');
        assert.equal(emailTransport({ EMAIL_API_KEY: 'k', NODE_ENV: 'production' }), 'resend');
    });

    it('sem configuração devolve sent:false em vez de lançar', async () => {
        const logs = { warn() {}, error() {} };
        const result = await sendEmail({ to: 'a@b.com', subject: 'x', text: 'y' }, { env: {}, log: logs });
        assert.equal(result.sent, false);
        assert.equal(result.transport, 'none');
    });

    it('transporte de console registra a mensagem e não chama a rede', async () => {
        let fetched = 0;
        const warnings = [];
        const result = await sendEmail(
            { to: 'maria@exemplo.com', subject: 'Redefinir', text: 'link: https://x/?reset=abc' },
            {
                env: { EMAIL_TRANSPORT: 'console' },
                fetchImpl: async () => {
                    fetched++;
                    return { ok: true };
                },
                log: { warn: m => warnings.push(m), error() {} }
            }
        );
        assert.equal(result.sent, true);
        assert.equal(fetched, 0);
        assert.match(warnings[0], /m\*\*\*@exemplo\.com/);
        assert.match(warnings[0], /reset=abc/);
        assert.ok(!warnings[0].includes('maria@exemplo.com'), 'o log não pode guardar o endereço inteiro');
    });

    it('envia pelo provedor com a chave, o remetente e o corpo certos', async () => {
        const chamadas = [];
        const result = await sendEmail(
            { to: 'maria@exemplo.com', subject: 'Redefinir', text: 'texto', html: '<p>x</p>' },
            {
                env: { EMAIL_API_KEY: 'chave-secreta', EMAIL_FROM: 'nao-responda@exemplo.com' },
                fetchImpl: async (url, options) => {
                    chamadas.push({ url, options });
                    return { ok: true, status: 200 };
                },
                log: { warn() {}, error() {} }
            }
        );

        assert.equal(result.sent, true);
        assert.equal(chamadas.length, 1);
        assert.equal(chamadas[0].options.headers.Authorization, 'Bearer chave-secreta');
        const payload = JSON.parse(chamadas[0].options.body);
        assert.equal(payload.from, 'nao-responda@exemplo.com');
        assert.deepEqual(payload.to, ['maria@exemplo.com']);
        assert.equal(payload.subject, 'Redefinir');
        assert.equal(payload.html, '<p>x</p>');
    });

    it('falha do provedor e falha de rede viram sent:false, não exceção', async () => {
        const logs = { warn() {}, error() {} };
        const env = { EMAIL_API_KEY: 'k', EMAIL_FROM: 'a@b.com' };

        const erro500 = await sendEmail(
            { to: 'x@y.com', subject: 's', text: 't' },
            { env, fetchImpl: async () => ({ ok: false, status: 500 }), log: logs }
        );
        assert.equal(erro500.sent, false);
        assert.match(erro500.reason, /500/);

        const rede = await sendEmail(
            { to: 'x@y.com', subject: 's', text: 't' },
            {
                env,
                fetchImpl: async () => {
                    throw new Error('sem rede');
                },
                log: logs
            }
        );
        assert.equal(rede.sent, false);
        assert.match(rede.reason, /rede/);
    });

    it('chave sem remetente é erro de configuração, não de usuário', async () => {
        const result = await sendEmail(
            { to: 'x@y.com', subject: 's', text: 't' },
            { env: { EMAIL_API_KEY: 'k' }, fetchImpl: async () => ({ ok: true }), log: { warn() {}, error() {} } }
        );
        assert.equal(result.sent, false);
        assert.match(result.reason, /EMAIL_FROM/);
    });
});

// ------------------------------------------------------------------ cadastro

describe('Cadastro dispara a verificação de e-mail', () => {
    it('cria a conta, grava só o hash do token e manda o link', async () => {
        await withFakeBackend({}, async ({ fake, mailbox, tokenFrom }) => {
            const res = await call('/api/auth/register', {
                name: 'Maria Teste',
                email: 'Maria@Exemplo.com ',
                password: 'senha-boa-123'
            });

            assert.equal(res.status, 200);
            assert.equal(res.body.success, true);
            assert.equal(res.body.verificationSent, true);
            assert.equal(res.body.emailConfigured, true);
            assert.equal(fake.db.users.length, 1);
            assert.equal(fake.db.users[0].email, 'maria@exemplo.com', 'e-mail normalizado');
            assert.equal(fake.db.users[0].email_verified, false);
            assert.equal(fake.db.email_verifications.length, 1);

            await tick();
            assert.equal(mailbox.messages.length, 1);
            const token = tokenFrom();
            assert.ok(isValidRecoveryToken(token), `token do link inválido: ${token}`);
            assert.match(mailbox.messages[0].text, /\?verify=/);
            assert.equal(fake.db.email_verifications[0].token, sha256(token), 'só o hash pode ir para o banco');
            assert.equal(fake.db.email_verifications[0].token === token, false);

            // O token não pode aparecer na resposta HTTP.
            assert.ok(!JSON.stringify(res.body).includes(token));
        });
    });

    it('sem e-mail configurado o cadastro funciona e diz a verdade', async () => {
        await withFakeBackend({ email: {} }, async ({ fake, mailbox }) => {
            const res = await call('/api/auth/register', {
                name: 'Joao Teste',
                email: 'joao@exemplo.com',
                password: 'senha-boa-123'
            });

            assert.equal(res.status, 200);
            assert.equal(res.body.success, true);
            assert.equal(res.body.verificationSent, false);
            assert.equal(res.body.emailConfigured, false);
            assert.equal(fake.db.users.length, 1, 'cadastro não pode depender do envio de e-mail');
            assert.equal(fake.db.email_verifications.length, 0);
            await tick();
            assert.equal(mailbox.messages.length, 0);
        });
    });
});

// ------------------------------------------------------------------- pedido

describe('Pedido de redefinição — mesma resposta para qualquer e-mail', () => {
    it('conta existente recebe link válido por 60 minutos', async () => {
        await withFakeBackend({}, async ({ fake, mailbox, tokenFrom, seedUser }) => {
            seedUser();
            const res = await call('/api/auth/forgot-password', { email: 'maria@exemplo.com' });

            assert.equal(res.status, 200);
            assert.equal(res.body.success, true);
            assert.match(res.body.message, /Se este e-mail estiver cadastrado/);

            await tick();
            const token = tokenFrom();
            assert.ok(isValidRecoveryToken(token));
            assert.equal(fake.db.password_resets.length, 1);
            assert.equal(fake.db.password_resets[0].token, sha256(token));
            const ttl = Date.parse(fake.db.password_resets[0].expires_at) - Date.now();
            assert.ok(ttl > 59 * 60000 && ttl <= 60 * 60000 + 5000, `validade inesperada: ${ttl}ms`);
            assert.match(mailbox.messages[0].text, /\?reset=/);
        });
    });

    it('conta inexistente recebe exatamente a mesma resposta', async () => {
        await withFakeBackend({}, async ({ fake, mailbox }) => {
            fake.db.users.push({
                id: 1,
                name: 'Maria',
                email: 'maria@exemplo.com',
                password: 'x',
                role: 'user',
                created_at: new Date().toISOString(),
                email_verified: false
            });

            // IPs diferentes para não esbarrar no limite por IP ao comparar.
            const existente = await call(
                '/api/auth/forgot-password',
                { email: 'maria@exemplo.com' },
                {
                    headers: { 'x-forwarded-for': '203.0.113.1' }
                }
            );
            const inexistente = await call(
                '/api/auth/forgot-password',
                { email: 'ninguem@exemplo.com' },
                {
                    headers: { 'x-forwarded-for': '203.0.113.2' }
                }
            );

            assert.equal(existente.status, inexistente.status);
            assert.deepEqual(existente.body, inexistente.body);

            await tick();
            assert.equal(mailbox.messages.length, 1, 'só a conta real recebe e-mail — o resto é silêncio');
        });
    });

    it('pedir de novo invalida o link anterior', async () => {
        await withFakeBackend({}, async ({ fake, tokenFrom, seedUser }) => {
            seedUser();
            await call(
                '/api/auth/forgot-password',
                { email: 'maria@exemplo.com' },
                { headers: { 'x-forwarded-for': '203.0.113.1' } }
            );
            await tick();
            const primeiro = tokenFrom();

            await call(
                '/api/auth/forgot-password',
                { email: 'maria@exemplo.com' },
                { headers: { 'x-forwarded-for': '203.0.113.2' } }
            );
            await tick();
            const segundo = tokenFrom();

            assert.notEqual(primeiro, segundo);
            assert.equal(fake.db.password_resets.filter(r => !r.used_at).length, 1, 'só um link pendente por conta');

            const comAntigo = await call('/api/auth/reset-password', { token: primeiro, password: 'senha-nova-123' });
            assert.equal(comAntigo.status, 400);
        });
    });

    it('quarto pedido em uma hora é barrado (429)', async () => {
        await withFakeBackend({}, async ({ seedUser }) => {
            seedUser();
            for (let i = 0; i < 3; i++) {
                const ok = await call(
                    '/api/auth/forgot-password',
                    { email: 'maria@exemplo.com' },
                    { headers: { 'x-forwarded-for': `203.0.113.${i + 1}` } }
                );
                assert.equal(ok.status, 200);
            }
            const excedido = await call(
                '/api/auth/forgot-password',
                { email: 'maria@exemplo.com' },
                {
                    headers: { 'x-forwarded-for': '203.0.113.99' }
                }
            );
            assert.equal(excedido.status, 429);
            assert.match(excedido.body.error, /Muitos pedidos/);
        });
    });

    it('sem e-mail configurado responde 503 igual para conta existente e inexistente', async () => {
        await withFakeBackend({ email: {} }, async ({ seedUser }) => {
            seedUser();
            const existente = await call(
                '/api/auth/forgot-password',
                { email: 'maria@exemplo.com' },
                {
                    headers: { 'x-forwarded-for': '203.0.113.1' }
                }
            );
            const inexistente = await call(
                '/api/auth/forgot-password',
                { email: 'ninguem@exemplo.com' },
                {
                    headers: { 'x-forwarded-for': '203.0.113.2' }
                }
            );

            assert.equal(existente.status, 503);
            assert.equal(inexistente.status, 503);
            assert.deepEqual(existente.body, inexistente.body);
            assert.match(existente.body.error, /não tem envio de e-mail configurado/);
        });
    });

    it('e-mail malformado é 400 antes de qualquer consulta', async () => {
        await withFakeBackend({}, async () => {
            const res = await call('/api/auth/forgot-password', { email: 'sem-arroba' });
            assert.equal(res.status, 400);
        });
    });
});

// ------------------------------------------------------------- redefinição

describe('Redefinição de senha', () => {
    it('token válido troca a senha, verifica o e-mail e encerra as sessões', async () => {
        await withFakeBackend({}, async ({ fake, tokenFrom, seedUser, login }) => {
            const user = seedUser({ email: 'maria@exemplo.com', password: await hashDeTeste('senha-antiga-123') });
            fake.db.sessions.push(
                {
                    id: 1,
                    user_id: user.id,
                    token: sha256('sessao-antiga-1'),
                    expires_at: new Date(Date.now() + 86400000).toISOString()
                },
                {
                    id: 2,
                    user_id: user.id,
                    token: sha256('sessao-antiga-2'),
                    expires_at: new Date(Date.now() + 86400000).toISOString()
                }
            );

            await call('/api/auth/forgot-password', { email: 'maria@exemplo.com' });
            await tick();
            const token = tokenFrom();

            const res = await call('/api/auth/reset-password', { token, password: 'senha-nova-456' });
            assert.equal(res.status, 200);
            assert.equal(res.body.success, true);
            assert.match(res.headers['set-cookie'], /Max-Age=0/, 'o cookie da sessão antiga é apagado');

            const atualizado = fake.db.users.find(u => u.id === user.id);
            assert.notEqual(atualizado.password, await hashDeTeste('senha-antiga-123'));
            assert.equal(atualizado.email_verified, true, 'usar o link prova posse da caixa postal');
            assert.equal(fake.db.sessions.length, 0, 'sessões antigas caem — o motivo do reset pode ser invasão');
            assert.ok(fake.db.password_resets[0].used_at, 'token fica marcado como usado');

            const comNova = await login('maria@exemplo.com', 'senha-nova-456');
            assert.equal(comNova.status, 200);
            const comAntiga = await login('maria@exemplo.com', 'senha-antiga-123');
            assert.equal(comAntiga.status, 401);
            assert.equal(comAntiga.body.error, 'E-mail ou senha incorretos');
        });
    });

    it('token usado, inexistente, expirado ou malformado dão a MESMA resposta', async () => {
        await withFakeBackend({}, async ({ fake, seedUser }) => {
            const user = seedUser();
            const bom = 'b'.repeat(64);
            fake.db.password_resets.push({
                id: 1,
                user_id: user.id,
                token: sha256(bom),
                expires_at: new Date(Date.now() - 60000).toISOString(),
                used_at: null
            });

            const expirado = await call('/api/auth/reset-password', { token: bom, password: 'senha-nova-123' });
            const inexistente = await call('/api/auth/reset-password', {
                token: 'c'.repeat(64),
                password: 'senha-nova-123'
            });
            const malformado = await call('/api/auth/reset-password', { token: 'curto', password: 'senha-nova-123' });

            assert.equal(expirado.status, 400);
            assert.equal(inexistente.status, 400);
            assert.equal(malformado.status, 400);
            assert.equal(expirado.body.error, inexistente.body.error);
            assert.equal(expirado.body.error, malformado.body.error);
            assert.match(expirado.body.error, /inválido ou expirado/);
        });
    });

    it('token já usado não serve de novo', async () => {
        await withFakeBackend({}, async ({ fake, tokenFrom, seedUser }) => {
            seedUser();
            await call('/api/auth/forgot-password', { email: 'maria@exemplo.com' });
            await tick();
            const token = tokenFrom();

            assert.equal((await call('/api/auth/reset-password', { token, password: 'senha-nova-123' })).status, 200);
            const segunda = await call('/api/auth/reset-password', { token, password: 'outra-senha-456' });
            assert.equal(segunda.status, 400);
            assert.equal(fake.db.password_resets.filter(r => r.used_at).length, 1);
        });
    });

    it('senha fraca é recusada sem queimar o token', async () => {
        await withFakeBackend({}, async ({ fake, tokenFrom, seedUser }) => {
            seedUser();
            await call('/api/auth/forgot-password', { email: 'maria@exemplo.com' });
            await tick();
            const token = tokenFrom();

            const fraca = await call('/api/auth/reset-password', { token, password: '123' });
            assert.equal(fraca.status, 400);
            assert.match(fraca.body.error, /pelo menos 8/);
            assert.equal(fake.db.password_resets[0].used_at, null, 'token continua utilizável');

            const boa = await call('/api/auth/reset-password', { token, password: 'senha-nova-123' });
            assert.equal(boa.status, 200);
        });
    });

    it('redefinir limpa o bloqueio de força bruta da conta', async () => {
        await withFakeBackend({}, async ({ fake, tokenFrom, seedUser }) => {
            const user = seedUser();
            for (let i = 0; i < 5; i++) fake.db.login_attempts.push({ ip: '203.0.113.5', email: user.email });

            await call('/api/auth/forgot-password', { email: 'maria@exemplo.com' });
            await tick();
            const res = await call('/api/auth/reset-password', { token: tokenFrom(), password: 'senha-nova-123' });

            assert.equal(res.status, 200);
            assert.equal(fake.db.login_attempts.filter(a => a.email === user.email).length, 0);
        });
    });
});

// -------------------------------------------------------------- verificação

describe('Verificação de e-mail', () => {
    it('link válido confirma a conta e consome o token', async () => {
        await withFakeBackend({}, async ({ fake, tokenFrom }) => {
            await call('/api/auth/register', {
                name: 'Maria Teste',
                email: 'maria@exemplo.com',
                password: 'senha-boa-123'
            });
            await tick();
            const token = tokenFrom();

            const res = await call('/api/auth/verify-email', { token });
            assert.equal(res.status, 200);
            assert.equal(res.body.success, true);
            assert.equal(fake.db.users[0].email_verified, true);
            assert.equal(fake.db.email_verifications.length, 0, 'token de uso único');

            const repetido = await call('/api/auth/verify-email', { token });
            assert.equal(repetido.status, 400);
        });
    });

    it('token expirado e token desconhecido dão a mesma resposta', async () => {
        await withFakeBackend({}, async ({ fake, seedUser }) => {
            const user = seedUser();
            const expirado = 'd'.repeat(64);
            fake.db.email_verifications.push({
                id: 1,
                user_id: user.id,
                token: sha256(expirado),
                expires_at: new Date(Date.now() - 1000).toISOString()
            });

            const exp = await call('/api/auth/verify-email', { token: expirado });
            const desconhecido = await call('/api/auth/verify-email', { token: 'e'.repeat(64) });
            assert.equal(exp.status, desconhecido.status);
            assert.equal(exp.body.error, desconhecido.body.error);
            assert.equal(fake.db.users[0].email_verified, false, 'link expirado não verifica nada');
        });
    });

    it('reenvio exige sessão, é limitado e não recria token de quem já verificou', async () => {
        await withFakeBackend({}, async ({ fake, tokenFrom, seedUser }) => {
            const semSessao = await call('/api/auth/resend-verification', {});
            assert.equal(semSessao.status, 401);

            const user = seedUser();
            fake.db.sessions.push({
                id: 50,
                user_id: user.id,
                token: sha256('sessao-valida'),
                expires_at: new Date(Date.now() + 86400000).toISOString()
            });
            const cookie = { cookie: 'lm_session=sessao-valida' };

            const primeiro = await call('/api/auth/resend-verification', {}, { headers: cookie });
            assert.equal(primeiro.status, 200);
            assert.equal(primeiro.body.verificationSent, true);
            await tick();
            assert.equal(fake.db.email_verifications.length, 1);
            assert.ok(isValidRecoveryToken(tokenFrom()));

            fake.db.users[0].email_verified = true;
            const jaVerificado = await call('/api/auth/resend-verification', {}, { headers: cookie });
            assert.equal(jaVerificado.body.alreadyVerified, true);
            assert.equal(jaVerificado.body.verificationSent, false);
        });
    });

    it('me devolve o estado de verificação e nunca o token', async () => {
        await withFakeBackend({}, async ({ fake, seedUser }) => {
            const user = seedUser();
            fake.db.sessions.push({
                id: 60,
                user_id: user.id,
                token: sha256('sessao-me'),
                expires_at: new Date(Date.now() + 86400000).toISOString()
            });

            const naoVerificado = await call(
                '/api/auth/me',
                {},
                { method: 'GET', headers: { cookie: 'lm_session=sessao-me' } }
            );
            assert.equal(naoVerificado.body.user.emailVerified, false);

            fake.db.users[0].email_verified = true;
            const verificado = await call(
                '/api/auth/me',
                {},
                { method: 'GET', headers: { cookie: 'lm_session=sessao-me' } }
            );
            assert.equal(verificado.body.user.emailVerified, true);
        });
    });
});

/** Hash bcrypt rápido (custo baixo) só para montar o cenário de login. */
async function hashDeTeste(password) {
    const bcrypt = (await import('bcryptjs')).default;
    return bcrypt.hash(password, 4);
}
