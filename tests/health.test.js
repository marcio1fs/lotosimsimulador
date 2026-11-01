/**
 * Testes do `/api/health` como observabilidade (item 5).
 *
 * O que precisa ficar provado:
 *
 *  - `ok: true` continua significando "dá para servir" (o cliente usa esse campo
 *    para escolher entre API e IndexedDB);
 *  - banco fora vira `503` com código estável, não `500` genérico;
 *  - migração pendente/divergente/órfã e e-mail não configurado **aparecem**,
 *    sem derrubar o código HTTP (são degradação, não queda);
 *  - nada de configuração sensível sai na resposta;
 *  - a verificação nunca estoura: falha de leitura vira `unknown`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    HEALTH_DB_TIMEOUT_MS,
    buildHealthReport,
    checkDatabase,
    checkEmail,
    checkMigrations,
    healthStatusCode,
    summarize,
    withTimeout
} from '../server/health.js';
import { MIGRATION_MANIFEST, EXPECTED_MIGRATIONS } from '../server/migrationsManifest.js';
import { loadMigrations } from '../server/migrations.js';
import { handler, _setSqlForTests } from '../server/handler.js';

const manifest = MIGRATION_MANIFEST;

/** Banco de mentira que só responde o que o teste mandar. */
function fakeSql({ migrations = null, failWith = null, hang = false, counted = false, onQuery = null } = {}) {
    const calls = [];
    return {
        calls,
        async query(text) {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            calls.push(sql);
            if (hang) return new Promise(() => {});
            if (failWith) throw failWith;
            if (sql === 'SELECT 1') return [{ '?column?': 1 }];
            if (sql.startsWith('SELECT id, checksum FROM schema_migrations')) {
                if (migrations === null)
                    throw Object.assign(new Error('duplo sem controle de migrações'), { code: 'XX000' });
                return migrations;
            }
            if (onQuery) return onQuery(sql);
            if (counted) return [];
            throw new Error(`duplo não conhece: ${sql}`);
        }
    };
}

const applied = () => manifest.map(m => ({ id: m.id, checksum: m.checksum }));

describe('Health — verificação do banco', () => {
    it('banco que responde vira status ok, com duração medida', async () => {
        let t = 1000;
        const check = await checkDatabase({ sql: fakeSql(), now: () => (t += 7) });
        assert.equal(check.id, 'database');
        assert.equal(check.status, 'ok');
        assert.equal(typeof check.durationMs, 'number');
        assert.ok(check.durationMs >= 0);
    });

    it('banco que recusa vira fail com código estável', async () => {
        const erro = new Error('connect ECONNREFUSED 10.0.0.5:5432');
        const check = await checkDatabase({ sql: fakeSql({ failWith: erro }) });
        assert.equal(check.status, 'fail');
        assert.equal(check.code, 'db_unreachable');
    });

    it('sem DATABASE_URL o veredito é db_not_configured (não é exceção)', async () => {
        const check = await checkDatabase({ sql: null });
        assert.equal(check.status, 'fail');
        assert.equal(check.code, 'db_not_configured');
    });

    it('banco que aceita a conexão e não responde vira db_timeout', async () => {
        const check = await checkDatabase({ sql: fakeSql({ hang: true }), timeoutMs: 10 });
        assert.equal(check.status, 'fail');
        assert.equal(check.code, 'db_timeout');
        assert.match(check.detail, /10 ms/);
    });

    it('o prazo padrão é curto o bastante para um monitor', () => {
        assert.ok(HEALTH_DB_TIMEOUT_MS > 0 && HEALTH_DB_TIMEOUT_MS <= 5000, String(HEALTH_DB_TIMEOUT_MS));
    });

    it('withTimeout não deixa rejeição tardia vazar', async () => {
        const tarde = new Promise((_, reject) => setTimeout(() => reject(new Error('tarde')), 20));
        await assert.rejects(withTimeout(tarde, 5));
        // Se a rejeição de `tarde` escapasse, o processo de teste morreria aqui.
        await new Promise(r => setTimeout(r, 40));
    });
});

describe('Health — migrações', () => {
    it('banco com todas as migrações aplicadas: ok', async () => {
        const check = await checkMigrations({ sql: fakeSql({ migrations: applied() }) });
        assert.equal(check.status, 'ok');
        assert.equal(check.applied, manifest.length);
        assert.equal(check.expected, manifest.length);
    });

    it('migração pendente aparece com nome', async () => {
        const ultima = manifest[manifest.length - 1].id;
        const check = await checkMigrations({ sql: fakeSql({ migrations: applied().slice(0, -1) }) });
        assert.equal(check.status, 'fail');
        assert.equal(check.code, 'migrations_pending');
        assert.deepEqual(check.pending, [ultima]);
        assert.deepEqual(check.drifted, []);
    });

    it('checksum diferente = arquivo editado depois de aplicado', async () => {
        const rows = applied();
        rows[0].checksum = 'deadbeef';
        const check = await checkMigrations({ sql: fakeSql({ migrations: rows }) });
        assert.equal(check.status, 'fail');
        assert.equal(check.code, 'migrations_drifted');
        assert.deepEqual(check.drifted, [manifest[0].id]);
    });

    it('registro no banco sem arquivo no código é órfão', async () => {
        const rows = [...applied(), { id: '004_inexistente', checksum: 'abc' }];
        const check = await checkMigrations({ sql: fakeSql({ migrations: rows }) });
        assert.equal(check.status, 'fail');
        assert.equal(check.code, 'migrations_orphan');
        assert.deepEqual(check.orphan, ['004_inexistente']);
    });

    it('tabela de controle ausente (42P01) vira unknown, não derruba o health', async () => {
        const erro = Object.assign(new Error('relation "schema_migrations" does not exist'), { code: '42P01' });
        const check = await checkMigrations({ sql: fakeSql({ failWith: erro }) });
        assert.equal(check.status, 'unknown');
        assert.equal(check.code, 'migrations_table_missing');
    });

    it('erro qualquer de leitura vira unknown', async () => {
        const check = await checkMigrations({ sql: fakeSql({ failWith: new Error('boom') }) });
        assert.equal(check.status, 'unknown');
        assert.equal(check.code, 'migrations_unreadable');
    });

    it('controle de migrações lento vira unknown (e não segura a resposta)', async () => {
        const check = await checkMigrations({ sql: fakeSql({ hang: true }), timeoutMs: 10 });
        assert.equal(check.status, 'unknown');
        assert.equal(check.code, 'migrations_timeout');
    });

    it('o manifesto é exatamente a lista de arquivos de migração', async () => {
        const migracoes = await loadMigrations();
        assert.deepEqual(
            manifest.map(m => ({ id: m.id, checksum: m.checksum })),
            migracoes.map(m => ({ id: m.id, checksum: m.checksum })),
            'rode `npm run build:manifest` depois de adicionar/editar uma migração'
        );
        assert.equal(EXPECTED_MIGRATIONS, migracoes.length);
    });
});

describe('Health — e-mail', () => {
    it('resend configurado: ok', () => {
        assert.equal(checkEmail({ EMAIL_API_KEY: 're_test' }).status, 'ok');
    });

    it('nada configurado: warn com o motivo', () => {
        const check = checkEmail({});
        assert.equal(check.status, 'warn');
        assert.equal(check.code, 'email_not_configured');
    });

    it('transporte console é warn (imprime no log em vez de enviar)', () => {
        const check = checkEmail({ EMAIL_TRANSPORT: 'console' });
        assert.equal(check.status, 'warn');
        assert.equal(check.code, 'email_console_transport');
    });

    it('console é recusado em produção, portanto continua warn', () => {
        const check = checkEmail({ EMAIL_TRANSPORT: 'console', NODE_ENV: 'production' });
        assert.equal(check.status, 'warn');
        assert.equal(check.code, 'email_not_configured');
    });
});

describe('Health — veredito e código HTTP', () => {
    it('tudo verde: ok + 200', () => {
        const resumo = summarize([
            { id: 'database', status: 'ok' },
            { id: 'email', status: 'ok' }
        ]);
        assert.deepEqual(resumo, { ok: true, status: 'ok' });
        assert.equal(healthStatusCode(resumo), 200);
    });

    it('degradação mantém ok:true e 200 — o app continua servindo', () => {
        const resumo = summarize([
            { id: 'database', status: 'ok' },
            { id: 'email', status: 'warn' }
        ]);
        assert.deepEqual(resumo, { ok: true, status: 'degraded' });
        assert.equal(healthStatusCode(resumo), 200);
    });

    it('banco fora: ok:false, down e 503', () => {
        const resumo = summarize([
            { id: 'database', status: 'fail' },
            { id: 'email', status: 'warn' }
        ]);
        assert.deepEqual(resumo, { ok: false, status: 'down' });
        assert.equal(healthStatusCode(resumo), 503);
    });

    it('relatório sem status não vira 503 por acidente', () => {
        assert.equal(healthStatusCode({}), 200);
        assert.equal(healthStatusCode(null), 200);
    });
});

describe('Health — relatório completo', () => {
    it('junta as três verificações e não expõe segredo', async () => {
        const env = {
            EMAIL_API_KEY: 're_super_secreta',
            EMAIL_FROM: 'conta@exemplo.com',
            DATABASE_URL: 'postgres://usuario:senha@host/banco',
            VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890',
            VERCEL_ENV: 'preview'
        };
        const relatorio = await buildHealthReport({ sql: fakeSql({ migrations: applied() }), env });

        assert.equal(relatorio.ok, true);
        assert.equal(relatorio.status, 'ok');
        assert.equal(relatorio.expectedMigrations, manifest.length);
        assert.deepEqual(
            relatorio.checks.map(c => c.id),
            ['database', 'migrations', 'email']
        );
        assert.equal(relatorio.commit, 'abcdef1');
        assert.equal(relatorio.environment, 'preview');

        const texto = JSON.stringify(relatorio);
        assert.doesNotMatch(texto, /re_super_secreta/);
        assert.doesNotMatch(texto, /postgres:\/\//);
        assert.doesNotMatch(texto, /senha@host/);
    });

    it('sem as variáveis da Vercel, commit e environment simplesmente não aparecem', async () => {
        const relatorio = await buildHealthReport({ sql: fakeSql({ migrations: applied() }), env: {} });
        assert.equal('commit' in relatorio, false);
        assert.equal('environment' in relatorio, false);
    });

    it('banco fora nem tenta ler as migrações', async () => {
        const sql = fakeSql({ failWith: new Error('offline'), counted: true });
        const relatorio = await buildHealthReport({ sql, env: {} });
        assert.equal(sql.calls.filter(c => c.startsWith('SELECT id, checksum')).length, 0);
        assert.equal(relatorio.status, 'down');
        assert.equal(relatorio.checks[1].code, 'migrations_not_checked');
    });

    it('migração pendente mantém 200 e aparece no relatório', async () => {
        const relatorio = await buildHealthReport({
            sql: fakeSql({ migrations: applied().slice(0, 1) }),
            env: { EMAIL_API_KEY: 're_x' }
        });
        assert.equal(relatorio.status, 'degraded');
        assert.equal(relatorio.ok, true);
        assert.equal(healthStatusCode(relatorio), 200);
        assert.ok(relatorio.checks[1].pending.length > 0);
    });

    it('checkedAt usa o relógio injetado (teste determinístico)', async () => {
        const relatorio = await buildHealthReport({
            sql: fakeSql({ migrations: applied() }),
            env: {},
            now: () => Date.parse('2026-11-01T12:00:00.000Z')
        });
        assert.equal(relatorio.checkedAt, '2026-11-01T12:00:00.000Z');
        assert.equal(relatorio.durationMs, 0);
    });
});

// ------------------------------------------------------------------ handler

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

const fakeReq = (url = '/api/health') => ({ method: 'GET', url, headers: { host: 'app.exemplo.com' }, socket: {} });

/**
 * Duplo do handler: atende o contador do limite por rota **e** o health.
 *
 * `dbFails` derruba só as consultas do health (`SELECT 1`). O contador do limite
 * precisa continuar de pé: se ele também falhasse, o 500 viria do limitador e o
 * teste estaria medindo outra coisa.
 */
function handlerSql({ migrations = applied(), dbFails = false, hangDb = false } = {}) {
    return {
        async query(text) {
            const sql = String(text).replace(/\s+/g, ' ').trim();
            if (sql.startsWith('INSERT INTO rate_limits')) return [{ hits: 1 }];
            if (sql.startsWith('DELETE FROM rate_limits')) return [];
            if (sql === 'SELECT 1') {
                if (hangDb) return new Promise(() => {});
                if (dbFails) throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
                return [{ '?column?': 1 }];
            }
            if (sql.startsWith('SELECT id, checksum FROM schema_migrations')) {
                if (migrations === null) throw Object.assign(new Error('duplo sem controle'), { code: 'XX000' });
                return migrations;
            }
            throw new Error(`duplo do handler não conhece: ${sql}`);
        }
    };
}

describe('Health — pela rota /api/health', () => {
    it('responde 200 com ok:true, cache desligado e tipos corretos', async () => {
        // E-mail configurado para o veredito ser `ok`: sem isso o ambiente de
        // teste (sem EMAIL_API_KEY) produz `degraded`, que é o comportamento
        // certo — só não é o que este caso está medindo.
        const anterior = process.env.EMAIL_API_KEY;
        process.env.EMAIL_API_KEY = 're_teste';
        _setSqlForTests(handlerSql());
        const res = fakeRes();
        try {
            await handler(fakeReq(), res);
        } finally {
            if (anterior === undefined) delete process.env.EMAIL_API_KEY;
            else process.env.EMAIL_API_KEY = anterior;
        }

        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['cache-control'], 'no-store');
        assert.match(res.headers['content-type'], /application\/json/);
        assert.equal(res.body.ok, true);
        assert.equal(res.body.status, 'ok');
        assert.ok(Array.isArray(res.body.checks));
    });

    it('não exige sessão (monitor não tem cookie)', async () => {
        _setSqlForTests(handlerSql());
        const res = fakeRes();
        await handler(fakeReq(), res);
        assert.equal(res.statusCode, 200);
    });

    it('banco fora responde 503 e não 500 genérico', async () => {
        _setSqlForTests(handlerSql({ dbFails: true }));
        const res = fakeRes();
        await handler(fakeReq(), res);

        assert.equal(res.statusCode, 503);
        assert.equal(res.body.ok, false);
        assert.equal(res.body.status, 'down');
        assert.equal(res.body.checks[0].code, 'db_unreachable');
        assert.doesNotMatch(JSON.stringify(res.body), /ECONNREFUSED/);
    });

    it('sem DATABASE_URL: 503 db_not_configured em vez de erro interno', async () => {
        const original = process.env.DATABASE_URL;
        delete process.env.DATABASE_URL;
        _setSqlForTests(null);
        try {
            const res = fakeRes();
            await handler(fakeReq(), res);
            assert.equal(res.statusCode, 503);
            assert.equal(res.body.checks[0].code, 'db_not_configured');
        } finally {
            _setSqlForTests(null);
            if (original !== undefined) process.env.DATABASE_URL = original;
        }
    });

    it('duplo que não conhece schema_migrations não derruba a rota (degrada)', async () => {
        _setSqlForTests(handlerSql({ migrations: null }));
        const res = fakeRes();
        await handler(fakeReq(), res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.status, 'degraded');
        assert.equal(res.body.checks[1].status, 'unknown');
    });

    it('continua contando no limite por rota (o monitor não fica fora do balde)', async () => {
        _setSqlForTests(handlerSql());
        const res = fakeRes();
        await handler(fakeReq(), res);
        assert.equal(res.headers['x-ratelimit-limit'], '600');
    });
});
