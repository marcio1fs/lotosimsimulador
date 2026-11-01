/**
 * Testes — PermutationTestEngine
 *
 * Cobre: mecânica do teste, fórmula do p-valor, preservação do multiconjunto na
 * permutação, determinismo, calibração em dados i.i.d. e integração com o
 * pipeline real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PermutationTestEngine, PERMUTATION_DISCLAIMER } from '../js/engine/permutationTestEngine.js';
import { LotteryModel } from '../js/models/lottery.js';
import { SeededRandom } from '../js/engine/prng.js';

const cfg = LotteryModel.CONFIG.lotofacil;

function makeHistory(draws, seed = 1234) {
    const rng = new SeededRandom(seed);
    const history = [];
    for (let i = 0; i < draws; i++) {
        const set = new Set();
        while (set.size < cfg.drawn) set.add(rng.nextInt(1, cfg.total));
        history.push({ concurso: draws - i, dezenas: [...set].sort((a, b) => a - b) });
    }
    return history;
}

describe('PermutationTestEngine — mecânica', () => {
    it('permuteHistory preserva o multiconjunto de concursos', () => {
        const history = makeHistory(30);
        const rng = new SeededRandom(99);
        const permuted = PermutationTestEngine.permuteHistory(history, rng);

        assert.equal(permuted.length, history.length);
        const key = d => `${d.concurso}:${d.dezenas.join(',')}`;
        assert.deepEqual(permuted.map(key).sort(), history.map(key).sort());
        assert.notDeepEqual(permuted.map(key), history.map(key), 'a ordem deveria mudar');
    });

    it('a permutação é determinística para a mesma semente', () => {
        const history = makeHistory(25);
        const a = PermutationTestEngine.permuteHistory(history, new SeededRandom(7));
        const b = PermutationTestEngine.permuteHistory(history, new SeededRandom(7));
        assert.deepEqual(a, b);
    });

    it('quantil interpola linearmente', () => {
        const sorted = [1, 2, 3, 4, 5];
        assert.equal(PermutationTestEngine.quantile(sorted, 0), 1);
        assert.equal(PermutationTestEngine.quantile(sorted, 1), 5);
        assert.equal(PermutationTestEngine.quantile(sorted, 0.5), 3);
        assert.equal(PermutationTestEngine.quantile(sorted, 0.25), 2);
        assert.equal(PermutationTestEngine.quantile([10], 0.9), 10);
        assert.equal(PermutationTestEngine.quantile([], 0.5), 0);
    });

    it('recusa histórico curto em vez de inventar resultado', () => {
        const r = PermutationTestEngine.run({ history: makeHistory(10), config: cfg, runs: 9 });
        assert.equal(r.available, false);
        assert.match(r.reason, /insuficiente/i);
        assert.equal(r.disclaimer, PERMUTATION_DISCLAIMER);
    });

    it('rejeita configuração inválida', () => {
        assert.throws(() => PermutationTestEngine.run({ history: makeHistory(30), config: null }), TypeError);
        assert.throws(() => PermutationTestEngine.run({ history: makeHistory(30), config: { total: 'x', drawn: 5 } }), TypeError);
    });
});

describe('PermutationTestEngine — p-valor', () => {
    const history = makeHistory(40);

    /** Estatística controlada: valor do primeiro concurso. */
    const firstValueStat = (h) => h[0].dezenas[0];

    it('p = (1 + #{nulo ≥ observado}) / (runs + 1)', () => {
        const runs = 19;
        const r = PermutationTestEngine.run({
            history, config: cfg, runs, windowSize: 5, seed: 3, statisticFn: firstValueStat
        });

        const atLeast = r.nullDistribution.filter(v => v >= r.observed).length;
        assert.equal(r.pValue, (1 + atLeast) / (runs + 1));
        assert.equal(r.nullDistribution.length, runs);
        assert.equal(r.runs, runs);
    });

    it('estatística constante produz p = 1 (nunca "significativa")', () => {
        const r = PermutationTestEngine.run({
            history, config: cfg, runs: 29, windowSize: 5, seed: 3, statisticFn: () => 9
        });
        assert.equal(r.observed, 9);
        assert.equal(r.pValue, 1);
        assert.equal(r.isSignificant, false);
        assert.equal(r.z, 0);
        assert.match(r.verdict, /NÃO extrai informação/);
    });

    /**
     * Estatística sensível à ordem: número de pares adjacentes decrescentes.
     * Histórico ordenado dá ~N-1; histórico embaralhado dá ~N/2. Não depende de
     * nenhum elemento específico cair em posição específica, então o resultado
     * é estável para qualquer semente.
     */
    const descents = (h) => {
        let c = 0;
        for (let i = 0; i < h.length - 1; i++) if (h[i].concurso > h[i + 1].concurso) c++;
        return c;
    };

    it('ordem real que carrega estrutura é detectada (cauda superior)', () => {
        const sorted = [...history].sort((a, b) => b.concurso - a.concurso);
        const r = PermutationTestEngine.run({
            history: sorted, config: cfg, runs: 29, windowSize: 5, seed: 3, statisticFn: descents
        });
        assert.equal(r.observed, sorted.length - 1);
        assert.ok(Math.abs(r.pValue - 1 / 30) < 1e-6, `p = ${r.pValue}`);
        assert.equal(r.isSignificant, true);
        assert.equal(r.direction, 'higher');
        assert.match(r.verdict, /supera a distribuição nula/);
    });

    it('ordem que prejudica o modelo é reportada na cauda inferior', () => {
        const reversed = [...history].sort((a, b) => a.concurso - b.concurso);
        const r = PermutationTestEngine.run({
            history: reversed, config: cfg, runs: 29, windowSize: 5, seed: 3, statisticFn: descents
        });
        assert.equal(r.observed, 0);
        assert.equal(r.isSignificant, false, 'cauda inferior não é evidência de vantagem');
        assert.equal(r.isSignificantLower, true);
        assert.equal(r.direction, 'lower');
        assert.match(r.verdict, /ABAIXO da distribuição nula/);
    });

    it('avisa quando o número de permutações impede rejeitar α', () => {
        // Com 19 permutações o menor p é 1/20 = 0,05, que NÃO é < 0,05: o teste
        // é estruturalmente incapaz de rejeitar. Isso precisa ser dito, não
        // virar um "não significativo" silencioso.
        const r = PermutationTestEngine.run({
            history, config: cfg, runs: 19, windowSize: 5, seed: 3, statisticFn: firstValueStat
        });
        assert.equal(r.underpowered, true);
        assert.ok(Math.abs(r.minAchievableP - 1 / 20) < 1e-6);
        assert.equal(r.runsNeededForAlpha, 20, 'com 20 permutações p_min = 1/21 < 0,05');
        assert.match(r.warning, /insuficiente|menor p possível|ao menos/i);
        assert.match(r.verdict, /insuficiente/i);
    });

    it('não avisa quando há permutações suficientes', () => {
        const r = PermutationTestEngine.run({
            history, config: cfg, runs: 39, windowSize: 5, seed: 3, statisticFn: firstValueStat
        });
        assert.equal(r.underpowered, false);
        assert.equal(r.warning, null);
    });

    it('é determinístico de ponta a ponta', () => {
        const opts = { history, config: cfg, runs: 11, windowSize: 5, seed: 42, statisticFn: firstValueStat };
        const a = PermutationTestEngine.run(opts);
        const b = PermutationTestEngine.run(opts);
        assert.deepEqual(a, b);
    });

    it('quantis do nulo são ordenados', () => {
        const r = PermutationTestEngine.run({
            history, config: cfg, runs: 29, windowSize: 5, seed: 8, statisticFn: firstValueStat
        });
        assert.ok(r.quantiles.p2_5 <= r.quantiles.p50);
        assert.ok(r.quantiles.p50 <= r.quantiles.p97_5);
        assert.ok(r.nullSd >= 0);
    });
});

describe('PermutationTestEngine — pipeline real', () => {
    it('roda o pipeline e devolve estrutura completa', () => {
        const history = makeHistory(60, 555);
        const r = PermutationTestEngine.run({
            history, config: cfg, runs: 9, windowSize: 10, seed: 2026
        });

        assert.equal(r.available, true);
        assert.equal(r.runs, 9);
        assert.equal(r.nullDistribution.length, 9);
        assert.ok(Number.isFinite(r.observed) && r.observed > 0);
        assert.ok(Number.isFinite(r.nullMean));
        assert.ok(r.pValue > 0 && r.pValue <= 1);
        assert.ok(r.verdict.length > 20);
        assert.equal(r.disclaimer, PERMUTATION_DISCLAIMER);
        assert.ok(r.nullDistribution.every(v => Number.isFinite(v)));
    });

    it('em histórico i.i.d., não declara vantagem (calibração)', () => {
        // Com dados sem estrutura temporal, a ordem real não pode ser melhor que
        // as embaralhadas. Roda 4 sementes: nenhuma deve declarar significância.
        // (Tudo é determinístico; o teste não é sensível a flutuação.)
        let significantes = 0;
        for (const seed of [11, 22, 33, 44]) {
            const r = PermutationTestEngine.run({
                history: makeHistory(80, 900 + seed),
                config: cfg,
                runs: 19,
                windowSize: 12,
                seed
            });
            if (r.isSignificant) significantes++;
        }
        assert.equal(significantes, 0, 'dados i.i.d. não podem produzir vantagem declarada');
    });

    it('summarize devolve só o essencial', () => {
        const r = PermutationTestEngine.run({ history: makeHistory(40), config: cfg, runs: 9, windowSize: 8, seed: 5 });
        const s = PermutationTestEngine.summarize(r);
        assert.equal(s.available, true);
        for (const k of ['observed', 'nullMean', 'pValue', 'pValueLower', 'direction', 'verdict', 'quantiles']) {
            assert.ok(k in s, `campo ${k} ausente`);
        }
        assert.ok(!('nullDistribution' in s), 'a distribuição inteira não deve ir para a interface');

        const short = PermutationTestEngine.summarize(
            PermutationTestEngine.run({ history: makeHistory(5), config: cfg })
        );
        assert.equal(short.available, false);
        assert.equal(PermutationTestEngine.summarize(null), null);
    });
});
