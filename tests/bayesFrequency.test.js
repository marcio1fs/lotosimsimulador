/**
 * Testes — BayesFrequencyEngine
 *
 * Cobre: quantil beta (contra valores de referência de precisão estendida),
 * propriedades da CDF, encolhimento, intervalos de credibilidade, correção de
 * Bonferroni, estimativa empírica de κ, casos-limite e calibração por simulação.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BayesFrequencyEngine, BAYES_DISCLAIMER } from '../js/engine/bayesFrequencyEngine.js';
import { SeededRandom } from '../js/engine/prng.js';

const B = BayesFrequencyEngine;

/**
 * Valores de referência de qbeta(q, a, b) calculados com mpmath (50 dígitos,
 * inversão da função beta incompleta por bissecção tol=1e-30) — implementação
 * independente desta biblioteca.
 */
const QVBETA_REFERENCE = [
    { q: 0.025, a: 3, b: 5, expected: 0.09898827844250786 },
    { q: 0.975, a: 3, b: 5, expected: 0.7095791362626572 },
    { q: 0.5, a: 2, b: 5, expected: 0.26444998329565994 },
    { q: 0.975, a: 1, b: 1, expected: 0.975 },
    { q: 0.5, a: 0.5, b: 0.5, expected: 0.5 },
    { q: 0.95, a: 10, b: 30, expected: 0.368152901128835 },
    { q: 0.025, a: 60, b: 140, expected: 0.23863072762173496 },
    { q: 0.975, a: 61, b: 139, expected: 0.3704085497482857 },
    { q: 0.05, a: 2, b: 18, expected: 0.019033120121624 },
    { q: 0.975, a: 26, b: 74, expected: 0.3498167261621577 }
];

/** Gera frequências absolutas de um sorteio uniforme com PRNG semeado. */
function simulateUniform(total, drawn, drawCount, seed = 20260101) {
    const rng = new SeededRandom(seed);
    const freq = {};
    for (let i = 1; i <= total; i++) freq[i] = 0;
    for (let d = 0; d < drawCount; d++) {
        const set = new Set();
        while (set.size < drawn) set.add(rng.nextInt(1, total));
        for (const n of set) freq[n]++;
    }
    return freq;
}

describe('BayesFrequencyEngine — quantil da Beta', () => {
    it('confere com mpmath em 10 casos (tolerância 1e-10)', () => {
        for (const { q, a, b, expected } of QVBETA_REFERENCE) {
            const got = B.betaQuantile(q, a, b);
            assert.ok(Math.abs(got - expected) < 1e-10, `qbeta(${q}, ${a}, ${b}) = ${got}, esperado ${expected}`);
        }
    });

    it('é a inversa da própria CDF onde a CDF é invertível', () => {
        // A inversão só faz sentido onde a CDF não saturou em 0 ou 1. Em
        // Beta(30, 70), por exemplo, x = 0,75 está a ~9,8 desvios-padrão da
        // média: a CDF ali é 1 na precisão do double e a informação foi
        // perdida — nenhum algoritmo recupera x a partir de q = 1.
        for (const [a, b] of [
            [2, 5],
            [7, 3],
            [30, 70],
            [1.5, 1.5]
        ]) {
            for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
                const q = B.betaCDF(x, a, b);
                if (!(q > 1e-12 && q < 1 - 1e-12)) continue;
                const back = B.betaQuantile(q, a, b);
                assert.ok(Math.abs(back - x) < 1e-9, `a=${a} b=${b} x=${x} voltou ${back}`);
            }
        }
    });

    it('declara saturação em vez de inventar um valor', () => {
        // CDF saturada em 1 → quantil é 1 (o limite superior do domínio).
        assert.equal(B.betaCDF(0.75, 30, 70), 1);
        assert.equal(B.betaQuantile(1, 30, 70), 1);
        // No extremo oposto a cauda é minúscula, mas não zero: 0,01 está a
        // ~6,4 desvios-padrão da média. O valor exato importa — é o que mostra
        // que o cálculo não está truncando a cauda.
        assert.ok(B.betaCDF(0.01, 30, 70) < 1e-30, `CDF(0,01) = ${B.betaCDF(0.01, 30, 70)}`);
        assert.equal(B.betaQuantile(0, 30, 70), 0);
    });

    it('respeita a simetria I(x; a, b) = 1 − I(1−x; b, a)', () => {
        for (const [x, a, b] of [
            [0.3, 2, 5],
            [0.7, 6, 3],
            [0.42, 12, 8]
        ]) {
            const left = B.betaCDF(x, a, b);
            const right = 1 - B.betaCDF(1 - x, b, a);
            assert.ok(Math.abs(left - right) < 1e-10, `${left} vs ${right}`);
        }
    });

    it('retorna os extremos do domínio nos limites de q', () => {
        assert.equal(B.betaQuantile(0, 2, 3), 0);
        assert.equal(B.betaQuantile(1, 2, 3), 1);
        return assert.doesNotReject(async () => {});
    });

    it('CDF é monótona e limitada a [0, 1]', () => {
        let prev = 0;
        for (let i = 0; i <= 100; i++) {
            const v = B.betaCDF(i / 100, 3, 7);
            assert.ok(v >= prev - 1e-12, `não monótona em ${i / 100}`);
            assert.ok(v >= 0 && v <= 1);
            prev = v;
        }
    });

    it('rejeita parâmetros inválidos', () => {
        assert.throws(() => B.betaQuantile(0.5, 0, 1), RangeError);
        assert.throws(() => B.betaQuantile(0.5, 1, -2), RangeError);
        assert.throws(() => B.betaCDF(0.5, -1, 1), RangeError);
    });
});

describe('BayesFrequencyEngine — encolhimento', () => {
    const freq = simulateUniform(25, 15, 100);
    const base = { total: 25, drawn: 15, drawCount: 100 };

    it('a média a posteriori bate com a fórmula (α₀+k)/(α₀+β₀+N)', () => {
        const kappa = 40;
        const r = B.shrink(freq, { ...base, priorStrength: kappa });
        const p = 15 / 25;
        const a0 = kappa * p;
        for (const n of r.numbers) {
            const expected = (a0 + n.count) / (kappa + 100);
            assert.ok(Math.abs(n.shrunkRate - expected) < 1e-12, `dezena ${n.number}`);
        }
    });

    it('encolhe sempre entre a frequência bruta e a base', () => {
        const r = B.shrink(freq, base);
        for (const n of r.numbers) {
            const lo = Math.min(n.rawRate, r.baselineRate);
            const hi = Math.max(n.rawRate, r.baselineRate);
            assert.ok(
                n.shrunkRate >= lo - 1e-12 && n.shrunkRate <= hi + 1e-12,
                `dezena ${n.number}: ${n.shrunkRate} fora de [${lo}, ${hi}]`
            );
        }
    });

    it('o intervalo contém a estimativa pontual', () => {
        const r = B.shrink(freq, base);
        for (const n of r.numbers) {
            assert.ok(n.lower <= n.shrunkRate && n.shrunkRate <= n.upper, `dezena ${n.number}`);
        }
    });

    it('o intervalo exibido nunca é mais estreito que o de Wilson', () => {
        // O encolhimento muda a estimativa pontual, mas não pode fabricar
        // precisão: o intervalo mostrado tem de cobrir o de Wilson, que não
        // depende da hipótese de homogeneidade.
        for (const N of [10, 40, 100, 600]) {
            const r = B.shrink(simulateUniform(25, 15, N, 77), { total: 25, drawn: 15, drawCount: N });
            for (const n of r.numbers) {
                assert.ok(n.lower <= n.rawLower + 1e-12, `N=${N} dezena ${n.number} (inferior)`);
                assert.ok(n.upper >= n.rawUpper - 1e-12, `N=${N} dezena ${n.number} (superior)`);
            }
        }
    });

    it('não colapsa em [0, 1] quando não há concursos', () => {
        const empty = {};
        for (let i = 1; i <= 25; i++) empty[i] = 0;
        const r = B.shrink(empty, { total: 25, drawn: 15, drawCount: 0 });
        for (const n of r.numbers) {
            assert.ok(n.upper - n.lower < 0.5, `intervalo degenerado: ${n.lower}–${n.upper}`);
        }
    });

    it('o intervalo simultâneo é sempre mais largo que o marginal', () => {
        const r = B.shrink(freq, base);
        for (const n of r.numbers) {
            assert.ok(n.simultaneousLower <= n.lower + 1e-12);
            assert.ok(n.simultaneousUpper >= n.upper - 1e-12);
        }
    });

    it('não altera a ordenação das dezenas por frequência', () => {
        const r = B.shrink(freq, base);
        const byShrunk = [...r.numbers].sort((a, b) => b.shrunkRate - a.shrunkRate).map(n => n.number);
        const byRaw = [...r.numbers].sort((a, b) => b.rawRate - a.rawRate || a.number - b.number).map(n => n.number);
        assert.deepEqual(byShrunk, byRaw);
    });

    it('com N = 0 todas as dezenas colapsam na base', () => {
        const empty = {};
        for (let i = 1; i <= 25; i++) empty[i] = 0;
        const r = B.shrink(empty, { total: 25, drawn: 15, drawCount: 0 });
        const p = 15 / 25;
        for (const n of r.numbers) {
            assert.ok(Math.abs(n.shrunkRate - p) < 1e-12, `dezena ${n.number}`);
            assert.equal(n.count, 0);
            assert.equal(n.rawRate, 0);
            assert.ok(n.lower < p && p < n.upper);
        }
    });

    it('é determinístico', () => {
        const a = B.shrink(freq, base);
        const b = B.shrink(freq, base);
        assert.deepEqual(a.numbers, b.numbers);
    });

    it('aceita contagens como array', () => {
        const asArray = Array.from({ length: 25 }, (_, i) => freq[i + 1]);
        const a = B.shrink(freq, base);
        const b = B.shrink(asArray, base);
        assert.deepEqual(a.numbers, b.numbers);
    });

    it('protege contra contagens impossíveis', () => {
        const bad = { 1: 500, 2: -7 };
        for (let i = 3; i <= 25; i++) bad[i] = 0;
        const r = B.shrink(bad, base);
        assert.equal(r.numbers[0].count, 100, 'contagem acima de N deve ser limitada a N');
        assert.equal(r.numbers[1].count, 0, 'contagem negativa deve virar 0');
    });

    it('rejeita configuração inválida', () => {
        assert.throws(() => B.shrink(freq, { total: 0, drawn: 5, drawCount: 10 }), RangeError);
        assert.throws(() => B.shrink(freq, { total: 25, drawn: 30, drawCount: 10 }), RangeError);
        assert.throws(() => B.shrink(freq, { total: 25, drawn: 15, drawCount: 10, confidence: 1.5 }), RangeError);
    });
});

describe('BayesFrequencyEngine — força da prior (empirical Bayes)', () => {
    it('usa a prior dominante quando as frequências são uniformes', () => {
        const r = B.shrink(simulateUniform(25, 15, 100), { total: 25, drawn: 15, drawCount: 100 });
        assert.equal(r.prior.strength, B.DEFAULT_MAX_STRENGTH);
        assert.ok(r.heterogeneity.tau2 <= 1e-12);
        assert.equal(r.summary.distinguishable, 0);
    });

    it('reduz κ quando há heterogeneidade real', () => {
        const r = B.shrink(simulateUniform(25, 15, 100), { total: 25, drawn: 15, drawCount: 100 });
        const hetero = {};
        for (let i = 1; i <= 25; i++) hetero[i] = 30;
        hetero[1] = 95; // uma dezena claramente acima
        hetero[2] = 5; // e outra claramente abaixo
        const r2 = B.shrink(hetero, { total: 25, drawn: 15, drawCount: 100 });
        assert.ok(
            r2.prior.strength < r.prior.strength,
            `κ heterogêneo (${r2.prior.strength}) deveria ser menor que uniforme (${r.prior.strength})`
        );
    });

    it('detecta uma dezena realmente viciada', () => {
        const freq = {};
        for (let i = 1; i <= 80; i++) freq[i] = 19; // base ~6,3% em 300 concursos
        freq[7] = 120; // 40% — vício grosseiro
        const r = B.shrink(freq, { total: 80, drawn: 5, drawCount: 300 });
        const seven = r.numbers[6];
        assert.equal(seven.number, 7);
        assert.ok(seven.distinguishable, 'dezena 7 deveria ser distinguível');
        assert.ok(seven.distinguishableSimultaneous, 'dezena 7 deveria sobreviver a Bonferroni');
        assert.ok(seven.probAboveBaseline > 0.999);
        assert.equal(r.hot[0].number, 7);
    });

    it('P(acima da base) ≈ 0,5 para uma dezena na taxa base', () => {
        const r = B.shrink(simulateUniform(60, 6, 300), { total: 60, drawn: 6, drawCount: 300 });
        const middle = [...r.numbers].sort(
            (a, b) => Math.abs(a.rawRate - r.baselineRate) - Math.abs(b.rawRate - r.baselineRate)
        )[0];
        assert.ok(Math.abs(middle.probAboveBaseline - 0.5) < 0.15, `P = ${middle.probAboveBaseline}`);
    });

    it('o veredicto não depende do teto arbitrário de κ', () => {
        const freq = simulateUniform(60, 6, 500);
        const verdicts = [200, 2000, 20000].map(maxStrength => {
            const r = B.shrink(freq, { total: 60, drawn: 6, drawCount: 500, maxStrength });
            return r.summary.distinguishableSimultaneous;
        });
        assert.deepEqual(verdicts, [0, 0, 0]);
    });
});

describe('BayesFrequencyEngine — honestidade dos intervalos', () => {
    it('em sorteio uniforme, ≤ 5% das dezenas caem fora por acaso (marginal)', () => {
        let falsePositive = 0;
        let totalTested = 0;
        for (const seed of [11, 22, 33, 44, 55]) {
            const freq = simulateUniform(60, 6, 800, seed);
            const r = B.shrink(freq, { total: 60, drawn: 6, drawCount: 800 });
            falsePositive += r.summary.distinguishable;
            totalTested += 60;
        }
        const rate = falsePositive / totalTested;
        assert.ok(rate <= 0.05, `taxa de falso positivo marginal = ${(rate * 100).toFixed(1)}%`);
    });

    it('em sorteio uniforme, nenhuma sobrevive ao intervalo simultâneo', () => {
        for (const seed of [101, 202, 303]) {
            const freq = simulateUniform(60, 6, 600, seed);
            const r = B.shrink(freq, { total: 60, drawn: 6, drawCount: 600 });
            assert.equal(r.summary.distinguishableSimultaneous, 0, `seed ${seed}`);
        }
    });

    it('reporta a expectativa de falsos positivos por azar', () => {
        const r = B.shrink(simulateUniform(60, 6, 400), { total: 60, drawn: 6, drawCount: 400 });
        assert.ok(Math.abs(r.summary.expectedByChance - 3) < 1e-9);
        assert.ok(Math.abs(r.summary.expectedByChance - r.total * (1 - r.confidence)) < 1e-12);
    });

    it('o erro-padrão a posteriori diminui quando o histórico cresce', () => {
        const short = B.shrink(simulateUniform(25, 15, 20, 9), { total: 25, drawn: 15, drawCount: 20 });
        const long = B.shrink(simulateUniform(25, 15, 500, 9), { total: 25, drawn: 15, drawCount: 500 });
        const width = r => r.numbers.reduce((s, n) => s + (n.upper - n.lower), 0) / r.numbers.length;
        assert.ok(
            width(long) < width(short),
            `largura média com N=500 (${width(long)}) deveria ser menor que com N=20 (${width(short)})`
        );
    });
});

describe('BayesFrequencyEngine — apresentação', () => {
    it('formata porcentagem em pt-BR com uma casa', () => {
        assert.equal(B.formatPct(0.6), '60,0%');
        assert.equal(B.formatPct(0.12345), '12,3%');
        assert.equal(B.formatPct(0), '0,0%');
        assert.equal(B.formatPct(NaN), '0,0%');
    });

    it('expõe o aviso de escopo', () => {
        assert.ok(BAYES_DISCLAIMER.includes('não preveem'));
        const r = B.shrink(simulateUniform(60, 6, 100), { total: 60, drawn: 6, drawCount: 100 });
        assert.equal(r.disclaimer, BAYES_DISCLAIMER);
        assert.equal(r.method, 'Beta-Binomial com prior empírica (método dos momentos)');
    });

    it('hot e cold têm 5 dezenas e não se sobrepõem em volante grande', () => {
        const r = B.shrink(simulateUniform(60, 6, 300), { total: 60, drawn: 6, drawCount: 300 });
        assert.equal(r.hot.length, 5);
        assert.equal(r.cold.length, 5);
        assert.ok(r.hot[0].shrunkRate >= r.cold[0].shrunkRate);
        const overlap = r.hot.map(h => h.number).filter(n => r.cold.map(c => c.number).includes(n));
        assert.equal(overlap.length, 0);
    });

    it('volante pequeno (Lotofácil, 25 dezenas) não quebra hot/cold', () => {
        const r = B.shrink(simulateUniform(25, 15, 80), { total: 25, drawn: 15, drawCount: 80 });
        assert.equal(r.hot.length, 5);
        assert.equal(r.cold.length, 5);
        assert.equal(r.numbers.length, 25);
    });
});
