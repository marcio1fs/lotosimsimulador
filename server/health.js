/**
 * Estado real do serviço para o `/api/health`.
 *
 * O QUE HAVIA ANTES
 * -----------------
 * A rota era uma linha:
 *
 *     await getSql().query('SELECT 1');
 *     return send(res, 200, { ok: true });
 *
 * Ou seja: `200 {"ok":true}` significava "o banco respondeu `SELECT 1`". Três
 * coisas ficavam invisíveis:
 *
 * 1. **Banco fora** virava `500 {"error":"Erro interno do servidor"}` — o mesmo
 *    corpo de um bug qualquer no handler. Um monitor via "erro" sem saber se o
 *    problema era banco, código ou configuração.
 * 2. **Migração pendente** era invisível. O app subia, o `/api/health` dizia
 *    `ok`, e a primeira escrita numa tabela nova falhava em produção. Foi assim
 *    que o limite de requisições da migração `003` pôde ficar desligado em
 *    silêncio: falha aberta por desenho, mas sem nenhum sinal.
 * 3. **E-mail não configurado** — recuperação de senha e verificação respondem
 *    503 ao usuário, e nada no painel dizia por quê.
 *
 * O QUE ELE RESPONDE AGORA
 * ------------------------
 *
 *     {
 *       "ok": true,
 *       "status": "degraded",
 *       "checkedAt": "2026-11-01T22:40:00.000Z",
 *       "durationMs": 41,
 *       "checks": [
 *         { "id": "database",   "status": "ok",   "durationMs": 38, "detail": "…" },
 *         { "id": "migrations", "status": "fail", "code": "migrations_pending",
 *           "detail": "…", "pending": ["003_limite_de_requisicoes"], "drifted": [], "orphan": [] },
 *         { "id": "email",      "status": "warn", "code": "email_not_configured", "detail": "…" }
 *       ]
 *     }
 *
 * `ok` continua significando **"dá para servir"** — é o que o cliente usa
 * (`js/db/database.js`) para decidir entre API e IndexedDB local. Se um e-mail
 * não configurado fizesse `ok:false`, o app cairia para o banco local e o
 * usuário acharia que perdeu os dados. Então:
 *
 * - `status: "ok"`       → tudo verde. HTTP **200**.
 * - `status: "degraded"` → serve, com uma capacidade limitada (e-mail, migração
 *                          pendente). HTTP **200**, `ok: true`. Quem alerta tem
 *                          que olhar o `status` do corpo, não só o código.
 * - `status: "down"`     → banco inacessível ou não configurado. HTTP **503**,
 *                          `ok: false`.
 *
 * A separação é deliberada: `503` derruba o monitor **e** o modo API do cliente.
 * Só o caso em que o app realmente não serve merece esse efeito.
 *
 * O QUE ELE NÃO É
 * ---------------
 * Não é métrica (`/metrics`), não é tracing, não guarda histórico e não alerta.
 * Ele responde "como está **agora**" para quem perguntar: um monitor externo,
 * o `curl` do deploy, ou uma pessoa. Também não é autenticado — por isso não
 * devolve mensagem de erro crua, host de banco nem nome de variável de ambiente:
 * só códigos estáveis (`db_unreachable`, `migrations_pending`, …) e textos que
 * já estão na documentação.
 */

import { emailTransport } from './email.js';
import { isMissingTable } from './rateLimit.js';
import { MIGRATION_MANIFEST } from './migrationsManifest.js';

/**
 * Teto de espera da consulta de verificação.
 *
 * Sem isso, um banco que aceita a conexão e não responde deixaria o health
 * pendurado até o timeout da plataforma — e o monitor ficaria sem resposta, que
 * é pior que receber `503` em três segundos. O valor é curto de propósito:
 * healthcheck lento não é healthcheck.
 */
export const HEALTH_DB_TIMEOUT_MS = 3000;

/** Erro interno do `withTimeout`, para distinguir demora de recusa. */
class HealthTimeout extends Error {
    constructor(ms) {
        super(`consulta não respondeu em ${ms} ms`);
        this.name = 'HealthTimeout';
    }
}

/**
 * Corre `promise` com prazo.
 *
 * `Promise.race` já registra um handler na promessa original, então uma rejeição
 * que chegue **depois** do prazo não vira unhandled rejection. O que este
 * timeout não faz é cancelar a consulta: a query do Neon segue no servidor até
 * terminar. É abandono, não cancelamento — declarado em OBSERVABILIDADE.md.
 */
export function withTimeout(promise, ms) {
    let timer;
    const prazo = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new HealthTimeout(ms)), ms);
        // Deliberadamente **não** é `unref()`: se este prazo for o único trabalho
        // pendente, um timer "solta" nunca dispararia e o health ficaria sem
        // resposta — exatamente o que o prazo existe para evitar. Ele é limpo no
        // `finally` assim que a consulta termina.
    });
    return Promise.race([Promise.resolve(promise), prazo]).finally(() => clearTimeout(timer));
}

/** Banco respondeu `SELECT 1` dentro do prazo? */
export async function checkDatabase({ sql, timeoutMs = HEALTH_DB_TIMEOUT_MS, now = Date.now } = {}) {
    if (!sql) {
        return {
            id: 'database',
            status: 'fail',
            code: 'db_not_configured',
            detail: 'DATABASE_URL não está definida no servidor: nenhuma rota de dados funciona'
        };
    }

    const inicio = now();
    try {
        await withTimeout(sql.query('SELECT 1'), timeoutMs);
        return {
            id: 'database',
            status: 'ok',
            durationMs: now() - inicio,
            detail: 'consulta de verificação respondeu'
        };
    } catch (error) {
        const demorou = error instanceof HealthTimeout;
        // O erro cru vai para o log, nunca para a resposta: mensagem de driver
        // costuma carregar host, porta e às vezes a URL de conexão.
        console.error('[health] banco inacessível:', error);
        return {
            id: 'database',
            status: 'fail',
            code: demorou ? 'db_timeout' : 'db_unreachable',
            durationMs: now() - inicio,
            detail: demorou
                ? `o banco não respondeu em ${timeoutMs} ms`
                : 'o banco recusou ou não completou a consulta de verificação'
        };
    }
}

/**
 * O banco tem exatamente as migrações que o código espera?
 *
 * Compara três coisas contra `MIGRATION_MANIFEST`:
 *
 * - **pendente**: o arquivo existe no código e não foi aplicado → falta rodar
 *   `npm run migrate`;
 * - **divergente**: aplicado, mas o checksum não bate → o arquivo foi editado
 *   depois de aplicado, e o banco não é o que o código descreve;
 * - **órfã**: o banco tem um registro que o código não tem → arquivo removido ou
 *   renomeado. O schema real não tem dono.
 *
 * Nunca lança: qualquer falha vira `unknown`. Um health que estoura por não
 * conseguir ler o próprio controle é pior que um health que admite não saber.
 */
export async function checkMigrations({ sql, manifest = MIGRATION_MANIFEST, timeoutMs = HEALTH_DB_TIMEOUT_MS } = {}) {
    if (!sql) {
        return {
            id: 'migrations',
            status: 'unknown',
            code: 'migrations_not_checked',
            detail: 'sem banco configurado não há como ler o controle de migrações'
        };
    }

    let rows;
    try {
        rows = await withTimeout(sql.query('SELECT id, checksum FROM schema_migrations'), timeoutMs);
    } catch (error) {
        if (isMissingTable(error)) {
            return {
                id: 'migrations',
                status: 'unknown',
                code: 'migrations_table_missing',
                detail: 'banco sem `schema_migrations`: o schema foi criado à mão ou nunca migrado — rode `npm run migrate`'
            };
        }
        if (error instanceof HealthTimeout) {
            return {
                id: 'migrations',
                status: 'unknown',
                code: 'migrations_timeout',
                detail: `o controle de migrações não respondeu em ${timeoutMs} ms`
            };
        }
        console.error('[health] controle de migrações ilegível:', error);
        return {
            id: 'migrations',
            status: 'unknown',
            code: 'migrations_unreadable',
            detail: 'não foi possível ler `schema_migrations`'
        };
    }

    const aplicadas = new Map((Array.isArray(rows) ? rows : []).map(row => [row.id, row.checksum]));
    const pending = manifest.filter(m => !aplicadas.has(m.id)).map(m => m.id);
    const drifted = manifest.filter(m => aplicadas.has(m.id) && aplicadas.get(m.id) !== m.checksum).map(m => m.id);
    const conhecidas = new Set(manifest.map(m => m.id));
    const orphan = [...aplicadas.keys()].filter(id => !conhecidas.has(id));

    const problemas = pending.length + drifted.length + orphan.length;
    if (problemas === 0) {
        return {
            id: 'migrations',
            status: 'ok',
            applied: aplicadas.size,
            expected: manifest.length,
            detail: `${aplicadas.size} de ${manifest.length} migrações aplicadas`
        };
    }

    const partes = [];
    if (pending.length) partes.push(`${pending.length} pendente(s)`);
    if (drifted.length) partes.push(`${drifted.length} divergente(s)`);
    if (orphan.length) partes.push(`${orphan.length} órfã(s)`);

    return {
        id: 'migrations',
        status: 'fail',
        code: pending.length ? 'migrations_pending' : drifted.length ? 'migrations_drifted' : 'migrations_orphan',
        detail: `banco e código divergem: ${partes.join(', ')}. Rode \`npm run migrate:status\` para o detalhe.`,
        pending,
        drifted,
        orphan
    };
}

/** O envio de e-mail está configurado? (não testa a rede — só a configuração) */
export function checkEmail(env = process.env) {
    const transporte = emailTransport(env);
    if (transporte === 'resend') {
        return { id: 'email', status: 'ok', detail: 'transporte resend configurado' };
    }
    if (transporte === 'console') {
        return {
            id: 'email',
            status: 'warn',
            code: 'email_console_transport',
            detail: 'transporte `console`: o e-mail é impresso no log, não enviado'
        };
    }
    return {
        id: 'email',
        status: 'warn',
        code: 'email_not_configured',
        detail: 'sem EMAIL_API_KEY: recuperação de senha e verificação de e-mail respondem 503'
    };
}

/** `ok` e `status` a partir da lista de verificações. */
export function summarize(checks) {
    const banco = checks.find(c => c.id === 'database');
    const serve = banco?.status === 'ok';
    const limitado = checks.some(c => c.id !== 'database' && c.status !== 'ok');

    return {
        ok: serve,
        status: !serve ? 'down' : limitado ? 'degraded' : 'ok'
    };
}

/** `503` só quando o app não serve; `degraded` continua `200`. */
export const healthStatusCode = report => (report?.status === 'down' ? 503 : 200);

/**
 * Relatório completo.
 *
 * As verificações de migração só rodam se o banco respondeu — perguntar ao banco
 * duas vezes quando ele já não responde só gasta o prazo do monitor.
 */
export async function buildHealthReport({
    sql,
    env = process.env,
    now = Date.now,
    timeoutMs = HEALTH_DB_TIMEOUT_MS,
    manifest = MIGRATION_MANIFEST
} = {}) {
    const inicio = now();
    const checks = [];

    const banco = await checkDatabase({ sql, timeoutMs, now });
    checks.push(banco);
    checks.push(
        banco.status === 'ok' ? await checkMigrations({ sql, manifest, timeoutMs }) : await checkMigrations({})
    );
    checks.push(checkEmail(env));

    const { ok, status } = summarize(checks);
    const report = {
        ok,
        status,
        checkedAt: new Date(inicio).toISOString(),
        durationMs: now() - inicio,
        expectedMigrations: manifest.length,
        checks
    };

    // Identifica o deploy sem precisar abrir o painel. Só quando a plataforma
    // informa: campo ausente é melhor que `"commit": "desconhecido"`.
    const sha = env.VERCEL_GIT_COMMIT_SHA;
    if (typeof sha === 'string' && sha.length >= 7) report.commit = sha.slice(0, 7);
    if (typeof env.VERCEL_ENV === 'string' && env.VERCEL_ENV) report.environment = env.VERCEL_ENV;

    return report;
}
