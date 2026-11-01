/**
 * Testes da calibração do AntiCrowdEngine (item 6.8 da auditoria).
 *
 * O item 6.8 declarou os priors com proveniência e deixou a calibração "para
 * quando houver dado". Dado de apostas por dezena não existe publicamente no
 * Brasil, então o que se testa aqui é o que **pode** ser garantido sem ele:
 *
 *  - o pipeline de ingestão faz a conta certa e recusa entrada inválida;
 *  - o intervalo de confiança diz quando a amostra **não** distingue uma dezena
 *    da média (em vez de fingir precisão);
 *  - a calibração entra no motor e muda os pesos na direção esperada;
 *  - a análise de sensibilidade é determinística e mede o que diz medir.
 *
 * A última parte é a mais importante: sem dado, a pergunta honesta é "a escolha
 * depende das magnitudes que não medimos?". Só faz sentido publicar essa resposta
 * se as métricas forem verificáveis.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    parsePopularityCsv,
    deriveWeightsFromCounts,
    priorSensitivity,
    ticketScoreSensitivity,
    priorInfluence,
    spearman,
    totalVariationDistance,
    popularitySlope,
    RANKING_PRIORS,
    TICKET_PRIORS,
    DEFAULT_ALPHA
} from '../js/engine/crowdCalibration.js';
import { AntiCrowdEngine, CROWD_PRIORS } from '../js/engine/antiCrowdEngine.js';

const mega = { total: 60, pick: 6, drawn: 6 };

/** Tabela sintética: dezenas de data (≤12) mais apostadas, >31 menos. */
function tabelaSintetica(total = 60) {
    const counts = {};
    for (let n = 1; n <= total; n++) {
        if (n <= 12) counts[n] = 500000;
        else if (n <= 31) counts[n] = 400000;
        else counts[n] = 300000;
    }
    return counts;
}

describe('parsePopularityCsv — ingestão de apostas por dezena', () => {
    it('lê cabeçalho, comentários e os três separadores aceitos', () => {
        const csv = [
            '# apostas por dezena — Mega-Sena',
            'dezena,apostas',
            '1,412530',
            '2;398112',
            '3\t355000',
            '',
            '4|300000'
        ].join('\n');

        const parsed = parsePopularityCsv(csv);
        assert.deepEqual(Object.keys(parsed.counts).map(Number), [1, 2, 3, 4]);
        assert.equal(parsed.counts[1], 412530);
        assert.equal(parsed.counts[2], 398112);
        assert.equal(parsed.counts[3], 355000);
        assert.equal(parsed.counts[4], 300000);
        assert.equal(parsed.sampleSize, 412530 + 398112 + 355000 + 300000);
        assert.equal(parsed.lines, 5, 'linhas contadas excluem comentário e linha vazia');
        assert.ok(
            parsed.issues.some(i => i.reason === 'cabeçalho ignorado'),
            'o cabeçalho precisa ser registrado como ignorado, não virar erro silencioso'
        );
    });

    it('soma dezenas repetidas e registra o motivo', () => {
        const parsed = parsePopularityCsv('1,100\n2,200\n1,50\n');
        assert.equal(parsed.counts[1], 150);
        assert.equal(parsed.sampleSize, 350);
        assert.ok(parsed.issues.some(i => /repetida/.test(i.reason)));
    });

    it('recusa quantidade ou dezena inválida sem derrubar a leitura', () => {
        const parsed = parsePopularityCsv('1,100\n2,abc\n-3,50\n4\n0,10\n5,200\n');
        assert.deepEqual(Object.keys(parsed.counts).map(Number), [1, 5]);
        assert.equal(parsed.sampleSize, 300);
        assert.equal(parsed.issues.filter(i => /quantidade|dezena precisa|linha precisa/.test(i.reason)).length, 4);
    });

    it('texto vazio não inventa dado', () => {
        const parsed = parsePopularityCsv('\n\n# só comentário\n');
        assert.equal(Object.keys(parsed.counts).length, 0);
        assert.equal(parsed.sampleSize, 0);
        assert.equal(parsed.lines, 0);
    });

    it('rejeita entrada que não é texto', () => {
        assert.throws(() => parsePopularityCsv(null), TypeError);
        assert.throws(() => parsePopularityCsv(42), TypeError);
    });
});

describe('deriveWeightsFromCounts — de apostas para pesos', () => {
    it('tabela uniforme devolve todos os pesos no ponto neutro', () => {
        const counts = {};
        for (let n = 1; n <= 60; n++) counts[n] = 100000;

        const relatorio = deriveWeightsFromCounts(counts, { total: 60 });
        assert.equal(relatorio.complete, true);
        assert.equal(relatorio.diagnostics.distinguishable, 0, 'amostra uniforme não distingue ninguém');
        for (const item of relatorio.numbers) {
            assert.equal(item.relative, 1);
            assert.equal(item.weight, CROWD_PRIORS.baseWeight.value);
        }
    });

    it('mais apostada recebe peso menor, e a escala respeita piso e teto', () => {
        const relatorio = deriveWeightsFromCounts(tabelaSintetica(), { total: 60 });
        const porDezena = new Map(relatorio.numbers.map(item => [item.number, item]));

        // 7 é dezena de data (500k apostas), 45 não é (300k).
        assert.ok(porDezena.get(7).weight < porDezena.get(45).weight, 'dezena popular precisa pesar menos');

        for (const item of relatorio.numbers) {
            assert.ok(
                item.weight >= CROWD_PRIORS.minWeight.value - 1e-9 &&
                    item.weight <= CROWD_PRIORS.maxWeight.value + 1e-9,
                `peso fora da escala: ${item.number} = ${item.weight}`
            );
            assert.ok(item.weightRange[0] <= item.weight && item.weight <= item.weightRange[1]);
        }
    });

    it('a inclinação é derivada dos priors, não inventada', () => {
        const base = CROWD_PRIORS.baseWeight.value;
        const piso = CROWD_PRIORS.minWeight.value;
        const teto = CROWD_PRIORS.maxWeight.value;
        const inclinacao = (base - piso) / 0.5;
        assert.equal(popularitySlope(), inclinacao);

        // A conta tem de ser exatamente a reta declarada: peso = base − inclinação·(relativo − 1).
        const relatorio = deriveWeightsFromCounts({ 1: 1500, 2: 1000, 3: 1000, 4: 1000 }, { total: 4, alpha: 1e-9 });
        for (const item of relatorio.numbers) {
            const esperado = Math.min(teto, Math.max(piso, base - inclinacao * (item.relative - 1)));
            assert.ok(Math.abs(item.weight - esperado) < 1e-3, `${item.number}: ${item.weight} != ${esperado}`);
        }

        // "Relativo" é contra a média das dezenas, não contra a uniforme: 1,33 acima da média
        // para a dezena com 1500 de 4500 apostas espalhadas em 4 dezenas.
        assert.equal(relatorio.numbers[0].relative, 1.3333);

        // Extremos ficam presos na escala em vez de gerar peso negativo ou acima de 1.
        const extremo = deriveWeightsFromCounts({ 1: 10000, 2: 100, 3: 100, 4: 100 }, { total: 4, alpha: 1e-9 });
        assert.equal(extremo.numbers[0].weight, piso);
        assert.equal(extremo.numbers[1].weight, teto);
    });

    it('o intervalo diz quando a amostra não distingue a dezena da média', () => {
        const pequeno = deriveWeightsFromCounts({ 1: 12, 2: 9, 3: 11, 4: 10 }, { total: 4 });
        assert.equal(pequeno.diagnostics.distinguishable, 0, 'com 42 apostas nada se distingue');

        const grande = {};
        for (let n = 1; n <= 60; n++) grande[n] = n <= 12 ? 600000 : 300000;
        const enorme = deriveWeightsFromCounts(grande, { total: 60 });
        assert.ok(enorme.diagnostics.distinguishable >= 12, 'com milhões de apostas as dezenas de data se destacam');
    });

    it('aponta cobertura incompleta em vez de preencher sozinha', () => {
        const relatorio = deriveWeightsFromCounts({ 1: 1000, 2: 900, 60: 700 }, { total: 60 });
        assert.equal(relatorio.complete, false);
        assert.equal(relatorio.numbersCovered, 3);
        assert.equal(relatorio.missing.length, 57);
        assert.match(relatorio.diagnostics.note, /3 de 60/);
    });

    it('recusa entrada insuficiente com erro claro', () => {
        assert.throws(() => deriveWeightsFromCounts(null, { total: 60 }), TypeError);
        assert.throws(() => deriveWeightsFromCounts({ 1: 100 }, { total: 60 }), RangeError);
        assert.throws(() => deriveWeightsFromCounts({ 1: 0, 2: 0 }, { total: 60 }), RangeError);
        assert.throws(() => deriveWeightsFromCounts({ 1: 10, 2: 10 }, { total: 1 }), RangeError);
        assert.equal(DEFAULT_ALPHA, 0.5);
    });

    it('o resultado entra no motor e muda o peso de verdade', () => {
        const relatorio = deriveWeightsFromCounts(tabelaSintetica(), { total: 60 });
        try {
            const antes = AntiCrowdEngine.getNumberAntiCrowdWeight(45, mega.total);
            AntiCrowdEngine.setCalibration({
                popularityByNumber: relatorio.weights,
                sampleSize: relatorio.sampleSize,
                source: 'tabela sintética'
            });
            const depois = AntiCrowdEngine.getNumberAntiCrowdWeight(45, mega.total);
            const calibracao = AntiCrowdEngine.getCalibration();

            assert.equal(calibracao.calibrated, true);
            assert.equal(calibracao.source, 'tabela sintética');
            assert.ok(calibracao.shrinkageLambda > 0 && calibracao.shrinkageLambda < 1);
            assert.notEqual(antes, depois, 'com calibração ativa o peso precisa sair do prior');
        } finally {
            AntiCrowdEngine.clearCalibration();
        }
    });
});

describe('Métricas da sensibilidade', () => {
    it('Spearman trata empates pela média', () => {
        assert.equal(spearman([1, 2, 3, 4], [1, 2, 3, 4]), 1);
        assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
        assert.ok(Math.abs(spearman([1, 2, 3, 4], [1, 2, 3, 4]) - 1) < 1e-12);
        // Tudo igual: correlação indefinida vira 1 (nenhuma ordem mudou).
        assert.equal(spearman([2, 2, 2], [5, 5, 5]), 1);
    });

    it('a distância de variação total fica em [0, 1] e lê como massa movida', () => {
        assert.equal(totalVariationDistance([0.5, 0.5], [0.5, 0.5]), 0);
        assert.equal(totalVariationDistance([1, 0], [0, 1]), 1);
        assert.ok(Math.abs(totalVariationDistance([0.75, 0.25], [0.5, 0.5]) - 0.25) < 1e-12);
    });
});

describe('priorSensitivity — a ordem das dezenas depende dos priors?', () => {
    it('é determinística para a mesma semente', () => {
        const a = priorSensitivity({ perturbations: 25 });
        const b = priorSensitivity({ perturbations: 25 });
        assert.deepEqual(a.report, b.report, 'sem determinismo o número publicado não é verificável');

        const c = priorSensitivity({ perturbations: 25, seed: 999 });
        assert.notDeepEqual(a.report, c.report, 'semente diferente precisa dar sorteio diferente');
    });

    it('as métricas ficam nas faixas que dizem medir', () => {
        const { report, priorsPerturbed } = priorSensitivity({ perturbations: 40 });
        assert.deepEqual(priorsPerturbed, [...RANKING_PRIORS]);

        for (const [loteria, dados] of Object.entries(report)) {
            assert.ok(dados.weightRankCorrelation.min >= -1 && dados.weightRankCorrelation.max <= 1, loteria);
            assert.ok(dados.weightRankCorrelation.median >= dados.weightRankCorrelation.min);
            assert.ok(dados.samplingShift.median >= 0 && dados.samplingShift.max <= 1, loteria);
            assert.ok(dados.numbersAffected.max <= dados.total);
        }
        // Ordem não pode ser destruída por perturbação de ±50% nos priors de ordem.
        for (const dados of Object.values(report)) {
            assert.ok(dados.weightRankCorrelation.median > 0.9, 'a sensibilidade mediana alta é o achado do relatório');
        }
    });

    it('valida a magnitude da perturbação', () => {
        assert.throws(() => priorSensitivity({ magnitude: 0 }), RangeError);
        assert.throws(() => priorSensitivity({ magnitude: 1 }), RangeError);
        assert.throws(() => priorSensitivity({ perturbations: 0 }), RangeError);
    });
});

describe('ticketScoreSensitivity — a nota do bilhete depende dos priors?', () => {
    it('mede nota, rótulo e multiplicador de EV', () => {
        const { report, priorsPerturbed } = ticketScoreSensitivity({ perturbations: 20, ticketsPerLottery: 20 });
        assert.deepEqual(priorsPerturbed, [...TICKET_PRIORS]);

        for (const [loteria, dados] of Object.entries(report)) {
            assert.equal(dados.tickets, 20);
            assert.ok(dados.scoreRankCorrelation.median <= 1 && dados.scoreRankCorrelation.median > 0, loteria);
            assert.ok(dados.maxScoreShiftPoints >= 0);
            assert.ok(dados.riskLabelChangeShare.median >= 0 && dados.riskLabelChangeShare.max <= 1);
            assert.ok(dados.evMultiplierRange.min <= dados.evMultiplierRange.max);
        }
    });

    it('o multiplicador de EV é sensível e o relatório mostra a amplitude', () => {
        const { report } = ticketScoreSensitivity({ perturbations: 25 });
        const mega = report.mega;
        // Este é o achado que sustenta tratar o EV como sinal ordinal, não medida.
        assert.ok(
            mega.evMultiplierRange.max - mega.evMultiplierRange.min > 0.3,
            `amplitude de EV pequena demais para o que o relatório afirma: ${JSON.stringify(mega.evMultiplierRange)}`
        );
    });
});

describe('priorInfluence — por onde começar a medir', () => {
    it('ranqueia os priors e identifica os inertes por universo', () => {
        const { report } = priorInfluence();
        const megaRows = report.mega;
        const lotofacilRows = report.lotofacil;

        assert.equal(megaRows.length, RANKING_PRIORS.length);
        assert.equal(lotofacilRows.length, RANKING_PRIORS.length);
        for (const rows of [megaRows, lotofacilRows]) {
            for (let i = 1; i < rows.length; i++) {
                assert.ok(rows[i - 1].worstRho <= rows[i].worstRho, 'a lista precisa estar ordenada por influência');
            }
        }

        // Na Mega (60 dezenas) a penalidade de borda da Lotofácil não é lida.
        const borda = megaRows.find(row => row.prior === 'edgePenaltyLotofacil');
        assert.equal(borda.numbersAffected, 0);
        assert.equal(borda.worstRho, 1, 'prior não lido não pode mudar a ordem');

        // Na Lotofácil (25 dezenas) o bônus para dezenas > 31 não é lido.
        const acima31 = lotofacilRows.find(row => row.prior === 'above31Bonus');
        assert.equal(acima31.numbersAffected, 0);
        assert.equal(acima31.worstRho, 1);

        // E o viés de data, que é o mais citado, precisa aparecer como influente na Mega.
        const datas = megaRows.find(row => row.prior === 'monthOverlapPenalty');
        assert.ok(datas.worstRho < 1, 'o viés de mês tem de mexer em alguma coisa na Mega-Sena');
    });
});

describe('withPriorOverrides — perturbação sem cópia da fórmula', () => {
    it('restaura os priors mesmo quando a função lança', () => {
        const antes = Object.fromEntries(Object.entries(CROWD_PRIORS).map(([k, v]) => [k, v.value]));
        assert.throws(() =>
            AntiCrowdEngine.withPriorOverrides({ luckyPenalty: 0.9 }, () => {
                assert.equal(CROWD_PRIORS.luckyPenalty.value, 0.9);
                throw new Error('falha proposital');
            })
        );
        const depois = Object.fromEntries(Object.entries(CROWD_PRIORS).map(([k, v]) => [k, v.value]));
        assert.deepEqual(depois, antes, 'prior mexido e não restaurado contaminaria todo o app');
    });

    it('recusa prior inexistente e valor não numérico', () => {
        assert.throws(() => AntiCrowdEngine.withPriorOverrides({ inventado: 1 }, () => 1), RangeError);
        assert.throws(() => AntiCrowdEngine.withPriorOverrides({ luckyPenalty: 'muito' }, () => 1), TypeError);
        assert.throws(() => AntiCrowdEngine.withPriorOverrides(null, () => 1), TypeError);
        assert.throws(() => AntiCrowdEngine.withPriorOverrides({}, 'não é função'), TypeError);
    });
});
