/**
 * Lista de tabelas, colunas e índices que o front-end pode usar.
 * Nada fora desta lista chega ao SQL. "owner" indica a coluna que prende a linha ao usuário logado.
 */
export const TABLES = {
    games: {
        pk: 'id',
        owner: 'user_id',
        columns: [
            'lottery_type',
            'numbers',
            'strategy',
            'model_score',
            'historical_performance',
            'expected_hits',
            'confidence_level',
            'probability_type',
            'explanations',
            'stats',
            'status',
            'created_at'
        ],
        json: ['numbers', 'explanations', 'stats'],
        indexes: ['user_id', 'lottery_type'],
        order: 'id DESC'
    },
    simulations: {
        pk: 'id',
        owner: 'user_id',
        columns: [
            'lottery_type',
            'strategy',
            'total_games',
            'games_count',
            'results_count',
            'results',
            'score',
            'created_at'
        ],
        json: ['results'],
        indexes: ['user_id'],
        order: 'id DESC'
    },
    user_stats: {
        pk: 'user_id',
        owner: 'user_id',
        columns: [
            'games_generated',
            'simulations',
            'results_analyzed',
            'total_games',
            'total_wins',
            'total_spent',
            'total_prize'
        ],
        json: [],
        indexes: [],
        order: 'user_id'
    },
    auto_settings: {
        pk: 'user_id',
        owner: 'user_id',
        columns: [
            'active',
            'auto_fetch',
            'auto_generate',
            'auto_conference',
            'auto_all_lotteries',
            'interval_minutes',
            'lottery_type',
            'strategy',
            'games_per_draw',
            'max_spend_per_draw'
        ],
        json: [],
        indexes: [],
        order: 'user_id'
    },
    auto_log: {
        pk: 'id',
        owner: 'user_id',
        columns: ['type', 'message', 'action', 'details', 'timestamp'],
        json: ['details'],
        indexes: ['user_id'],
        order: 'id DESC'
    },
    lottery_results: {
        pk: 'id',
        owner: null,
        shared: true,
        columns: [
            'lottery_type',
            'concurso',
            'data',
            'data_apuracao',
            'dezenas',
            'acumulou',
            'valor_estimado',
            'fetched_at'
        ],
        json: ['dezenas'],
        indexes: ['lottery_type', 'concurso'],
        order: 'concurso DESC',
        conflict: '(lottery_type, concurso)',
        noUpdate: true
    }
};

export const toSnake = s => s.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`);
export const toCamel = s => s.replace(/_([a-z])/g, (_, l) => l.toUpperCase());

export function rowToCamel(row) {
    if (!row) return row;
    const out = {};
    for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
    if (out.dataApuracao && !out.data) out.data = out.dataApuracao;
    else if (out.data && !out.dataApuracao) out.dataApuracao = out.data;
    return out;
}

/** Converte o payload do cliente em { colunas, valores } apenas com colunas permitidas. */
export function sanitizePayload(table, data) {
    const cfg = TABLES[table];
    const payload = {};
    for (const [k, v] of Object.entries(data || {})) {
        const col = toSnake(k);
        if (!cfg.columns.includes(col) || v === undefined) continue;
        payload[col] = v;
    }
    if (table === 'lottery_results') {
        if (payload.data && !payload.data_apuracao) payload.data_apuracao = payload.data;
        if (payload.data_apuracao && !payload.data) payload.data = payload.data_apuracao;
    }
    if (table === 'simulations' && payload.games_count !== undefined && payload.total_games === undefined) {
        payload.total_games = payload.games_count;
    }
    for (const col of cfg.json) {
        if (payload[col] === undefined || payload[col] === null) continue;
        let v = payload[col];
        // Corrige dupla serialização vinda de versões antigas do cliente
        if (typeof v === 'string') {
            try {
                v = JSON.parse(v);
            } catch {
                /* mantém string */
            }
        }
        payload[col] = JSON.stringify(v);
    }
    return payload;
}
