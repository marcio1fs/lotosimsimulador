/**
 * Sincronização rápida de resultados oficiais no servidor:
 * - Disputa espelhos em paralelo (Promise.any) sem bloqueio de CORS do navegador
 * - Cache em memória com TTL de 5 minutos por modalidade
 * - Backfill automático de histórico quando a base tem poucos concursos
 * - Grava acumulou e valor_estimado normalizados
 */

const LOTTERY_RULES = {
    lotofacil: { apiName: 'lotofacil', total: 25, drawn: 15 },
    mega: { apiName: 'megasena', total: 60, drawn: 6 },
    lotomania: { apiName: 'lotomania', total: 100, drawn: 20 },
    quina: { apiName: 'quina', total: 80, drawn: 5 }
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const latestCache = new Map(); // type -> { at, parsed }
const backfillAttempted = new Set();

export function parseMoneyValue(raw) {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const cleaned = raw.replace(/[^\d,.-]/g, '');
    if (!cleaned) return null;
    const normalized = cleaned.includes(',')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned;
    const num = Number(normalized);
    return Number.isFinite(num) ? num : null;
}

export function normalizeDrawPayload(apiData, type) {
    const rule = LOTTERY_RULES[type];
    if (!rule || !apiData || typeof apiData !== 'object') return null;

    const concurso = parseInt(apiData.concurso ?? apiData.numero, 10) || 0;
    if (concurso <= 0) return null;

    let rawDezenas = null;
    if (Array.isArray(apiData.listaDezenas)) rawDezenas = apiData.listaDezenas;
    else if (Array.isArray(apiData.dezenas)) rawDezenas = apiData.dezenas;
    else if (Array.isArray(apiData.dezenasOrdemSorteio)) rawDezenas = apiData.dezenasOrdemSorteio;
    else if (Array.isArray(apiData.dezenasSorteadasOrdemSorteio)) rawDezenas = apiData.dezenasSorteadasOrdemSorteio;

    if (!rawDezenas || rawDezenas.length === 0) return null;

    const numeric = rawDezenas
        .map(d => parseInt(d, 10))
        .filter(n => !Number.isNaN(n) && n >= 1 && n <= rule.total);
    const unique = [...new Set(numeric)].sort((a, b) => a - b);
    if (unique.length !== rule.drawn) return null;

    const dezenas = unique.map(n => String(n).padStart(2, '0'));
    const data = String(apiData.dataApuracao || apiData.data || new Date().toLocaleDateString('pt-BR'));
    const acumulou = Boolean(apiData.acumulado ?? apiData.acumulou);
    const valorEstimado = parseMoneyValue(apiData.valorEstimadoProximoConcurso ?? apiData.valorEstimado);

    return {
        lotteryType: type,
        concurso,
        data,
        dataApuracao: data,
        dezenas,
        acumulou,
        valorEstimado
    };
}

async function fetchJsonWithTimeout(url, timeoutMs, externalSignal) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    externalSignal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const resp = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (compatible; LotoMaisSync/1.0)'
            },
            signal: ctrl.signal
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener('abort', onAbort);
    }
}

export async function fetchLatestExternal(type) {
    const rule = LOTTERY_RULES[type];
    if (!rule) return null;

    const cached = latestCache.get(type);
    if (cached && (Date.now() - cached.at) < CACHE_TTL_MS) {
        return cached.parsed;
    }

    const urls = [
        `https://servicebus2.caixa.gov.br/portaldeloterias/api/${rule.apiName}`,
        `https://loteriascaixa-api.herokuapp.com/api/${rule.apiName}/latest`
    ];

    const raceAbort = new AbortController();
    try {
        const winner = await Promise.any(urls.map(async (url) => {
            const json = await fetchJsonWithTimeout(url, 4500, raceAbort.signal);
            const parsed = normalizeDrawPayload(json, type);
            if (!parsed) throw new Error('Payload inválido');
            return parsed;
        }));
        raceAbort.abort();
        latestCache.set(type, { at: Date.now(), parsed: winner });
        return winner;
    } catch {
        return null;
    }
}

async function bulkInsertDraws(sql, draws) {
    if (!draws.length) return 0;
    const chunkSize = 100;
    let inserted = 0;
    const now = new Date().toISOString();

    for (let offset = 0; offset < draws.length; offset += chunkSize) {
        const chunk = draws.slice(offset, offset + chunkSize);
        const values = [];
        const tuples = chunk.map((d, idx) => {
            const base = idx * 8;
            values.push(
                d.lotteryType,
                d.concurso,
                d.data,
                d.dataApuracao,
                JSON.stringify(d.dezenas),
                Boolean(d.acumulou),
                d.valorEstimado ?? null,
                now
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}, $${base + 7}, $${base + 8})`;
        });

        await sql.query(
            `INSERT INTO lottery_results (lottery_type, concurso, data, data_apuracao, dezenas, acumulou, valor_estimado, fetched_at)
             VALUES ${tuples.join(', ')}
             ON CONFLICT (lottery_type, concurso) DO UPDATE SET
               dezenas = EXCLUDED.dezenas,
               acumulou = EXCLUDED.acumulou,
               valor_estimado = COALESCE(EXCLUDED.valor_estimado, lottery_results.valor_estimado),
               fetched_at = EXCLUDED.fetched_at`,
            values
        );
        inserted += chunk.length;
    }
    return inserted;
}

async function backfillIfSparse(sql, type) {
    if (backfillAttempted.has(type)) return;
    const countRows = await sql.query(
        'SELECT COUNT(*)::int AS n FROM lottery_results WHERE lottery_type = $1',
        [type]
    );
    if ((countRows[0]?.n || 0) >= 120) {
        backfillAttempted.add(type);
        return;
    }

    backfillAttempted.add(type);
    const rule = LOTTERY_RULES[type];
    try {
        const list = await fetchJsonWithTimeout(
            `https://loteriascaixa-api.herokuapp.com/api/${rule.apiName}`,
            7000
        );
        if (!Array.isArray(list) || list.length === 0) return;
        const normalized = [];
        const slice = list.slice(0, 300);
        for (const item of slice) {
            const p = normalizeDrawPayload(item, type);
            if (p) normalized.push(p);
        }
        if (normalized.length > 0) {
            await bulkInsertDraws(sql, normalized);
        }
    } catch {
        // Backfill é oportunista: falhas externas não interrompem a sincronização
    }
}

export async function syncLotteries(sql, { types = [], since = {} } = {}) {
    const validTypes = (Array.isArray(types) ? types : [])
        .filter(t => Object.hasOwn(LOTTERY_RULES, t));
    if (!validTypes.length) return { lotteries: {} };

    const out = {};
    await Promise.all(validTypes.map(async (type) => {
        const latest = await fetchLatestExternal(type);
        if (latest) {
            await bulkInsertDraws(sql, [latest]);
        }
        await backfillIfSparse(sql, type);

        const sinceConcurso = Math.max(0, parseInt(since?.[type], 10) || 0);
        const rows = await sql.query(
            `SELECT concurso, data, data_apuracao, dezenas, acumulou, valor_estimado
               FROM lottery_results
              WHERE lottery_type = $1 AND concurso > $2
              ORDER BY concurso DESC`,
            [type, sinceConcurso]
        );

        out[type] = {
            draws: rows.map(r => ({
                lotteryType: type,
                concurso: r.concurso,
                data: r.data || r.data_apuracao,
                dataApuracao: r.data_apuracao || r.data,
                dezenas: r.dezenas,
                acumulado: Boolean(r.acumulou),
                valor: r.valor_estimado ? Number(r.valor_estimado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : ''
            })),
            syncedFromApi: Boolean(latest)
        };
    }));

    return { lotteries: out };
}

