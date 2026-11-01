/**
 * Testes do limite de requisições por rota.
 *
 * O QUE ESTÁ SENDO PROTEGIDO
 * --------------------------
 * Antes, só login e recuperação de conta tinham limite. `register` aceitava conta
 * sem teto, `sync` chamava API de terceiro a cada requisição e as rotas `db/*`
 * podiam ser marteladas por qualquer sessão válida. Este arquivo cobre três coisas:
 *
 *  1. **a chave do limite não pode ser forjada** — era o furo silencioso: o código
 *     lia a *primeira* entrada de `X-Forwarded-For`, que é justamente a que o
 *     cliente escreve;
 *  2. **a contagem é atômica e por janela** — incremento no banco, sem estado em
 *     memória (função serverless não tem memória entre requisições);
 *  3. **a resposta de estouro é útil** — 429 com `Retry-After`, não erro genérico.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { clientIp, isValidIp } from '../server/clientIp.js';
import {
    READ_ONLY_DB_OPS,
    ROUTE_LIMITS,
    consumeRateLimit,
    isMissingTable,
    limitForRequest,
    rateLimitMessage,
    windowStart
} from '../server/rateLimit.js';
import { handler, _setSqlForTests } from '../server/handler.js';

// ------------------------------------------------------------------ clientIp

describe('De quem é a requisição', () => {
    it('x-real-ip tem prioridade (a borda reescreve, o cliente não)', () => {
        assert.equal(
            clientIp({ headers: { 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } }),
            '203.0.113.9'
        );
    });

    it('sem x-real-ip, vale a ÚLTIMA entrada de x-forwarded-for', () => {
        // O cliente escreve a primeira; o proxy acrescenta a dele no fim.
        assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } }), '10.0.0.1');
        assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1, 172.16.0.5' } }), '172.16.0.5');
        assert.equal(clientIp({ headers: { 'x-forwarded-for': '203.0.113.10' } }), '203.0.113.10');
    });

    it('valor inválido cai no balde comum em vez de virar chave nova', () => {
        assert.equal(clientIp({ headers: { 'x-forwarded-for': 'lixo com espaço' } }), 'unknown');
        assert.equal(clientIp({ headers: { 'x-forwarded-for': '"; DROP TABLE x' } }), 'unknown');
        assert.equal(clientIp({ headers: {} }), 'unknown');
    });

    it('sem proxy, usa o socket', () => {
        assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '::1' } }), '::1');
        assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '192.168.0.10' } }), '192.168.0.10');
    });

    it('isValidIp aceita IPv4, IPv6 e porta; recusa texto', () => {
        for (const valor of ['203.0.113.9', '::1', '2001:db8::1', '[::1]:443', '10.0.0.1:8080']) {
            assert.equal(isValidIp(valor), true, `deveria aceitar ${valor}`);
        }
        for (const valor of ['', 'a b', 'x"y', 'a/b', 'a'.repeat(101), null, 42]) {
            assert.equal(isValidIp(valor), false, `deveria recusar ${String(valor)}`);
        }
    });
});

// ------------------------------------------------------------- mapeamento

describe('Qual limite se aplica a cada rota', () => {
    it('rotas sensíveis têm limite próprio', () => {
        const casos = [
            ['/api/auth/register', 'POST', null, 'register'],
            ['/api/auth/login', 'POST', null, 'login'],
            ['/api/auth/reset-password', 'POST', null, 'reset-password'],
            ['/api/auth/verify-email', 'POST', null, 'verify-email'],
            ['/api/auth/change-password', 'POST', null, 'change-password'],
            ['/api/auth/delete-account', 'POST', null, 'delete-account'],
            ['/api/lottery/sync', 'POST', null, 'sync'],
            ['/api/health', 'GET', null, 'health'],
            ['/api/auth/me', 'GET', null, 'me']
        ];
        for (const [path, method, dbOp, esperado] of casos) {
            const limit = limitForRequest({ path, method, dbOp });
            assert.equal(limit?.bucket, esperado, `${method} ${path}`);
        }
    });

    it('db/* separa leitura de escrita (a escrita é bem mais barata de abusar)', () => {
        for (const op of READ_ONLY_DB_OPS) {
            assert.equal(limitForRequest({ path: `/api/db/${op}`, method: 'POST', dbOp: op })?.bucket, 'db-read');
        }
        for (const op of ['add', 'addMany', 'update', 'delete', 'incrementStats']) {
            assert.equal(limitForRequest({ path: `/api/db/${op}`, method: 'POST', dbOp: op })?.bucket, 'db-write');
        }
        assert.ok(ROUTE_LIMITS['db-read'].max > ROUTE_LIMITS['db-write'].max, 'ler é mais barato que escrever');
    });

    it('rota sem limite definido devolve null (não inventa limite)', () => {
        assert.equal(limitForRequest({ path: '/api/xpto', method: 'POST' }), null);
        assert.equal(limitForRequest({ path: '/api/db/add', method: 'POST', dbOp: null }), null);
        // `me` só é GET; POST cai no 405 do roteador, sem contador.
        assert.equal(limitForRequest({ path: '/api/auth/me', method: 'POST' }), null);
    });

    it('todo limite declarado é utilizável', () => {
        for (const [nome, limit] of Object.entries(ROUTE_LIMITS)) {
            assert.ok(limit.max > 0, `${nome}: max inválido`);
            assert.ok(limit.windowMs >= 1000, `${nome}: janela curta demais`);
            assert.equal(typeof limit.label, 'string');
            assert.ok(limit.label.length > 0, `${nome}: falta rótulo para a mensagem`);
            assert.equal(limit.bucket, nome, `${nome}: o bucket precisa ter o mesmo nome da chave`);
        }
    });
});

// ------------------------------------------------------------- contagem

/** Duplo do banco para o contador, em memória. */
function fakeRateSql({ failWith = null } = {}) {
    const counters = new Map();
    const calls = [];
    return {
        calls,
        counters,
        async query(text, params = []) {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            calls.push({ sql, params });
            if (failWith) throw failWith;

            if (sql.startsWith('INSERT INTO rate_limits')) {
                const [bucket, key, start] = params;
                const id = `${bucket}|${key}|${start}`;
                const hits = (counters.get(id) || 0) + 1;
                counters.set(id, hits);
                return [{ hits }];
            }
            if (sql.startsWith('DELETE FROM rate_limits')) return [];
            throw new Error(`duplo não conhece: ${sql}`);
        }
    };
}

const limite = { bucket: 'teste', max: 3, windowMs: 60000, label: 'teste' };

describe('Contagem por janela', () => {
    it('permite até o limite e informa quanto resta', async () => {
        const sql = fakeRateSql();
        const now = 1_700_000_000_000;

        const primeira = await consumeRateLimit(sql, limite, { key: 'ip-1', now });
        assert.equal(primeira.allowed, true);
        assert.equal(primeira.hits, 1);
        assert.equal(primeira.remaining, 2);
        assert.equal(primeira.max, 3);

        const segunda = await consumeRateLimit(sql, limite, { key: 'ip-1', now });
        const terceira = await consumeRateLimit(sql, limite, { key: 'ip-1', now });
        assert.equal(segunda.allowed, true);
        assert.equal(terceira.allowed, true);
        assert.equal(terceira.remaining, 0);
    });

    it('barra a requisição que passa do limite, com espera até o fim da janela', async () => {
        const sql = fakeRateSql();
        const now = 1_700_000_000_000;
        for (let i = 0; i < 3; i++) await consumeRateLimit(sql, limite, { key: 'ip-1', now });

        const excedente = await consumeRateLimit(sql, limite, { key: 'ip-1', now: now + 15000 });
        assert.equal(excedente.allowed, false);
        assert.equal(excedente.remaining, 0);
        assert.ok(excedente.retryAfterSeconds > 0, 'sem Retry-After o cliente só chuta quando voltar');
        assert.ok(excedente.retryAfterSeconds <= 60, `espera maior que a janela: ${excedente.retryAfterSeconds}`);
    });

    it('chaves diferentes não se misturam', async () => {
        const sql = fakeRateSql();
        const now = 1_700_000_000_000;
        for (let i = 0; i < 3; i++) await consumeRateLimit(sql, limite, { key: 'ip-1', now });

        const outro = await consumeRateLimit(sql, limite, { key: 'ip-2', now });
        assert.equal(outro.allowed, true);
        assert.equal(outro.hits, 1);
    });

    it('janela nova zera a contagem', async () => {
        const sql = fakeRateSql();
        // Instante alinhado ao começo da janela, para a comparação ser exata.
        const now = windowStart(1_700_000_000_000, 60000);
        for (let i = 0; i < 4; i++) await consumeRateLimit(sql, limite, { key: 'ip-1', now });

        const depois = await consumeRateLimit(sql, limite, { key: 'ip-1', now: now + 60000 });
        assert.equal(depois.allowed, true, 'virou a janela, pode voltar');
        assert.equal(depois.hits, 1);
        assert.equal(windowStart(now, 60000), windowStart(now + 59999, 60000));
        assert.notEqual(windowStart(now, 60000), windowStart(now + 60000, 60000));
    });

    it('limpa janelas antigas só na primeira requisição de cada janela', async () => {
        const sql = fakeRateSql();
        const now = 1_700_000_000_000;
        await consumeRateLimit(sql, limite, { key: 'ip-1', now });
        await consumeRateLimit(sql, limite, { key: 'ip-1', now });

        const limpezas = sql.calls.filter(c => c.sql.startsWith('DELETE FROM rate_limits'));
        assert.equal(limpezas.length, 1, 'o DELETE não pode rodar em toda requisição');
    });

    it('tabela ausente desativa o limite em vez de derrubar a rota', async () => {
        const avisos = [];
        const tabelaAusente = Object.assign(new Error('relation "rate_limits" does not exist'), { code: '42P01' });
        const sql = fakeRateSql({ failWith: tabelaAusente });

        const resultado = await consumeRateLimit(sql, limite, {
            key: 'ip-1',
            log: { warn: m => avisos.push(m) }
        });

        assert.equal(resultado.allowed, true);
        assert.equal(resultado.degraded, true);
        assert.equal(avisos.length, 1);
        assert.match(avisos[0], /npm run migrate/);
    });

    it('outro erro de banco sobe (falha aberta só para tabela ausente)', async () => {
        const sql = fakeRateSql({ failWith: new Error('connection reset') });
        await assert.rejects(() => consumeRateLimit(sql, limite, { key: 'ip-1' }), /connection reset/);
        assert.equal(isMissingTable(new Error('relation "x" does not exist')), true);
        assert.equal(isMissingTable(new Error('outra coisa')), false);
        assert.equal(isMissingTable(Object.assign(new Error('x'), { code: '42P01' })), true);
    });

    it('a mensagem do 429 nomeia o recurso', () => {
        assert.match(rateLimitMessage({ label: 'login' }), /login/);
    });
});

// ---------------------------------------------------------------- handler

/** Duplo mínimo para as rotas usadas na integração (register + health). */
function fakeHandlerSql() {
    let seq = 0;
    const db = { users: [], rate_limits: [] };
    return {
        db,
        async query(text, params = []) {
            const sql = String(text).replace(/\s+/g, ' ').trim();

            if (sql.startsWith('INSERT INTO rate_limits')) {
                const [bucket, key, start] = params;
                const atual = db.rate_limits.find(
                    r => r.bucket === bucket && r.key === key && r.window_start === start
                );
                if (atual) {
                    atual.hits += 1;
                    return [{ hits: atual.hits }];
                }
                db.rate_limits.push({ bucket, key, window_start: start, hits: 1 });
                return [{ hits: 1 }];
            }
            if (sql.startsWith('DELETE FROM rate_limits')) return [];
            if (sql === 'SELECT 1') return [{ '?column?': 1 }];
            if (sql.startsWith('INSERT INTO users')) {
                const user = { id: ++seq, name: params[0], email: params[1], password: params[2] };
                db.users.push(user);
                return [{ id: user.id }];
            }
            if (sql.startsWith('INSERT INTO user_stats') || sql.startsWith('INSERT INTO auto_settings')) return [];
            throw new Error(`duplo do handler não conhece: ${sql}`);
        },
        async transaction(queries) {
            await Promise.all(queries);
            return [];
        }
    };
}

function fakeReq({ url, body = {}, headers = {}, method = 'POST' }) {
    return {
        method,
        url,
        headers: {
            host: 'app.exemplo.com',
            origin: 'https://app.exemplo.com',
            'content-type': 'application/json',
            'x-real-ip': '203.0.113.7',
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

async function call(url, body, headers, method = 'POST') {
    const res = fakeRes();
    await handler(fakeReq({ url, body, headers, method }), res);
    return { status: res.statusCode, body: res.body, headers: res.headers };
}

after(() => {
    _setSqlForTests(null);
    delete process.env.EMAIL_API_KEY;
});

describe('Handler: o limite está de fato ligado', () => {
    it('a sexta criação de conta do mesmo IP recebe 429 com Retry-After', async () => {
        delete process.env.EMAIL_API_KEY;
        _setSqlForTests(fakeHandlerSql());

        const respostas = [];
        for (let i = 0; i < 6; i++) {
            respostas.push(
                await call('/api/auth/register', {
                    name: `Pessoa ${i}`,
                    email: `pessoa${i}@exemplo.com`,
                    password: 'senha-boa-123'
                })
            );
        }

        for (let i = 0; i < 5; i++) assert.equal(respostas[i].status, 200, `tentativa ${i + 1} deveria passar`);
        assert.equal(respostas[0].headers['x-ratelimit-limit'], '5');
        assert.equal(respostas[4].headers['x-ratelimit-remaining'], '0');

        const excedente = respostas[5];
        assert.equal(excedente.status, 429);
        assert.match(excedente.body.error, /Muitas requisições/);
        assert.ok(Number(excedente.headers['retry-after']) > 0);
        assert.equal(excedente.body.retryAfter, Number(excedente.headers['retry-after']));
    });

    it('outro IP continua com o próprio contador', async () => {
        delete process.env.EMAIL_API_KEY;
        _setSqlForTests(fakeHandlerSql());

        for (let i = 0; i < 5; i++) {
            await call(
                '/api/auth/register',
                { name: `Ana ${i}`, email: `ana${i}@exemplo.com`, password: 'senha-boa-123' },
                { 'x-real-ip': '198.51.100.4' }
            );
        }
        const bloqueado = await call(
            '/api/auth/register',
            { name: 'Ana 9', email: 'ana9@exemplo.com', password: 'senha-boa-123' },
            { 'x-real-ip': '198.51.100.4' }
        );
        assert.equal(bloqueado.status, 429);

        const outroIp = await call(
            '/api/auth/register',
            { name: 'Bia', email: 'bia@exemplo.com', password: 'senha-boa-123' },
            { 'x-real-ip': '198.51.100.5' }
        );
        assert.equal(outroIp.status, 200);
    });

    it('health também conta (o monitor não fica de fora do balde)', async () => {
        _setSqlForTests(fakeHandlerSql());
        const res = await call('/api/health', {}, {}, 'GET');
        assert.equal(res.status, 200);
        assert.equal(res.headers['x-ratelimit-limit'], '600');
    });

    it('sem DATABASE_URL o limite é ignorado e a rota responde o que sabe responder', async () => {
        _setSqlForTests(null);
        delete process.env.DATABASE_URL;
        const res = await call('/api/db/get', { store: 'games', id: 1 });
        assert.equal(res.status, 401, 'sem sessão continua sendo 401, não um 500 de infraestrutura');
        assert.equal(res.headers['x-ratelimit-limit'], undefined);
    });
});
