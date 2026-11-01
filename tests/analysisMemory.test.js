/**
 * Testes do item 6.10 da auditoria: memória do `analyze()`.
 *
 * O que precisa ficar provado:
 *  - a matriz de pares deixou de ser O(n²) objetos e virou uma estrutura compacta;
 *  - os NÚMEROS não mudaram: topPairs, contagens e Markov batem com uma
 *    implementação de referência escrita à parte (objeto aninhado + sort completo);
 *  - a memoização por (último concurso, janela) devolve o mesmo resultado e
 *    não deixa o chamador contaminar a cache;
 *  - a memória retida medida em processo separado fica dentro de um limite.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { PairCountMatrix, pairCount } from '../js/engine/pairMatrix.js';
import { StatisticalAnalyzer } from '../js/engine/statisticalAnalyzer.js';
import { SeededRandom } from '../js/engine/prng.js';

const PROBE = fileURLToPath(new URL('./fixtures/analysisMemoryProbe.mjs', import.meta.url));

/** Histórico sintético determinístico. */
function makeHistory({ total, drawn, draws, seed = 4242 }) {
    const rng = new SeededRandom(seed);
    const history = [];
    for (let c = 0; c < draws; c++) {
        const set = new Set();
        while (set.size < drawn) set.add(1 + Math.floor(rng.next() * total));
        history.push({ concurso: 10000 - c, dezenas: [...set], data: '2025-01-01' });
    }
    return history;
}

/** Implementação de referência: objeto aninhado, como era antes do item 6.10. */
function referencePairCounts(history, total) {
    const matrix = {};
    for (let i = 1; i <= total; i++) {
        matrix[i] = {};
        for (let j = i + 1; j <= total; j++) matrix[i][j] = 0;
    }
    for (const draw of history) {
        const nums = [...new Set(draw.dezenas.map(Number))].sort((a, b) => a - b);
        for (let i = 0; i < nums.length; i++) {
            for (let j = i + 1; j < nums.length; j++) {
                const a = nums[i];
                const b = nums[j];
                if (matrix[a] && matrix[a][b] !== undefined) matrix[a][b]++;
            }
        }
    }
    return matrix;
}

describe('PairCountMatrix — estrutura compacta', () => {
    it('conta exatamente como a versão de objeto aninhado', () => {
        const total = 25;
        const history = makeHistory({ total, drawn: 15, draws: 60 });
        const reference = referencePairCounts(history, total);
        const matrix = new PairCountMatrix(total);

        for (const draw of history) {
            const nums = [...new Set(draw.dezenas.map(Number))].sort((a, b) => a - b);
            for (let i = 0; i < nums.length; i++) {
                for (let j = i + 1; j < nums.length; j++) matrix.increment(nums[i], nums[j]);
            }
        }

        for (let a = 1; a <= total; a++) {
            for (let b = a + 1; b <= total; b++) {
                assert.equal(matrix.get(a, b), reference[a][b], `par ${a}-${b}`);
            }
        }
        // Cada concurso contribui com C(drawn,2) pares.
        const perDraw = (15 * 14) / 2;
        assert.equal(matrix.totalCount(), perDraw * history.length);
    });

    it('é simétrica e ignora dezenas fora do intervalo', () => {
        const matrix = new PairCountMatrix(60);
        matrix.increment(10, 5);
        assert.equal(matrix.get(5, 10), 1);
        assert.equal(matrix.get(10, 5), 1);
        assert.equal(matrix.get(5, 5), 0, 'par de uma dezena consigo mesma não existe');
        assert.equal(matrix.get(0, 5), 0);
        assert.equal(matrix.get(5, 61), 0);
        assert.equal(matrix.increment(5, 61), 0);
        assert.equal(matrix.totalCount(), 1);
    });

    it('usa um único Int32Array em vez de um objeto por par', () => {
        const matrix = new PairCountMatrix(100);
        assert.ok(matrix.values instanceof Int32Array);
        assert.equal(matrix.values.byteLength, 101 * 101 * 4, '40 KB, não 4.950 objetos');
        assert.equal(matrix.size, 4950);
        // A estrutura não ganha propriedades conforme os pares são preenchidos.
        const keysBefore = Object.keys(matrix).length;
        for (let i = 1; i <= 100; i += 7) matrix.increment(i, i + 1);
        assert.equal(Object.keys(matrix).length, keysBefore);
    });

    it('rejeita total inválido', () => {
        assert.throws(() => new PairCountMatrix(1), RangeError);
        assert.throws(() => new PairCountMatrix(0), RangeError);
        assert.throws(() => new PairCountMatrix('cem'), RangeError);
    });

    it('topEntries reproduz um sort estável por contagem', () => {
        const matrix = new PairCountMatrix(10);
        // Empates propositais para verificar a ordem estável (a asc, depois b asc).
        matrix.set(1, 2, 5);
        matrix.set(1, 3, 5);
        matrix.set(2, 4, 7);
        matrix.set(3, 5, 5);
        matrix.set(6, 7, 5);

        const expected = [];
        for (let a = 1; a <= 10; a++) {
            for (let b = a + 1; b <= 10; b++) expected.push({ a, b, count: matrix.get(a, b) });
        }
        expected.sort((x, y) => y.count - x.count);

        const top = matrix.topEntries(5);
        assert.deepEqual(top, expected.slice(0, 5));
    });

    it('topEntries respeita k = 0 e k maior que o total de pares', () => {
        const matrix = new PairCountMatrix(5);
        assert.deepEqual(matrix.topEntries(0), []);
        assert.equal(matrix.topEntries(1000).length, 10);
    });

    it('pairCount aceita a matriz nova e o formato antigo', () => {
        const matrix = new PairCountMatrix(10);
        matrix.increment(3, 8);
        assert.equal(pairCount(matrix, 8, 3), 1);
        assert.equal(pairCount({ 3: { 8: 4 } }, 3, 8), 4);
        assert.equal(pairCount(null, 3, 8), 0);
        assert.equal(pairCount({ 3: {} }, 3, 8), 0);
    });
});

describe('analyze() — mesmos números, menos memória', () => {
    const config = { total: 60, pick: 6, drawn: 6 };
    const history = makeHistory({ total: 60, drawn: 6, draws: 120 });

    it('a matriz de pares do analyze bate com a contagem bruta', () => {
        const analysis = StatisticalAnalyzer.analyze(history, config);
        const reference = referencePairCounts(history, 60);
        for (let a = 1; a <= 60; a++) {
            for (let b = a + 1; b <= 60; b++) {
                assert.equal(pairCount(analysis.pairMatrix, a, b), reference[a][b], `par ${a}-${b}`);
            }
        }
    });

    it('analyzeFast e analyze produzem a mesma matriz', () => {
        const full = StatisticalAnalyzer.analyze(history, config);
        const fast = StatisticalAnalyzer.analyzeFast(history, config);
        assert.deepEqual(fast.pairMatrix, full.pairMatrix);
    });

    it('os 30 pares do topo são exatamente os de um sort completo', () => {
        const analysis = StatisticalAnalyzer.analyze(history, config);
        const reference = referencePairCounts(history, 60);

        const all = [];
        for (let a = 1; a <= 60; a++) {
            for (let b = a + 1; b <= 60; b++) all.push({ a, b, count: reference[a][b] });
        }
        all.sort((x, y) => y.count - x.count);

        assert.equal(analysis.topPairs.length, 30);
        analysis.topPairs.forEach((p, i) => {
            assert.deepEqual(p.pair, [all[i].a, all[i].b], `posição ${i}`);
            assert.equal(p.count, all[i].count, `contagem da posição ${i}`);
        });
    });

    it('a família de pares examinada continua sendo C(total,2)', () => {
        const analysis = StatisticalAnalyzer.analyze(history, config);
        assert.equal(analysis.pairStats.examined, (60 * 59) / 2);
        assert.equal(analysis.pairStats.tested, analysis.topPairs.length);
        assert.ok(analysis.pairStats.tested <= 30);
    });

    it('Markov continua com as mesmas probabilidades condicionais', () => {
        const total = 10;
        const drawn = 4;
        const h = makeHistory({ total, drawn, draws: 40, seed: 99 });
        const markov = StatisticalAnalyzer.analyzeMarkovTransitions(h, total, drawn);

        // Referência escrita com objeto aninhado, exatamente como era.
        const counts = {};
        const occurrences = {};
        for (let i = 1; i <= total; i++) {
            counts[i] = {};
            occurrences[i] = 0;
            for (let j = 1; j <= total; j++) counts[i][j] = 0;
        }
        for (let idx = 0; idx < h.length - 1; idx++) {
            const current = h[idx].dezenas.map(Number);
            const prev = h[idx + 1].dezenas.map(Number);
            for (const p of prev) {
                if (p < 1 || p > total) continue;
                occurrences[p]++;
                for (const c of current) if (c >= 1 && c <= total) counts[p][c]++;
            }
        }
        const lastDraw = h[0].dezenas.map(Number);
        const baseline = drawn / total;
        for (let j = 1; j <= total; j++) {
            let sum = 0;
            for (const p of lastDraw) {
                sum += (counts[p][j] + 1 * baseline) / (occurrences[p] + 1);
            }
            const expected = Number((sum / lastDraw.length).toFixed(4));
            assert.equal(markov.nextDrawProbabilities[j], expected, `dezena ${j}`);
        }
    });
});

describe('Memória retida (processo separado, com --expose-gc)', () => {
    it('analyze + analyzeFast da Lotomania retêm menos de 3 MB', () => {
        const out = execFileSync(
            process.execPath,
            ['--expose-gc', PROBE, '100', '20', '300'],
            { encoding: 'utf8' }
        );
        const probe = JSON.parse(out);
        assert.ok(probe.retainedMb < 3, `memória retida ${probe.retainedMb} MB acima do limite`);
        assert.equal(probe.pairMatrixBytes, probe.expectedBytes);
        assert.equal(probe.fastPairMatrixBytes, probe.expectedBytes);
        assert.equal(probe.topPairs, 30);
        assert.equal(probe.examined, probe.expectedExamined);
        // A estrutura não tem uma chave por par (antes eram 100 linhas de objeto).
        assert.ok(probe.pairKeys <= 8, `pairMatrix expõe ${probe.pairKeys} chaves; deveria ser uma só estrutura`);
    });
});

describe('Memoização por (último concurso, janela)', () => {
    const config = { total: 60, pick: 6, drawn: 6 };

    it('a segunda chamada da mesma janela reaproveita o resultado', () => {
        StatisticalAnalyzer.invalidateAnalysisCache();
        const history = makeHistory({ total: 60, drawn: 6, draws: 100, seed: 7 });

        const t0 = Date.now();
        const first = StatisticalAnalyzer.analyzeCached(history, config);
        const cold = Date.now() - t0;

        const t1 = Date.now();
        const second = StatisticalAnalyzer.analyzeCached(history, config);
        const warm = Date.now() - t1;

        const stats = StatisticalAnalyzer.getAnalysisCacheStats();
        assert.equal(stats.misses, 1);
        assert.equal(stats.hits, 1);
        assert.deepEqual(second.topPairs, first.topPairs);
        assert.equal(second.pairStats.examined, first.pairStats.examined);
        assert.ok(warm < Math.max(5, cold), `chamada memoizada (${warm} ms) deveria ser mais rápida que a fria (${cold} ms)`);
    });

    it('mudar o concurso mais recente invalida a chave', () => {
        StatisticalAnalyzer.invalidateAnalysisCache();
        const history = makeHistory({ total: 60, drawn: 6, draws: 100, seed: 8 });
        const before = StatisticalAnalyzer.analyzeCached(history, config);
        const novo = { concurso: 20000, dezenas: [1, 2, 3, 4, 5, 6], data: '2025-02-01' };
        const extended = [novo, ...history];
        const after = StatisticalAnalyzer.analyzeCached(extended, config);

        assert.notEqual(
            StatisticalAnalyzer.analysisCacheKey(history, config),
            StatisticalAnalyzer.analysisCacheKey(extended, config)
        );
        assert.equal(after.drawCount, before.drawCount + 1);
    });

    it('a cache é somente leitura: mutação do retorno não contamina', () => {
        StatisticalAnalyzer.invalidateAnalysisCache();
        const history = makeHistory({ total: 60, drawn: 6, draws: 80, seed: 9 });
        const first = StatisticalAnalyzer.analyzeCached(history, config);
        first.lastDrawNumbers = [1, 2, 3];
        first.topPairs.length = 0;

        const second = StatisticalAnalyzer.analyzeCached(history, config);
        assert.equal(second.topPairs.length, 30);
        assert.notDeepEqual(second.lastDrawNumbers, [1, 2, 3]);
    });

    it('respeita a capacidade e descarta as janelas mais antigas', () => {
        StatisticalAnalyzer.invalidateAnalysisCache();
        const capacity = StatisticalAnalyzer.ANALYSIS_CACHE_SIZE;
        for (let i = 0; i < capacity + 2; i++) {
            const history = makeHistory({ total: 60, drawn: 6, draws: 50 + i, seed: 100 + i });
            StatisticalAnalyzer.analyzeCached(history, config);
        }
        const stats = StatisticalAnalyzer.getAnalysisCacheStats();
        assert.equal(stats.size, capacity);
        assert.ok(stats.evictions >= 2);
    });

    it('invalidate limpa a cache', () => {
        StatisticalAnalyzer.analyzeCached(makeHistory({ total: 60, drawn: 6, draws: 60 }), config);
        StatisticalAnalyzer.invalidateAnalysisCache();
        assert.equal(StatisticalAnalyzer.getAnalysisCacheStats().size, 0);
    });
});
