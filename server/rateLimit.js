/**
 * Limite de requisições por rota.
 *
 * O QUE JÁ EXISTIA E O QUE FALTAVA
 * --------------------------------
 * - Login: 5 falhas em 15 minutos por IP **ou** e-mail (`login_attempts`);
 * - Recuperação de conta: 3 pedidos/hora por e-mail, 5 por IP (`recovery_requests`).
 *
 * Fora disso, nada. `register` aceitava criação de conta sem limite, `sync`
 * disparava busca em API de terceiro e escrita no banco a cada chamada, e as rotas
 * `db/*` — que são o coração do app — podiam ser marteladas por qualquer sessão
 * válida. Um script com um login só conseguia transformar o banco em alvo de carga.
 *
 * COMO CONTA (janela fixa)
 * ------------------------
 * Uma linha por `(bucket, chave, início da janela)` com um contador. Incremento
 * atômico:
 *
 *     INSERT INTO rate_limits (bucket, key, window_start, hits) VALUES (…, 1)
 *     ON CONFLICT (bucket, key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
 *     RETURNING hits
 *
 * Janela fixa tem o defeito conhecido: quem chega no fim de uma janela e no começo
 * da seguinte faz o dobro do limite em instantes. Para contenção de abuso isso é
 * aceitável; janela deslizante custa bem mais (guarda cada requisição) e este
 * projeto não tem esse volume. `retryAfterSeconds` é calculado para o **fim da
 * janela atual**, então quem estourou sabe exatamente quando pode voltar.
 *
 * POR QUE A CHAVE É O IP
 * ----------------------
 * Limite por usuário exigiria consultar a sessão antes de contar — uma segunda
 * consulta ao banco em toda requisição autenticada. O modelo de abuso que importa
 * aqui é "um cliente martelando a API", e disso o IP dá conta. O custo é o NAT:
 * uma escola inteira atrás do mesmo endereço divide o limite. Por isso os números
 * são generosos (ver `ROUTE_LIMITS`) — o objetivo é parar script, não usuário.
 *
 * TABELA AUSENTE
 * --------------
 * Se `rate_limits` não existir (código novo em banco sem a migração), o limite é
 * **ignorado com aviso no log**, em vez de derrubar login e cadastro. É a única
 * falha aberta do arquivo, e ela é explícita: um app que não deixa ninguém entrar
 * porque faltou uma migração trocou um risco por um incidente maior.
 */

/** Rotas com limite. `max` por `windowMs`, contado por IP. */
export const ROUTE_LIMITS = {
    register: { bucket: 'register', max: 5, windowMs: 60 * 60 * 1000, label: 'criação de conta' },
    login: { bucket: 'login', max: 20, windowMs: 15 * 60 * 1000, label: 'login' },
    'reset-password': { bucket: 'reset-password', max: 20, windowMs: 60 * 60 * 1000, label: 'redefinição de senha' },
    'change-password': { bucket: 'change-password', max: 10, windowMs: 60 * 60 * 1000, label: 'troca de senha' },
    'delete-account': { bucket: 'delete-account', max: 5, windowMs: 60 * 60 * 1000, label: 'exclusão de conta' },
    'verify-email': { bucket: 'verify-email', max: 20, windowMs: 60 * 60 * 1000, label: 'verificação de e-mail' },
    sync: { bucket: 'sync', max: 10, windowMs: 60 * 60 * 1000, label: 'sincronização de resultados' },
    'db-write': { bucket: 'db-write', max: 600, windowMs: 60 * 1000, label: 'escrita de dados' },
    'db-read': { bucket: 'db-read', max: 1200, windowMs: 60 * 1000, label: 'leitura de dados' },
    me: { bucket: 'me', max: 300, windowMs: 60 * 1000, label: 'consulta de sessão' },
    health: { bucket: 'health', max: 600, windowMs: 60 * 1000, label: 'healthcheck' }
};

/** Operações de `db/*` que só leem. O resto é escrita. */
export const READ_ONLY_DB_OPS = new Set(['get', 'getAll', 'getAllByIndex', 'getByIndex', 'count']);

/**
 * Qual limite se aplica a esta requisição (ou `null`).
 *
 * Rotas sem limite explícito ficam sem: health e leitura são baratas e limitá-las
 * sem necessidade só cria tela de erro para usuário legítimo.
 */
export function limitForRequest({ path, method, dbOp = null }) {
    if (path === '/api/auth/register') return ROUTE_LIMITS.register;
    if (path === '/api/auth/login') return ROUTE_LIMITS.login;
    if (path === '/api/auth/reset-password') return ROUTE_LIMITS['reset-password'];
    if (path === '/api/auth/verify-email') return ROUTE_LIMITS['verify-email'];
    // Troca de senha e exclusão de conta fazem bcrypt (custo 12) e são destrutivas:
    // sem limite, são alvo fácil de exaustão de CPU por uma sessão qualquer.
    if (path === '/api/auth/change-password') return ROUTE_LIMITS['change-password'];
    if (path === '/api/auth/delete-account') return ROUTE_LIMITS['delete-account'];
    if (path === '/api/lottery/sync') return ROUTE_LIMITS.sync;
    if (path === '/api/health') return ROUTE_LIMITS.health;
    if (path === '/api/auth/me' && method === 'GET') return ROUTE_LIMITS.me;
    if (dbOp) return READ_ONLY_DB_OPS.has(dbOp) ? ROUTE_LIMITS['db-read'] : ROUTE_LIMITS['db-write'];
    return null;
}

/** Início da janela fixa que contém `now`. */
export const windowStart = (now, windowMs) => Math.floor(now / windowMs) * windowMs;

/**
 * Conta uma requisição e diz se ela pode seguir.
 *
 * @param {{query: Function}} sql
 * @param {{bucket: string, max: number, windowMs: number}} limit
 * @param {{key: string, now?: number, log?: Console}} options
 * @returns {Promise<{allowed: boolean, hits: number, max: number, remaining: number, retryAfterSeconds: number, degraded?: boolean}>}
 */
export async function consumeRateLimit(sql, limit, { key, now = Date.now(), log = console } = {}) {
    const start = windowStart(now, limit.windowMs);
    const startIso = new Date(start).toISOString();
    const retryAfterSeconds = Math.max(1, Math.ceil((start + limit.windowMs - now) / 1000));

    try {
        const rows = await sql.query(
            `INSERT INTO rate_limits (bucket, key, window_start, hits)
             VALUES ($1, $2, $3::timestamptz, 1)
             ON CONFLICT (bucket, key, window_start)
             DO UPDATE SET hits = rate_limits.hits + 1
             RETURNING hits`,
            [limit.bucket, key, startIso]
        );
        const hits = Number(rows?.[0]?.hits ?? 1);

        // Limpeza oportunista: só na primeira requisição de uma janela nova, para
        // não pagar um DELETE em toda requisição. Fire-and-forget: falhar aqui não
        // pode afetar a resposta.
        if (hits === 1 && sql.query) {
            sql.query("DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 day'").catch(() => {});
        }

        return {
            allowed: hits <= limit.max,
            hits,
            max: limit.max,
            remaining: Math.max(0, limit.max - hits),
            retryAfterSeconds
        };
    } catch (error) {
        if (isMissingTable(error)) {
            log.warn(
                '[rate-limit] tabela `rate_limits` não existe — limite desativado. ' +
                    'Rode `npm run migrate` (migração 003) para ativar.'
            );
            return { allowed: true, hits: 0, max: limit.max, remaining: limit.max, retryAfterSeconds, degraded: true };
        }
        throw error;
    }
}

/** O erro é "tabela não existe"? (código 42P01 do Postgres) */
export function isMissingTable(error) {
    const code = error?.code || '';
    const message = String(error?.message || '');
    return code === '42P01' || /relation .* does not exist|undefined_table/i.test(message);
}

/** Mensagem devolvida ao cliente quando o limite estoura. */
export const rateLimitMessage = limit => `Muitas requisições de ${limit.label}. Tente novamente em instantes.`;
