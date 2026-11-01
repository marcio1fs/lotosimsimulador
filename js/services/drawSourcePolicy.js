/**
 * DrawSourcePolicy — de onde vêm os resultados, em que ordem e com qual validação
 *
 * O PROBLEMA
 * ----------
 * O aplicativo dependia de `loteriascaixa-api.herokuapp.com` como fonte
 * primária: um espelho comunitário hospedado em Heroku, mantido por terceiro,
 * sem SLA. O endpoint oficial (`servicebus2.caixa.gov.br`) existia como
 * fallback. Se o Heroku descontinuar o serviço gratuito — como já fez outras
 * vezes — o app perde a fonte principal de dados.
 *
 * Pior: no servidor a "prioridade" era fictícia. O código usava
 * `Promise.any([caixa, mirror])`, que retorna **a primeira resposta que
 * chegar**, não a primeira da lista. O espelho, sendo mais rápido, ganhava quase
 * sempre. A ordem do array parecia dizer "oficial primeiro", mas não dizia nada.
 *
 * A REGRA
 * -------
 * Prioridade é execução **sequencial**: tenta a fonte oficial; se ela falhar,
 * então tenta a seguinte. Uma corrida só é aceitável entre fontes de mesma
 * confiabilidade — nunca entre oficial e espelho.
 *
 * Capacidades são diferentes e precisam estar declaradas:
 *
 * | Fonte | Último concurso | Histórico completo | CORS no navegador |
 * |---|---|---|---|
 * | Caixa (oficial) | sim | **não** (API só publica o último) | **não** |
 * | Espelho Heroku | sim | sim | sim |
 *
 * Consequências diretas:
 * - No **servidor**, onde não há CORS, a ordem é oficial → espelho.
 * - No **navegador**, a fonte oficial é tentada primeiro mesmo assim: a falha
 *   de CORS é imediata (a resposta é rejeitada antes do corpo), então custa
 *   uma viagem de rede e cai para o espelho. Se um dia a Caixa habilitar CORS,
 *   a ordem já está correta e nada muda.
 * - **Histórico completo só o espelho tem.** Isso é uma dependência real e
 *   documentada, não um detalhe de implementação: sem o espelho, o histórico
 *   precisa ser reconstruído concurso por concurso a partir da fonte oficial.
 *
 * DEGRADAÇÃO
 * ----------
 * Quando nenhuma fonte externa responde, o resultado precisa dizer isso
 * (`degraded: true` + `sourcesTried`), e o chamador deve servir o cache. Um
 * sistema que devolve dados antigos sem avisar é pior que um que falha.
 */

/** Regras de cada modalidade (espelho das configs do modelo). */
export const DRAW_RULES = {
    lotofacil: { apiName: 'lotofacil', total: 25, drawn: 15 },
    mega: { apiName: 'megasena', total: 60, drawn: 6 },
    lotomania: { apiName: 'lotomania', total: 100, drawn: 20 },
    quina: { apiName: 'quina', total: 80, drawn: 5 }
};

/**
 * Fontes de dados, em ordem de prioridade.
 * `corsFromBrowser: false` significa que o navegador pode ser bloqueado.
 */
export const DRAW_SOURCES = [
    {
        id: 'caixa',
        label: 'Caixa Econômica (oficial)',
        priority: 1,
        baseUrl: 'https://servicebus2.caixa.gov.br/portaldeloterias/api',
        supportsHistory: false,
        corsFromBrowser: false
    },
    {
        id: 'mirror',
        label: 'Espelho comunitário (Heroku)',
        priority: 2,
        baseUrl: 'https://loteriascaixa-api.herokuapp.com/api',
        supportsHistory: true,
        corsFromBrowser: true
    }
];

/**
 * Monta a URL de uma fonte.
 * @param {object} source
 * @param {string} apiName
 * @param {object} [options]
 * @param {boolean} [options.history=false]
 * @returns {string}
 */
export function urlFor(source, apiName, options = {}) {
    if (!source || !apiName) throw new TypeError('source e apiName são obrigatórios');
    if (options.history) {
        if (!source.supportsHistory) {
            throw new Error(`Fonte "${source.id}" não publica histórico completo`);
        }
        return `${source.baseUrl}/${apiName}`;
    }
    // A Caixa publica o último concurso na própria raiz; o espelho em /latest.
    return source.id === 'caixa'
        ? `${source.baseUrl}/${apiName}`
        : `${source.baseUrl}/${apiName}/latest`;
}

/**
 * Validates estrita de um concurso (schema + regras do jogo).
 *
 * Diferente de "filtrar o que é inválido e seguir", aqui o registro inválido é
 * **rejeitado com motivo**. Aceitar parcialmente um sorteio corrompido contamina
 * todas as estatísticas calculadas depois.
 *
 * @param {object} payload
 * @param {string} type
 * @returns {{ok: boolean, draw: object|null, errors: string[]}}
 */
export function validateDraw(payload, type) {
    const rule = DRAW_RULES[type];
    if (!rule) return { ok: false, draw: null, errors: [`modalidade desconhecida: ${type}`] };
    if (!payload || typeof payload !== 'object') {
        return { ok: false, draw: null, errors: ['payload não é objeto'] };
    }

    const errors = [];

    const concurso = parseInt(payload.concurso ?? payload.numero, 10);
    if (!Number.isInteger(concurso) || concurso <= 0) {
        errors.push('concurso inválido');
    }

    let rawDezenas = null;
    if (Array.isArray(payload.listaDezenas)) rawDezenas = payload.listaDezenas;
    else if (Array.isArray(payload.dezenas)) rawDezenas = payload.dezenas;
    else if (Array.isArray(payload.dezenasOrdemSorteio)) rawDezenas = payload.dezenasOrdemSorteio;
    else if (Array.isArray(payload.dezenasSorteadasOrdemSorteio)) rawDezenas = payload.dezenasSorteadasOrdemSorteio;

    let dezenas = [];
    if (!rawDezenas) {
        errors.push('dezenas ausentes');
    } else {
        const numeric = rawDezenas.map(d => parseInt(d, 10));
        if (numeric.some(n => !Number.isInteger(n))) errors.push('dezena não numérica');
        const inRange = numeric.filter(n => Number.isInteger(n) && n >= 1 && n <= rule.total);
        if (inRange.length !== numeric.length) errors.push(`dezena fora do intervalo 1..${rule.total}`);
        const unique = [...new Set(inRange)].sort((a, b) => a - b);
        if (unique.length !== inRange.length) errors.push('dezena repetida');
        if (unique.length !== rule.drawn) {
            errors.push(`esperadas ${rule.drawn} dezenas, recebidas ${unique.length}`);
        }
        dezenas = unique;
    }

    if (errors.length > 0) return { ok: false, draw: null, errors };

    return {
        ok: true,
        errors: [],
        draw: {
            concurso,
            data: String(payload.dataApuracao ?? payload.data ?? ''),
            dezenas: dezenas.map(n => String(n).padStart(2, '0')),
            acumulou: Boolean(payload.acumulou ?? payload.acumulado),
            valorEstimado: payload.valorEstimadoProximoConcurso ?? payload.valorEstimado ?? null
        }
    };
}

/**
 * Valida uma lista de concursos, descartando (e contabilizando) os inválidos.
 * @param {Array} list
 * @param {string} type
 * @param {number} [maxDraws]
 * @returns {{draws: Array, rejected: Array<{index: number, errors: string[]}>, total: number}}
 */
export function parseDrawList(list, type, maxDraws = Infinity) {
    if (!Array.isArray(list)) return { draws: [], rejected: [{ index: -1, errors: ['lista inválida'] }], total: 0 };
    const draws = [];
    const rejected = [];
    for (let i = 0; i < list.length; i++) {
        const r = validateDraw(list[i], type);
        if (r.ok) {
            draws.push(r.draw);
            if (draws.length >= maxDraws) break;
        } else {
            rejected.push({ index: i, errors: r.errors });
        }
    }
    draws.sort((a, b) => b.concurso - a.concurso);
    return { draws, rejected, total: list.length };
}

/**
 * Compara dois concursos de fontes diferentes.
 * @returns {{conflict: boolean, reason: string}}
 */
export function detectConflict(a, b) {
    if (!a || !b) return { conflict: false, reason: 'comparação impossível (fonte ausente)' };
    if (a.concurso !== b.concurso) {
        return {
            conflict: true,
            reason: `concursos diferentes: ${a.concurso} vs ${b.concurso}`
        };
    }
    const da = [...a.dezenas].sort().join(',');
    const db = [...b.dezenas].sort().join(',');
    if (da !== db) {
        return { conflict: true, reason: `mesmo concurso ${a.concurso}, dezenas divergentes` };
    }
    return { conflict: false, reason: 'fontes concordam' };
}

/**
 * Executa a busca em uma fonte, com timeout e tentativas.
 * @private
 */
async function trySource(source, url, fetchImpl, timeoutMs, retries, externalSignal) {
    let lastError = null;
    for (let attempt = 0; attempt < retries; attempt++) {
        const ctrl = new AbortController();
        const onAbort = () => ctrl.abort();
        externalSignal?.addEventListener?.('abort', onAbort, { once: true });
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const resp = await fetchImpl(url, {
                headers: { Accept: 'application/json' },
                signal: ctrl.signal
            });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return { json: await resp.json(), error: null };
        } catch (err) {
            lastError = err?.name === 'AbortError' ? 'timeout' : (err?.message || String(err));
        } finally {
            clearTimeout(timer);
            externalSignal?.removeEventListener?.('abort', onAbort);
        }
    }
    return { json: null, error: lastError };
}

/**
 * Resolve o **último concurso** tentando as fontes em ordem de prioridade.
 *
 * Sequencial de propósito: uma corrida entre oficial e espelho daria vitória a
 * quem responde primeiro, o que não é uma decisão de confiabilidade.
 *
 * @param {object} params
 * @param {string} params.type
 * @param {Function} [params.fetchImpl]
 * @param {number} [params.timeoutMs=4500]
 * @param {number} [params.retries=1]
 * @param {AbortSignal} [params.signal]
 * @param {Array} [params.sources] - permite restringir as fontes (testes)
 * @returns {Promise<{draw: object|null, sourceId: string|null, sourcesTried: Array, degraded: boolean, errors: Array}>}
 */
export async function resolveLatest(params = {}) {
    const { type, fetchImpl = globalThis.fetch, timeoutMs = 4500, retries = 1, signal } = params;
    const rule = DRAW_RULES[type];
    if (!rule) throw new TypeError(`modalidade desconhecida: ${type}`);
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch indisponível');

    const sources = (params.sources || DRAW_SOURCES)
        .slice()
        .sort((a, b) => a.priority - b.priority);

    const sourcesTried = [];
    const errors = [];

    for (const source of sources) {
        const url = urlFor(source, rule.apiName);
        const { json, error } = await trySource(source, url, fetchImpl, timeoutMs, retries, signal);
        if (!json) {
            sourcesTried.push({ id: source.id, url, ok: false, error });
            errors.push({ source: source.id, error });
            continue;
        }
        const validation = validateDraw(json, type);
        if (!validation.ok) {
            sourcesTried.push({ id: source.id, url, ok: false, error: validation.errors.join('; ') });
            errors.push({ source: source.id, error: validation.errors.join('; ') });
            continue;
        }
        sourcesTried.push({ id: source.id, url, ok: true, error: null });
        return {
            draw: validation.draw,
            sourceId: source.id,
            sourcesTried,
            degraded: false,
            errors
        };
    }

    return { draw: null, sourceId: null, sourcesTried, degraded: true, errors };
}

/**
 * Resolve o **histórico completo**. Só as fontes com `supportsHistory` entram.
 *
 * @param {object} params
 * @returns {Promise<{draws: Array, sourceId: string|null, rejected: Array, degraded: boolean, sourcesTried: Array}>}
 */
export async function resolveHistory(params = {}) {
    const { type, fetchImpl = globalThis.fetch, timeoutMs = 8000, retries = 1, maxDraws = 300 } = params;
    const rule = DRAW_RULES[type];
    if (!rule) throw new TypeError(`modalidade desconhecida: ${type}`);

    const sources = (params.sources || DRAW_SOURCES)
        .filter(s => s.supportsHistory)
        .sort((a, b) => a.priority - b.priority);

    const sourcesTried = [];
    for (const source of sources) {
        const url = urlFor(source, rule.apiName, { history: true });
        const { json, error } = await trySource(source, url, fetchImpl, timeoutMs, retries);
        if (!json) {
            sourcesTried.push({ id: source.id, url, ok: false, error });
            continue;
        }
        const parsed = parseDrawList(json, type, maxDraws);
        if (parsed.draws.length === 0) {
            sourcesTried.push({ id: source.id, url, ok: false, error: 'nenhum concurso válido' });
            continue;
        }
        sourcesTried.push({ id: source.id, url, ok: true, error: null });
        return {
            draws: parsed.draws,
            sourceId: source.id,
            rejected: parsed.rejected,
            degraded: false,
            sourcesTried
        };
    }

    return { draws: [], sourceId: null, rejected: [], degraded: true, sourcesTried };
}

/**
 * Recurso de teste: descreve as fontes e suas capacidades.
 * @returns {Array<object>}
 */
export function describeSources() {
    return DRAW_SOURCES.map(s => ({ ...s }));
}
