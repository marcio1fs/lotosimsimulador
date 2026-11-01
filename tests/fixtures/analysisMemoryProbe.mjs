/**
 * Sonda de memória para o teste do item 6.10.
 *
 * Roda em processo separado porque medir heap de forma confiável exige
 * `--expose-gc` — e forçar coletas dentro da suíte contaminaria os outros testes.
 *
 * Uso: node --expose-gc tests/fixtures/analysisMemoryProbe.mjs [total] [drawn] [draws]
 * Saída: JSON com heap retido e tamanho da estrutura de pares.
 */
import { StatisticalAnalyzer } from '../../js/engine/statisticalAnalyzer.js';
import { SeededRandom } from '../../js/engine/prng.js';

const total = Number(process.argv[2] || 100);
const drawn = Number(process.argv[3] || 20);
const draws = Number(process.argv[4] || 300);

const rng = new SeededRandom(20260101);
const history = [];
for (let c = 0; c < draws; c++) {
    const set = new Set();
    while (set.size < drawn) set.add(1 + Math.floor(rng.next() * total));
    history.push({ concurso: 9000 - c, dezenas: [...set], data: '2025-01-01' });
}

const config = { total, pick: Math.floor(total / 2), drawn };

global.gc();
global.gc();
const before = process.memoryUsage().heapUsed;

const analysis = StatisticalAnalyzer.analyze(history, config);
const fast = StatisticalAnalyzer.analyzeFast(history, config);

global.gc();
global.gc();
const after = process.memoryUsage().heapUsed;

process.stdout.write(JSON.stringify({
    retainedMb: Number(((after - before) / 1048576).toFixed(3)),
    pairMatrixBytes: analysis.pairMatrix.values.byteLength,
    fastPairMatrixBytes: fast.pairMatrix.values.byteLength,
    expectedBytes: (total + 1) * (total + 1) * 4,
    pairKeys: Object.keys(analysis.pairMatrix).length,
    topPairs: analysis.topPairs.length,
    examined: analysis.pairStats.examined,
    expectedExamined: (total * (total - 1)) / 2
}));
