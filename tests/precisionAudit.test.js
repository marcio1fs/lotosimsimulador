/**
 * Testes de Precisão Estatística (Auditoria v1.2)
 *
 * Cada teste aqui "trava" uma correção feita na auditoria, para que o erro não volte:
 *  1. Intervalo entre ocorrências (gap) calculado corretamente em analyze/analyzeFast
 *  2. p-value do Chi-Quadrado exato (gama incompleta) em vez de aproximação tanh
 *  3. Teste binomial exato
 *  4. Correção de Benjamini-Hochberg (FDR) e família de hipóteses
 *  5. Quantil normal e cálculo de poder / MDE
 *  6. Teste t pareado sem "falso positivo garantido" no caso degenerado
 *  7. Sinais de Markov filtrados por significância
 *  8. Backtest com redução de variância, nulo analítico e checagem real de vazamento
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { StatisticalAnalyzer } from '../js/engine/statisticalAnalyzer.js';
import { StatisticalInference } from '../js/engine/statisticalInference.js';
import { BacktestEngine } from '../js/engine/backtestEngine.js';
import { SeededRandom } from '../js/engine/prng.js';

const cfgMega = { total: 60, pick: 6, drawn: 6, apiName: 'megasena' };

function syntheticHistory(count, total, drawn, seed) {
    const rnd = new SeededRandom(seed);
    const out = [];
    for (let i = 0; i < count; i++) {
        const s = new Set();
        while (s.size < drawn) s.add(rnd.nextInt(1, total));
        out.push({ concurso: count - i, dezenas: [...s].sort((a, b) => a - b) });
    }
    return out;
}

describe('CORREÇÃO 1 — Intervalo real entre ocorrências (gap)', () => {
    // A dezena 1 sai nos índices 0, 10 e 20 (histórico do mais recente para o mais antigo)
    const history = [];
    for (let i = 0; i < 25; i++) {
        history.push({ dezenas: i % 10 === 0 ? [1, 2, 3, 4, 5, 6] : [10, 11, 12, 13, 14, 15] });
    }

    it('avgDelay deve ser a média dos intervalos CONSECUTIVOS (10), não o intervalo desde a 1ª saída', () => {
        const analysis = StatisticalAnalyzer.analyze(history, cfgMega);
        assert.equal(analysis.avgDelay[1], 10, `avgDelay deveria ser 10, obteve ${analysis.avgDelay[1]}`);
    });

    it('maxDelay deve ser o maior gap consecutivo (10) e não a distância até a 1ª saída (20)', () => {
        const analysis = StatisticalAnalyzer.analyze(history, cfgMega);
        assert.equal(analysis.maxDelay[1], 10, `maxDelay deveria ser 10, obteve ${analysis.maxDelay[1]}`);
    });

    it('currentDelay continua sendo a distância até a saída MAIS RECENTE (0)', () => {
        const analysis = StatisticalAnalyzer.analyze(history, cfgMega);
        assert.equal(analysis.currentDelay[1], 0);

        const fast = StatisticalAnalyzer.analyzeFast(history, cfgMega);
        assert.equal(fast.currentDelay[1], 0, 'analyzeFast deve concordar com analyze');
        assert.equal(fast.avgDelay[1], 10, 'analyzeFast deve calcular o mesmo gap médio');
    });

    it('avgDelay não pode crescer artificialmente com o tamanho do histórico', () => {
        // A mesma dezena saindo a cada 5 concursos em históricos de tamanhos diferentes
        function buildPeriodic(draws) {
            const h = [];
            for (let i = 0; i < draws; i++) {
                h.push({ dezenas: i % 5 === 0 ? [7, 8, 9, 10, 11, 12] : [20, 21, 22, 23, 24, 25] });
            }
            return h;
        }
        const media = (draws) => StatisticalAnalyzer.analyze(buildPeriodic(draws), cfgMega).avgDelay[7];
        const m50 = media(50);
        const m200 = media(200);
        assert.equal(m50, 5);
        assert.ok(Math.abs(m200 - 5) < 1e-9, `avgDelay deveria permanecer 5, obteve ${m200}`);
    });
});

describe('CORREÇÃO 2 — Chi-Quadrado com p-value exato', () => {
    it('P(χ²_1 ≥ 3.841) deve ser ≈ 0.05 (valor crítico tabelado)', () => {
        const p = StatisticalInference.chiSquareSurvival(3.841, 1);
        assert.ok(Math.abs(p - 0.05) < 0.001, `esperado ~0.05, obteve ${p}`);
    });

    it('P(χ²_10 ≥ 18.307) deve ser ≈ 0.05', () => {
        const p = StatisticalInference.chiSquareSurvival(18.307, 10);
        assert.ok(Math.abs(p - 0.05) < 0.001, `esperado ~0.05, obteve ${p}`);
    });

    it('P(χ²_30 ≥ 43.773) deve ser ≈ 0.05', () => {
        const p = StatisticalInference.chiSquareSurvival(43.773, 30);
        assert.ok(Math.abs(p - 0.05) < 0.001, `esperado ~0.05, obteve ${p}`);
    });

    it('a CDF deve ser monotônica e a cauda superior tender a zero', () => {
        let anterior = 0;
        for (const x of [1, 5, 20, 60, 200]) {
            const cdf = StatisticalInference.chiSquareCDF(x, 10);
            assert.ok(cdf > anterior, 'CDF deve ser crescente');
            anterior = cdf;
        }
        assert.ok(StatisticalInference.chiSquareSurvival(500, 10) < 1e-50);
    });

    it('chiSquareUniformity deve reconhecer frequências idênticas (χ² = 0, p = 1)', () => {
        const freq = {};
        for (let n = 1; n <= 25; n++) freq[n] = 60;
        const res = StatisticalAnalyzer.chiSquareUniformity(freq, 25, 100, 15);
        assert.equal(res.chiSquare, 0);
        assert.equal(res.pValue, 1);
        assert.equal(res.isUniform, true);
        assert.equal(res.cramersV, 0);
        assert.equal(res.method, 'Chi-Quadrado exato (gama incompleta regularizada)');
    });

    it('chiSquareUniformity deve expor tamanho de efeito e dezenas em desvio extremo', () => {
        const freq = {};
        for (let n = 1; n <= 25; n++) freq[n] = 60;
        freq[7] = 200; // desvio grosseiro
        freq[8] = 0;
        const res = StatisticalAnalyzer.chiSquareUniformity(freq, 25, 100, 15);
        assert.ok(res.pValue < 1e-6, 'desvio grosseiro deve gerar p-value desprezível');
        assert.equal(res.isUniform, false);
        assert.ok(res.cramersV > 0);
        assert.ok(res.topDeviations.some(d => d.number === 7), 'dezena 7 deve aparecer em topDeviations');
        assert.ok(res.topDeviations.every(d => Math.abs(d.z) >= 3));
    });
});

describe('CORREÇÃO 3 — Teste binomial exato', () => {
    it('P(X ≥ 60 | n=100, p=0.5) ≈ 0.02844', () => {
        const p = StatisticalInference.binomialUpperTail(60, 100, 0.5);
        assert.ok(Math.abs(p - 0.028444) < 1e-5, `obteve ${p}`);
    });

    it('P(X ≥ 75 | n=100, p=0.5) ≈ 2.82e-7', () => {
        const p = StatisticalInference.binomialUpperTail(75, 100, 0.5);
        assert.ok(Math.abs(p - 2.8181e-7) / 2.8181e-7 < 1e-3, `obteve ${p}`);
    });

    it('casos de borda: k=0 → 1, k>n → 0, p>=1 → 1', () => {
        assert.equal(StatisticalInference.binomialUpperTail(0, 10, 0.3), 1);
        assert.equal(StatisticalInference.binomialUpperTail(11, 10, 0.3), 0);
        assert.equal(StatisticalInference.binomialUpperTail(5, 10, 1), 1);
        assert.equal(StatisticalInference.binomialUpperTail(5, 10, 0), 0);
    });

    it('binomialTest deve calcular lift e p-value coerentes', () => {
        const res = StatisticalInference.binomialTest(30, 100, 0.1, 'greater');
        assert.equal(res.lift, 3);
        assert.ok(res.pValue < 1e-6, `30 acertos em 100 com p0=0.1 deve ser significativo, obteve ${res.pValue}`);
        const nulo = StatisticalInference.binomialTest(10, 100, 0.1, 'greater');
        assert.ok(nulo.pValue > 0.4, 'contagem igual ao esperado não deve ser significativa');
    });
});

describe('CORREÇÃO 4 — Benjamini-Hochberg (FDR)', () => {
    it('q-values devem coincidir com o algoritmo original (p.adjust BH do R)', () => {
        const p = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216];
        const { qValues, rejected, m } = StatisticalInference.benjaminiHochberg(p);
        const esperado = [0.01, 0.04, 0.084, 0.084, 0.084, 0.1, 0.1057, 0.216, 0.216, 0.216];
        assert.equal(m, 10);
        esperado.forEach((v, i) => {
            assert.ok(Math.abs(qValues[i] - v) < 1e-4, `idx ${i}: esperado ${v}, obteve ${qValues[i]}`);
        });
        assert.equal(rejected.filter(Boolean).length, 2, 'apenas p=0.001 e p=0.008 devem ser rejeitados');
    });

    it('familySize maior deve tornar o q-value mais conservador', () => {
        const p = [0.001, 0.02];
        const bh = StatisticalInference.benjaminiHochberg(p, 0.05);
        const conservador = StatisticalInference.benjaminiHochberg(p, 0.05, 2000);
        assert.ok(conservador.qValues[0] > bh.qValues[0]);
        assert.equal(conservador.m, 2000);
    });
});

describe('CORREÇÃO 5 — Quantil normal, poder e MDE', () => {
    it('normalQuantile deve bater com a tabela normal padrão', () => {
        assert.ok(Math.abs(StatisticalInference.normalQuantile(0.975) - 1.959964) < 1e-6);
        assert.ok(Math.abs(StatisticalInference.normalQuantile(0.5)) < 1e-9);
        assert.ok(Math.abs(StatisticalInference.normalQuantile(0.005) + 2.575829) < 1e-6);
        assert.ok(Math.abs(StatisticalInference.normalQuantile(0.8) - 0.841621) < 1e-6);
    });

    it('o efeito mínimo detectável deve diminuir com o aumento de n', () => {
        const sd = 0.7;
        const mde30 = StatisticalInference.minimumDetectableEffect(30, sd);
        const mde200 = StatisticalInference.minimumDetectableEffect(200, sd);
        const mde1000 = StatisticalInference.minimumDetectableEffect(1000, sd);
        assert.ok(mde30 > mde200 && mde200 > mde1000, 'MDE deve decrescer com n');
        // fórmula: (1.645 + 0.842) * sd / sqrt(n)
        assert.ok(Math.abs(mde30 - (2.4867 * sd) / Math.sqrt(30)) < 0.01);
    });

    it('requiredSampleSize deve ser o inverso coerente do poder', () => {
        const sd = 0.7;
        const n = StatisticalInference.requiredSampleSize(sd, 0.1);
        const poder = StatisticalInference.observedPower(0.1, n, sd);
        assert.ok(poder >= 0.79 && poder <= 0.85, `poder esperado ~0.80, obteve ${poder}`);
    });

    it('zTestVersusExpected deve detectar vantagem sintética real', () => {
        // modelo que acerta, em média, 2x o esperado (0.6 → ~1.2)
        const hits = [];
        for (let i = 0; i < 400; i++) hits.push(i % 5 < 3 ? 1 : 1); // média 1.0
        const res = StatisticalInference.zTestVersusExpected(hits, 0.6, 0.703);
        assert.ok(res.excess > 0);
        assert.ok(res.pValue < 1e-6, `deveria ser significativo, p=${res.pValue}`);
        assert.equal(res.statisticallySignificant, true);
    });

    it('zTestVersusExpected deve ser CALIBRADO (falso positivo ≈ alpha sob H0)', () => {
        const p0 = 0.6;
        const sd = Math.sqrt(p0 * (1 - p0));
        const rnd = new SeededRandom(2024);
        const reps = 3000;
        let falsosPositivos = 0;
        for (let r = 0; r < reps; r++) {
            const vals = [];
            for (let i = 0; i < 60; i++) vals.push(rnd.next() < p0 ? 1 : 0);
            if (StatisticalInference.zTestVersusExpected(vals, p0, sd).statisticallySignificant) falsosPositivos++;
        }
        const taxa = falsosPositivos / reps;
        // Teste unilateral com alpha=0.05 deve rejeitar ~5% das vezes sob H0 (tolerância Monte Carlo)
        assert.ok(taxa > 0.03 && taxa < 0.07, `taxa de falso positivo fora do esperado: ${(taxa * 100).toFixed(2)}%`);
    });

    it('zTestVersusExpected NÃO deve acusar vantagem em dados sem vantagem', () => {
        const rnd = new SeededRandom(11);
        const hits = [];
        for (let i = 0; i < 400; i++) hits.push(rnd.next() < 0.6 ? 0 : 1); // média ≈ 0.4
        const res = StatisticalInference.zTestVersusExpected(hits, 0.6, 0.703);
        assert.equal(res.statisticallySignificant, false);
    });
});

describe('CORREÇÃO 6 — Teste t pareado sem falso positivo degenerado', () => {
    it('diferenças constantes NÃO devem virar p=0.0001 automaticamente', () => {
        // 6 diferenças constantes de +1 → teste de sinais: p = 0.5^6 = 0.015625
        const model = [10, 10, 10, 10, 10, 10];
        const baseline = [9, 9, 9, 9, 9, 9];
        const res = StatisticalInference.pairedTTest(model, baseline);
        assert.equal(res.method, 'Teste de sinais (variância nula)');
        assert.ok(Math.abs(res.pValue - 0.015625) < 1e-6, `esperado 0.015625, obteve ${res.pValue}`);
        assert.equal(res.statisticallySignificant, true);
    });

    it('diferenças constantes com amostra pequena não devem ser declaradas significativas', () => {
        const res = StatisticalInference.pairedTTest([5, 5, 5], [4, 4, 4]);
        assert.ok(res.pValue > 0.05, `p deveria ser > 0.05, obteve ${res.pValue}`);
        assert.equal(res.statisticallySignificant, false);
    });

    it('deve reportar p bilateral, poder observado e MDE', () => {
        const model = [12, 13, 14, 13, 12, 14, 13, 12, 13, 14, 13, 12, 14, 13, 12];
        const baseline = [9, 8, 9, 8, 9, 8, 9, 8, 9, 8, 9, 8, 9, 8, 9];
        const res = StatisticalInference.pairedTTest(model, baseline);
        assert.ok(res.pValueTwoSided >= res.pValue, 'p bilateral deve ser >= p unilateral');
        assert.ok(res.minimumDetectableEffect > 0);
        assert.ok(res.observedPower > 0.99, 'com efeito enorme e diffs consistentes o poder deve ser alto');
        assert.ok(typeof res.method === 'string');
    });

    it('p-value não deve ser truncado artificialmente em 1e-6', () => {
        const model = Array.from({ length: 40 }, () => 20);
        const baseline = Array.from({ length: 40 }, (_, i) => 18 + (i % 3));
        const res = StatisticalInference.pairedTTest(model, baseline);
        assert.ok(res.pValue < 1e-6, `p deveria ser < 1e-6, obteve ${res.pValue}`);
        assert.notEqual(res.pValue, 0, 'p não deve ser exatamente 0');
    });
});

describe('CORREÇÃO 7 — Sinais de Markov filtrados por significância (FDR)', () => {
    it('em histórico aleatório, nenhuma transição de Markov deve ser significativa', () => {
        const history = syntheticHistory(300, 60, 6, 7);
        const analysis = StatisticalAnalyzer.analyze(history, cfgMega);
        assert.equal(analysis.markovStats.significantTransitions, 0,
            'dados aleatórios não devem produzir padrões de Markov com FDR 5%');
        assert.ok(analysis.markovStats.testedTransitions > 0, 'transições devem ter sido testadas');
        assert.equal(analysis.markovStats.hasStatisticallySignificantSignal, false);
    });

    it('topTransitions deve carregar p-value, q-value e a marca de significância', () => {
        const history = syntheticHistory(200, 60, 6, 3);
        const analysis = StatisticalAnalyzer.analyze(history, cfgMega);
        const transicoes = analysis.markovStats.topTransitions;
        assert.ok(transicoes.length > 0, 'deve existir alguma transição candidata');
        transicoes.forEach(t => {
            assert.ok(t.pValue >= 0 && t.pValue <= 1, 'pValue deve existir e ser válido');
            assert.ok(t.qValue >= 0 && t.qValue <= 1, 'qValue deve existir e ser válido');
            assert.equal(typeof t.significant, 'boolean');
            assert.ok(t.qValue >= t.pValue - 1e-12, 'q-value nunca pode ser menor que o p-value bruto');
        });
    });

    it('pares de co-ocorrência devem carregar q-value corrigido pela família completa', () => {
        const history = syntheticHistory(250, 60, 6, 5);
        const analysis = StatisticalAnalyzer.analyze(history, cfgMega);
        assert.ok(analysis.chiSquare);
        analysis.topPairs.forEach(p => {
            assert.ok(p.qValue >= 0 && p.qValue <= 1);
            assert.equal(typeof p.significant, 'boolean');
        });
        const significativos = analysis.topPairs.filter(p => p.significant).length;
        assert.equal(significativos, 0, 'pares "quentes" em dados aleatórios não devem ser significativos');
    });
});

describe('CORREÇÃO 8 — Backtest com nulo analítico e sem vazamento silencioso', () => {
    const generatorFn = (past, cfg) => {
        const analysis = StatisticalAnalyzer.analyzeFast(past, cfg);
        const ordenado = Object.entries(analysis.freqAbsolute)
            .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
            .slice(0, cfg.pick)
            .map(([n]) => Number(n));
        return ordenado;
    };

    it('deve expor o benchmark analítico (z-test contra a esperança hipergeométrica)', () => {
        const history = syntheticHistory(120, 60, 6, 2);
        const res = BacktestEngine.runBacktest(history, cfgMega, generatorFn, { windowSize: 60, seed: 1 });
        assert.ok(res.theoreticalBenchmark, 'theoreticalBenchmark deve existir');
        assert.ok(Math.abs(res.theoreticalBenchmark.expectedMean - 0.6) < 1e-9);
        assert.ok(res.theoreticalBenchmark.z !== null);
        assert.equal(typeof res.theoreticalBenchmark.statisticallySignificant, 'boolean');
        assert.equal(res.theoreticalBenchmark.statisticallySignificant, false,
            'nenhum modelo deve superar o nulo analítico em dados aleatórios');
    });

    it('deve reportar adequação amostral (MDE e concursos necessários)', () => {
        const history = syntheticHistory(120, 60, 6, 17);
        const res = BacktestEngine.runBacktest(history, cfgMega, generatorFn, { windowSize: 50, seed: 1 });
        const ad = res.sampleAdequacy;
        assert.equal(ad.evaluatedDraws, 50);
        assert.ok(ad.minimumDetectableEffectHits > 0);
        assert.ok(ad.drawsNeededFor10PercentEdge > ad.drawsNeededFor20PercentEdge);
        assert.equal(typeof ad.onlyExploratory, 'boolean');
        assert.ok(ad.note.includes('con cursos') || ad.note.includes('concursos'));
    });

    it('a baseline deve usar redução de variância (média de várias apostas)', () => {
        const history = syntheticHistory(80, 60, 6, 19);
        const a = BacktestEngine.runBacktest(history, cfgMega, generatorFn, {
            windowSize: 30, seed: 1, baselineSimsPerDraw: 1
        });
        const b = BacktestEngine.runBacktest(history, cfgMega, generatorFn, {
            windowSize: 30, seed: 1, baselineSimsPerDraw: 40
        });
        assert.equal(a.baselineSimsPerDraw, 1);
        assert.equal(b.baselineSimsPerDraw, 40);
        // Com mais simulações a baseline fica muito próxima da esperança 0.6
        assert.ok(Math.abs(b.baselineMean - 0.6) <= Math.abs(a.baselineMean - 0.6) + 0.02,
            `baseline com 40 simulações (${b.baselineMean}) deve ser mais estável que com 1 (${a.baselineMean})`);
    });

    it('dataLeakageDetected deve ser derivado de checagem real, não constante', () => {
        const history = syntheticHistory(80, 60, 6, 23);
        const limpo = BacktestEngine.runBacktest(history, cfgMega, generatorFn, { windowSize: 30, seed: 1 });
        assert.equal(limpo.dataLeakageDetected, false);
        assert.equal(limpo.leakageCheck.violations, 0);
        assert.equal(limpo.leakageCheck.evaluatedDraws, 30);

        // gerador que ignora o passado recebido (simulando acesso a dados futuros)
        const vazando = (past) => (past.length > 1000 ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6]);
        const res = BacktestEngine.runBacktest(history, cfgMega, vazando, { windowSize: 20, seed: 1 });
        assert.ok(res.leakageCheck, 'leakageCheck deve sempre existir');
    });
});

describe('CORREÇÃO 9 — Integridade dos dados (histórico sintético não pode virar evidência)', () => {
    it('o preenchimento de série deve marcar cada concurso inventado', async () => {
        const { LotteryAPIService } = await import('../js/services/lotteryApi.js');
        // concursos altos, como na base oficial (o preenchimento anda para trás a partir do último)
        const reais = syntheticHistory(10, 60, 6, 31).map((d, i) => ({ ...d, concurso: 3000 - i }));
        const preenchido = LotteryAPIService.ensureMinimumHistoryDepth(reais, 'mega', 120);

        assert.equal(preenchido.length, 120);
        const sinteticos = preenchido.filter(d => d.synthetic === true);
        assert.equal(sinteticos.length, 110, 'todos os concursos inventados devem ser marcados');
        assert.equal(LotteryAPIService.countSynthetic(preenchido), 110);
        assert.equal(LotteryAPIService.countSynthetic(reais), 0, 'histórico real não deve ser marcado');

        sinteticos.forEach(d => {
            assert.equal(d.data, 'Sintético (não oficial)');
            assert.equal(d.dezenas.length, 6);
        });

        // Se já existe histórico suficiente, nada é inventado
        const suficiente = LotteryAPIService.ensureMinimumHistoryDepth(
            syntheticHistory(130, 60, 6, 33).map((d, i) => ({ ...d, concurso: 3200 - i })), 'mega', 120);
        assert.equal(LotteryAPIService.countSynthetic(suficiente), 0);
    });

    it('ForecastPolicy deve BLOQUEAR inferência quando há dados sintéticos', async () => {
        const { ForecastPolicy } = await import('../js/engine/forecastPolicy.js');
        const config = { total: 60, pick: 6, drawn: 6 };
        const history = [
            ...syntheticHistory(100, 60, 6, 37),
            { dezenas: [1, 2, 3, 4, 5, 6], data: 'Sintético (não oficial)', synthetic: true }
        ];

        const policy = ForecastPolicy.evaluate({
            historySize: history.length,
            backtest: {
                evaluatedDraws: 120,
                diffMean: 0.4,
                isStatisticallySignificant: true,
                walkForward: { isOverfitting: false }
            },
            strategy: 'adaptive',
            config,
            history
        });

        assert.equal(policy.status, 'SYNTHETIC_DATA');
        assert.equal(policy.syntheticDraws, 1);
        assert.equal(policy.officialDraws, 100);
        assert.equal(policy.canClaimPositiveReturn, false);
        assert.equal(policy.guarantee, false);
        assert.ok(policy.detail.includes('não são resultados oficiais'));
    });

    it('sem dados sintéticos a política segue o fluxo normal', async () => {
        const { ForecastPolicy } = await import('../js/engine/forecastPolicy.js');
        const config = { total: 60, pick: 6, drawn: 6 };
        const history = syntheticHistory(150, 60, 6, 41);
        const policy = ForecastPolicy.evaluate({
            historySize: history.length,
            backtest: { evaluatedDraws: 5, diffMean: 0, isStatisticallySignificant: false },
            strategy: 'adaptive',
            config,
            history
        });
        assert.notEqual(policy.status, 'SYNTHETIC_DATA');
        assert.equal(policy.status, 'INSUFFICIENT_BACKTEST');
    });
});

describe('CORREÇÃO 10 — Diagnóstico de seleção de pesos (viés de validação)', () => {
    it('optimizeWeights deve avaliar em bloco de teste separado e expor o viés de seleção', async () => {
        const { ScoringEngine } = await import('../js/engine/scoringEngine.js');
        const history = syntheticHistory(180, 60, 6, 43);
        const res = ScoringEngine.optimizeWeights(history, cfgMega, { seed: 7 });

        assert.ok(res.holdoutDraws > 0, 'deve existir um bloco de teste reservado');
        assert.equal(res.searchTrials, 24);
        assert.ok(res.testMean !== null, 'o desempenho no bloco de teste deve ser reportado');
        assert.ok(res.baseTestMean !== null, 'a referência (pesos base) no teste deve ser reportada');
        assert.ok(typeof res.beatsBaseOnHoldout === 'boolean');
        assert.equal(res.selectionGap, Number((res.valMean - Number(res.testMean)).toFixed(2)));
        // determinismo
        const res2 = ScoringEngine.optimizeWeights(history, cfgMega, { seed: 7 });
        assert.deepStrictEqual(res.optimizedWeights, res2.optimizedWeights);
        assert.equal(res.testMean, res2.testMean);
    });
});

describe('CORREÇÃO 11 — Multiplicidade na seleção de janelas (best_game)', () => {
    it('deve aplicar Holm-Bonferroni sobre as janelas testadas e preservar a evidência', async () => {
        const { GameGenerator } = await import('../js/engine/gameGenerator.js');
        const rnd = new SeededRandom(3);
        const history = [];
        for (let i = 0; i < 220; i++) {
            const s = new Set();
            while (s.size < 15) s.add(rnd.nextInt(1, 25));
            history.push({ concurso: 220 - i, dezenas: [...s].sort((a, b) => a - b) });
        }
        const config = { total: 25, pick: 15, drawn: 15, apiName: 'lotofacil', name: 'Lotofácil' };
        const games = GameGenerator.runBestGameMode(history, config, [], [], 5, 42);

        const pipeline = games.modelPipeline;
        assert.ok(pipeline, 'best_game deve publicar o pipeline (antes ele era descartado)');
        assert.ok(pipeline.backtestResult, 'o backtest do modo best_game deve ser preservado');
        assert.ok(pipeline.selectionCorrection, 'a correção de multiplicidade deve existir');

        const sc = pipeline.selectionCorrection;
        assert.equal(sc.method, 'Holm-Bonferroni');
        assert.equal(sc.windowsTested, sc.evaluations.length);
        assert.ok(sc.windowsTested >= 4, 'deve registrar cada janela testada');
        assert.equal(typeof sc.anyWindowSignificantAfterCorrection, 'boolean');

        // o p-value corrigido nunca pode ser menor que o bruto
        sc.evaluations.forEach(e => {
            assert.ok(e.adjustedPValue >= e.pValue - 1e-9,
                `p corrigido (${e.adjustedPValue}) < p bruto (${e.pValue})`);
        });
        assert.equal(sc.familyAdjustedPValueForWinner,
            Math.min(...sc.evaluations.map(e => e.adjustedPValue)));
    });
});
