/**
 * Testes para MonteCarloEngine e PRNG
 * Valida distribuição empírica, probabilidades cumulativas, reprodutibilidade e estabilidade.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MonteCarloEngine } from '../js/engine/monteCarloEngine.js';
import { SeededRandom } from '../js/engine/prng.js';

describe('SeededRandom (PRNG)', () => {
    it('deve gerar valores determinísticos com a mesma seed', () => {
        const rng1 = new SeededRandom(42);
        const rng2 = new SeededRandom(42);
        const values1 = Array.from({ length: 20 }, () => rng1.next());
        const values2 = Array.from({ length: 20 }, () => rng2.next());
        assert.deepStrictEqual(values1, values2, 'Mesma seed deve produzir mesma sequência');
    });

    it('deve gerar valores diferentes com seeds diferentes', () => {
        const rng1 = new SeededRandom(42);
        const rng2 = new SeededRandom(999);
        const v1 = rng1.next();
        const v2 = rng2.next();
        assert.notEqual(v1, v2, 'Seeds diferentes devem gerar valores diferentes');
    });

    it('next() deve retornar valores em [0, 1)', () => {
        const rng = new SeededRandom(123);
        for (let i = 0; i < 1000; i++) {
            const val = rng.next();
            assert.ok(val >= 0 && val < 1, `Valor ${val} fora do intervalo [0, 1)`);
        }
    });

    it('nextInt deve retornar valores no intervalo correto', () => {
        const rng = new SeededRandom(77);
        for (let i = 0; i < 100; i++) {
            const val = rng.nextInt(1, 25);
            assert.ok(val >= 1 && val <= 25, `nextInt(1,25) retornou ${val}`);
        }
    });

    it('sample deve retornar k elementos únicos', () => {
        const rng = new SeededRandom(55);
        const pool = Array.from({ length: 25 }, (_, i) => i + 1);
        const sample = rng.sample(pool, 15);
        assert.equal(sample.length, 15);
        assert.equal(new Set(sample).size, 15, 'Elementos devem ser únicos');
    });

    it('shuffle deve ser reproduzível com mesma seed', () => {
        const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const rng1 = new SeededRandom(42);
        const rng2 = new SeededRandom(42);
        assert.deepStrictEqual(rng1.shuffle(arr), rng2.shuffle(arr));
    });
});

describe('MonteCarloEngine', () => {
    const lotofacilConfig = {
        total: 25,
        pick: 15,
        drawn: 15,
        apiName: 'lotofacil'
    };

    it('deve retornar distribuição empírica válida', () => {
        const candidate = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        const result = MonteCarloEngine.simulateCandidate(candidate, lotofacilConfig, 1000);

        assert.ok(result.empiricalDistribution, 'Deve ter distribuição empírica');
        assert.ok(result.meanHits >= 0, 'meanHits deve ser >= 0');
        assert.ok(result.stdDev >= 0, 'stdDev deve ser >= 0');
        assert.ok(result.iterations === 1000, 'Deve ter 1000 iterações');
    });

    it('deve calcular probabilidades cumulativas P(hits >= K)', () => {
        const candidate = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        const result = MonteCarloEngine.simulateCandidate(candidate, lotofacilConfig, 500);

        assert.ok(result.cumulativeProbabilities, 'Deve ter probabilidades cumulativas');
        // P(hits >= 0) deve ser 1.0 (100%)
        if (result.cumulativeProbabilities[0] !== undefined) {
            assert.ok(result.cumulativeProbabilities[0] >= 0.99, 'P(hits >= 0) deve ser ~1.0');
        }
    });

    it('deve retornar estabilidade entre 0 e 100', () => {
        const candidate = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        const result = MonteCarloEngine.simulateCandidate(candidate, lotofacilConfig, 500);

        assert.ok(result.stabilityScore >= 0 && result.stabilityScore <= 100, 
            `Estabilidade ${result.stabilityScore} fora do intervalo [0, 100]`);
    });

    it('deve ser reproduzível com mesma seed', () => {
        const candidate = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        const r1 = MonteCarloEngine.simulateCandidate(candidate, lotofacilConfig, 500, { seed: 42 });
        const r2 = MonteCarloEngine.simulateCandidate(candidate, lotofacilConfig, 500, { seed: 42 });

        assert.equal(r1.meanHits, r2.meanHits, 'meanHits deve ser idêntico com mesma seed');
        assert.equal(r1.stdDev, r2.stdDev, 'stdDev deve ser idêntico com mesma seed');
    });
});
