/**
 * Testes — DrawSourcePolicy (item 6.7)
 *
 * Cobre: prioridade sequencial das fontes (não corrida), capacidades declaradas,
 * validação estrita de esquema, detecção de conflito entre fontes e degradação
 * explícita quando nenhuma fonte responde.
 *
 * Nenhum teste toca a rede: `fetch` é sempre injetado.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    DRAW_SOURCES,
    DRAW_RULES,
    urlFor,
    validateDraw,
    parseDrawList,
    detectConflict,
    resolveLatest,
    resolveHistory,
    describeSources
} from '../js/services/drawSourcePolicy.js';
import { LotteryAPIService } from '../js/services/lotteryApi.js';

const CAIXA = DRAW_SOURCES.find(s => s.id === 'caixa');
const MIRROR = DRAW_SOURCES.find(s => s.id === 'mirror');

/** Payload válido de Lotofácil (15 dezenas). */
function lfPayload(concurso = 3200, dezenas = null) {
    return {
        concurso,
        dataApuracao: '01/11/2026',
        listaDezenas: dezenas || ['01', '02', '03', '04', '05', '06', '07', '08',
            '09', '10', '11', '12', '13', '14', '15'],
        acumulado: false,
        valorEstimadoProximoConcurso: 1700000
    };
}

/** fetch falso: `respostas` mapeia URL → corpo (ou função/erro). */
function makeFetch(respostas, registro = []) {
    return async (url) => {
        registro.push(url);
        const entrada = respostas[url];
        const valor = typeof entrada === 'function' ? await entrada() : entrada;
        if (valor instanceof Error) throw valor;
        if (valor === undefined) throw new Error(`404 não mapeado: ${url}`);
        if (valor && valor.__status && valor.__status !== 200) {
            return { ok: false, status: valor.__status, json: async () => ({}) };
        }
        return { ok: true, status: 200, json: async () => valor };
    };
}

const urlCaixa = urlFor(CAIXA, 'lotofacil');
const urlMirror = urlFor(MIRROR, 'lotofacil');

describe('DrawSourcePolicy — catálogo de fontes', () => {
    it('oficial tem prioridade sobre o espelho', () => {
        assert.ok(CAIXA.priority < MIRROR.priority);
        assert.match(CAIXA.label, /oficial/i);
    });

    it('declara que só o espelho publica histórico', () => {
        assert.equal(CAIXA.supportsHistory, false);
        assert.equal(MIRROR.supportsHistory, true);
    });

    it('declara a limitação de CORS do endpoint oficial no navegador', () => {
        assert.equal(CAIXA.corsFromBrowser, false);
        assert.equal(MIRROR.corsFromBrowser, true);
    });

    it('monta as URLs de cada fonte', () => {
        assert.equal(urlCaixa, 'https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil');
        assert.equal(urlMirror, 'https://loteriascaixa-api.herokuapp.com/api/lotofacil/latest');
        assert.equal(
            urlFor(MIRROR, 'megasena', { history: true }),
            'https://loteriascaixa-api.herokuapp.com/api/megasena'
        );
    });

    it('recusa pedir histórico a uma fonte que não publica histórico', () => {
        assert.throws(() => urlFor(CAIXA, 'lotofacil', { history: true }), /não publica histórico/);
    });

    it('describeSources devolve cópias (não expõe o catálogo mutável)', () => {
        const lista = describeSources();
        lista[0].priority = 99;
        assert.notEqual(DRAW_SOURCES[0].priority, 99);
    });

    it('as regras cobrem todas as modalidades suportadas', () => {
        for (const tipo of ['lotofacil', 'mega', 'lotomania', 'quina']) {
            assert.ok(DRAW_RULES[tipo], `${tipo} ausente`);
            assert.ok(Number.isInteger(DRAW_RULES[tipo].drawn));
        }
    });
});

describe('DrawSourcePolicy — validação de esquema', () => {
    it('aceita payload válido e normaliza as dezenas', () => {
        const r = validateDraw({ ...lfPayload(), listaDezenas: [15, 3, 7, 1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14] }, 'lotofacil');
        assert.equal(r.ok, true);
        assert.deepEqual(r.draw.dezenas, ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
            '11', '12', '13', '14', '15']);
        assert.equal(r.draw.concurso, 3200);
    });

    it('aceita as diferentes chaves usadas pelas duas fontes', () => {
        const dezenas = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        for (const campo of ['listaDezenas', 'dezenas', 'dezenasOrdemSorteio', 'dezenasSorteadasOrdemSorteio']) {
            const payload = { concurso: 1, [campo]: dezenas };
            const r = validateDraw(payload, 'lotofacil');
            assert.equal(r.ok, true, `falhou para ${campo}`);
        }
    });

    it('rejeita: dezenas ausentes', () => {
        const r = validateDraw({ concurso: 10 }, 'lotofacil');
        assert.equal(r.ok, false);
        assert.ok(r.errors.some(e => /dezenas ausentes/.test(e)));
    });

    it('rejeita: quantidade errada de dezenas', () => {
        const r = validateDraw({ concurso: 10, listaDezenas: [1, 2, 3] }, 'lotofacil');
        assert.equal(r.ok, false);
        assert.ok(r.errors.some(e => /esperadas 15/.test(e)));
    });

    it('rejeita: dezena fora do intervalo', () => {
        const r = validateDraw({ concurso: 10, listaDezenas: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 99] }, 'lotofacil');
        assert.equal(r.ok, false);
        assert.ok(r.errors.some(e => /fora do intervalo/.test(e)));
    });

    it('rejeita: dezena repetida', () => {
        const r = validateDraw({ concurso: 10, listaDezenas: [1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] }, 'lotofacil');
        assert.equal(r.ok, false);
        assert.ok(r.errors.some(e => /repetida/.test(e)));
    });

    it('rejeita: concurso inválido', () => {
        for (const concurso of [0, -5, 'abc', undefined]) {
            const r = validateDraw({ concurso, listaDezenas: Array.from({ length: 15 }, (_, i) => i + 1) }, 'lotofacil');
            assert.equal(r.ok, false, `concurso ${concurso} deveria falhar`);
        }
    });

    it('rejeita modalidade desconhecida e payload não-objeto', () => {
        assert.equal(validateDraw(lfPayload(), 'inexistente').ok, false);
        assert.equal(validateDraw(null, 'lotofacil').ok, false);
    });

    it('parseDrawList ordena por concurso e conta rejeições', () => {
        const lista = [lfPayload(1), lfPayload(3), { concurso: 2, listaDezenas: [1] }, lfPayload(2)];
        const r = parseDrawList(lista, 'lotofacil');
        assert.equal(r.draws.length, 3);
        assert.equal(r.rejected.length, 1);
        assert.deepEqual(r.draws.map(d => d.concurso), [3, 2, 1]);
    });

    it('parseDrawList respeita maxDraws', () => {
        const lista = Array.from({ length: 10 }, (_, i) => lfPayload(i + 1));
        assert.equal(parseDrawList(lista, 'lotofacil', 3).draws.length, 3);
    });
});

describe('DrawSourcePolicy — conflito entre fontes', () => {
    const a = { concurso: 100, dezenas: ['01', '02', '03'] };

    it('concursos diferentes são conflito', () => {
        const r = detectConflict(a, { concurso: 99, dezenas: a.dezenas });
        assert.equal(r.conflict, true);
        assert.match(r.reason, /concursos diferentes/);
    });

    it('mesmo concurso com dezenas divergentes é conflito', () => {
        const r = detectConflict(a, { concurso: 100, dezenas: ['01', '02', '04'] });
        assert.equal(r.conflict, true);
        assert.match(r.reason, /dezenas divergentes/);
    });

    it('fontes concordantes não geram conflito (ordem não importa)', () => {
        const r = detectConflict(a, { concurso: 100, dezenas: ['03', '01', '02'] });
        assert.equal(r.conflict, false);
    });

    it('fonte ausente não é conflito', () => {
        assert.equal(detectConflict(a, null).conflict, false);
        assert.equal(detectConflict(null, null).conflict, false);
    });
});

describe('DrawSourcePolicy — prioridade na resolução', () => {
    it('usa a fonte oficial primeiro e NÃO consulta o espelho quando ela responde', async () => {
        const registro = [];
        const fetchImpl = makeFetch({ [urlCaixa]: lfPayload(3200) }, registro);

        const r = await resolveLatest({ type: 'lotofacil', fetchImpl });
        assert.equal(r.sourceId, 'caixa');
        assert.equal(r.draw.concurso, 3200);
        assert.deepEqual(registro, [urlCaixa], 'o espelho não deveria ser consultado');
    });

    it('REGressão: espelho mais rápido não vence a prioridade', async () => {
        // Era exatamente isto que `Promise.any([caixa, mirror])` fazia: quem
        // respondesse primeiro ganhava. O espelho responde em 1ms, a oficial em
        // 20ms — e a resposta precisa continuar sendo a oficial.
        const registro = [];
        const fetchImpl = makeFetch({
            [urlCaixa]: async () => {
                await new Promise(res => setTimeout(res, 20));
                return lfPayload(4000);
            },
            [urlMirror]: async () => {
                await new Promise(res => setTimeout(res, 1));
                return lfPayload(4000);
            }
        }, registro);

        const r = await resolveLatest({ type: 'lotofacil', fetchImpl });
        assert.equal(r.sourceId, 'caixa');
        assert.deepEqual(registro, [urlCaixa]);
    });

    it('cai para o espelho quando a oficial falha por rede', async () => {
        const registro = [];
        const fetchImpl = makeFetch({
            [urlCaixa]: new Error('CORS bloqueado'),
            [urlMirror]: lfPayload(3201)
        }, registro);

        const r = await resolveLatest({ type: 'lotofacil', fetchImpl });
        assert.equal(r.sourceId, 'mirror');
        assert.equal(r.draw.concurso, 3201);
        assert.equal(r.degraded, false);
        assert.deepEqual(registro, [urlCaixa, urlMirror]);
        assert.equal(r.sourcesTried.length, 2);
        assert.equal(r.sourcesTried[0].ok, false);
    });

    it('cai para o espelho quando a oficial devolve payload inválido', async () => {
        const fetchImpl = makeFetch({
            [urlCaixa]: { concurso: 10, listaDezenas: [1, 2, 3] },
            [urlMirror]: lfPayload(3202)
        });
        const r = await resolveLatest({ type: 'lotofacil', fetchImpl });
        assert.equal(r.sourceId, 'mirror');
        assert.equal(r.draw.concurso, 3202);
        assert.match(r.sourcesTried[0].error, /esperadas 15/);
    });

    it('respeita retries por fonte', async () => {
        const registro = [];
        let tentativas = 0;
        const fetchImpl = makeFetch({
            [urlCaixa]: () => {
                tentativas++;
                return tentativas < 3 ? new Error('instável') : lfPayload(3300);
            }
        }, registro);

        const r = await resolveLatest({ type: 'lotofacil', fetchImpl, retries: 3 });
        assert.equal(r.sourceId, 'caixa');
        assert.equal(tentativas, 3);
    });

    it('degrada explicitamente quando nenhuma fonte responde', async () => {
        const fetchImpl = makeFetch({}); // tudo 404
        const r = await resolveLatest({ type: 'lotofacil', fetchImpl });

        assert.equal(r.draw, null);
        assert.equal(r.sourceId, null);
        assert.equal(r.degraded, true);
        assert.equal(r.sourcesTried.length, 2);
        assert.ok(r.sourcesTried.every(t => t.ok === false));
        assert.equal(r.errors.length, 2);
    });

    it('recusa modalidade desconhecida', async () => {
        await assert.rejects(
            () => resolveLatest({ type: 'inexistente', fetchImpl: makeFetch({}) }),
            /modalidade desconhecida/
        );
    });
});

describe('DrawSourcePolicy — histórico', () => {
    it('consulta apenas fontes que publicam histórico', async () => {
        const registro = [];
        const fetchImpl = makeFetch({ [urlFor(MIRROR, 'lotofacil', { history: true })]: [lfPayload(10), lfPayload(11)] }, registro);

        const r = await resolveHistory({ type: 'lotofacil', fetchImpl });
        assert.equal(r.sourceId, 'mirror');
        assert.equal(r.draws.length, 2);
        assert.equal(registro.length, 1, 'a fonte oficial não deveria ser consultada para histórico');
        assert.ok(!registro[0].includes('caixa.gov.br'));
    });

    it('degrada quando o espelho está fora', async () => {
        const r = await resolveHistory({ type: 'lotofacil', fetchImpl: makeFetch({}) });
        assert.equal(r.draws.length, 0);
        assert.equal(r.degraded, true);
        assert.equal(r.sourceId, null);
    });

    it('descarta registros inválidos em vez de aceitar parcialmente', async () => {
        const lista = [lfPayload(10), { concurso: 11, listaDezenas: [1, 2] }, lfPayload(12)];
        const fetchImpl = makeFetch({ [urlFor(MIRROR, 'lotofacil', { history: true })]: lista });
        const r = await resolveHistory({ type: 'lotofacil', fetchImpl });
        assert.equal(r.draws.length, 2);
        assert.equal(r.rejected.length, 1);
    });
});

describe('DrawSourcePolicy — integração com LotteryAPIService', () => {
    it('fetchLatest usa a fonte oficial primeiro', async () => {
        const registro = [];
        const original = globalThis.fetch;
        globalThis.fetch = makeFetch({ [urlCaixa]: lfPayload(5555) }, registro);
        try {
            const draw = await LotteryAPIService.fetchLatest('lotofacil', 1);
            assert.equal(draw.concurso, 5555);
            assert.equal(draw.source, 'caixa');
            assert.equal(draw.dezenas.length, 15);
            assert.equal(LotteryAPIService.lastResolution.lotofacil.sourceId, 'caixa');
        } finally {
            globalThis.fetch = original;
        }
    });

    it('parseAndValidateResult rejeita payload corrompido', () => {
        assert.equal(LotteryAPIService.parseAndValidateResult({ concurso: 1, listaDezenas: [1, 2] }, 'lotofacil'), null);
        const ok = LotteryAPIService.parseAndValidateResult(lfPayload(77), 'lotofacil');
        assert.equal(ok.concurso, 77);
        assert.equal(ok.dezenas.length, 15);
        assert.equal(ok.data, '01/11/2026');
    });

    it('getSources expõe as fontes com prioridade', () => {
        const fontes = LotteryAPIService.getSources();
        assert.equal(fontes[0].id, 'caixa');
        assert.ok(fontes[0].priority < fontes[1].priority);
    });
});
