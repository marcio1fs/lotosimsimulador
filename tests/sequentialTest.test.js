/**
 * Testes da inferência sequencial (item 6.2 da auditoria).
 *
 * O que precisa ficar provado aqui:
 *  - o p always-valid mantém o erro tipo I mesmo com monitoramento contínuo;
 *  - o p clássico, no mesmo cenário, infla (é o problema que o item corrige);
 *  - o orçamento de α soma no máximo α, mesmo com infinitas olhadas;
 *  - as entradas inválidas são rejeitadas em vez de virarem número.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    SequentialTestEngine,
    AlphaBudget,
    SEQUENTIAL_SOURCES,
    SEQUENTIAL_DEFAULTS
} from '../js/engine/sequentialTestEngine.js';
import { BacktestEngine } from '../js/engine/backtestEngine.js';
import { StatisticalAnalyzer } from '../js/engine/statisticalAnalyzer.js';
import { GameGenerator } from '../js/engine/gameGenerator.js';
import { SeededRandom } from '../js/engine/prng.js';

/** Normal padrão via Box-Muller com PRNG determinístico. */
function gaussian(rng) {
    const u = Math.max(1e-12, rng.next());
    const v = rng.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Série com efeito constante (em acertos) e ruído normal. */
function series({ n, effect = 0, sd = 2, seed = 1 }) {
    const rng = new SeededRandom(seed);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = effect + gaussian(rng) * sd;
    return out;
}

/** p-valor bilateral do z (aproximação suficiente para o contraste). */
function zTwoSidedP(z) {
    const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
    const p = 0.3275911;
    const x = Math.abs(z) / Math.SQRT2;
    const t = 1 / (1 + p * x);
    const erf = 1 - ((((a[4] * t + a[3]) * t + a[2]) * t + a[1]) * t + a[0]) * t * Math.exp(-x * x);
    return 2 * (1 - 0.5 * (1 + erf));
}

/**
 * Simula o uso real: a pessoa olha o resultado a cada novo concurso e para
 * quando algo parece significativo. Compara os dois critérios na mesma série.
 */
function monitorRates({ reps, n, effect = 0, sd = 2, seed = 20260101, tau = SEQUENTIAL_DEFAULTS.tau }) {
    let alwaysValid = 0;
    let classical = 0;
    for (let k = 0; k < reps; k++) {
        const values = series({ n, effect, sd, seed: seed + k * 7919 });
        const monitoring = SequentialTestEngine.monitor(values, { tau });
        if (monitoring.firstSignificantLook !== null) alwaysValid++;

        // Mesmas olhadas, critério clássico: z com variância amostral por prefixo.
        let sum = 0;
        let sumSq = 0;
        let hit = false;
        for (let i = 1; i <= n && !hit; i++) {
            const x = values[i - 1];
            sum += x;
            sumSq += x * x;
            if (i < 3) continue;
            const mean = sum / i;
            const variance = (sumSq - i * mean * mean) / (i - 1);
            if (!(variance > 0)) continue;
            if (zTwoSidedP(mean / Math.sqrt(variance / i)) <= 0.05) hit = true;
        }
        if (hit) classical++;
    }
    return { alwaysValid: alwaysValid / reps, classical: classical / reps };
}

describe('Inferência sequencial — validade sob olhadas repetidas', () => {
    it('o p always-valid controla o erro tipo I com monitoramento contínuo', () => {
        const { alwaysValid } = monitorRates({ reps: 300, n: 120 });
        assert.ok(
            alwaysValid <= 0.06,
            `taxa de falso-positivo ${(alwaysValid * 100).toFixed(1)}% deveria ficar em torno de 5% ou menos`
        );
    });

    it('o p clássico repetido infla o erro tipo I no mesmo cenário', () => {
        const { alwaysValid, classical } = monitorRates({ reps: 300, n: 120 });
        assert.ok(
            classical >= 0.25,
            `esperava inflação grosseira do p clássico; medido ${(classical * 100).toFixed(1)}%`
        );
        assert.ok(
            classical > alwaysValid * 3,
            `o p clássico (${(classical * 100).toFixed(1)}%) deveria inflar muito acima do sequencial (${(alwaysValid * 100).toFixed(1)}%)`
        );
    });

    it('detecta um efeito de 0,9 acerto em 200 concursos na maioria das réplicas', () => {
        let detections = 0;
        const reps = 60;
        for (let k = 0; k < reps; k++) {
            const values = series({ n: 200, effect: 0.9, sd: 2, seed: 424242 + k * 131 });
            if (SequentialTestEngine.monitor(values).firstSignificantLook !== null) detections++;
        }
        assert.ok(
            detections / reps >= 0.7,
            `poder medido ${(100 * detections / reps).toFixed(0)}% deveria ser ao menos 70%`
        );
    });

    it('não vê efeito nenhum onde não há efeito (200 concursos, seed fixa)', () => {
        const values = series({ n: 200, effect: 0, sd: 2, seed: 909 });
        const test = SequentialTestEngine.alwaysValidPValue(values);
        assert.equal(test.available, true);
        assert.ok(test.pValue > 0.05, `p=${test.pValue} deveria ser > 0,05 em dados sem sinal`);
    });
});

describe('Inferência sequencial — bloco de aquecimento', () => {
    it('estima sigma no bloco inicial e não o reestima depois', () => {
        const values = series({ n: 200, effect: 0.3, sd: 2, seed: 77 });
        const test = SequentialTestEngine.alwaysValidPValue(values);
        const monitoring = SequentialTestEngine.monitor(values);
        assert.equal(test.burnIn, SEQUENTIAL_DEFAULTS.burnIn);
        assert.equal(test.monitored, 200 - SEQUENTIAL_DEFAULTS.burnIn);
        assert.equal(monitoring.sigma, Number(test.sigma.toFixed(6)), 'sigma deve ser o mesmo em toda a série');
    });

    it('sem variabilidade no aquecimento o teste se declara indisponível', () => {
        const flat = new Array(50).fill(0.4);
        const test = SequentialTestEngine.alwaysValidPValue(flat);
        assert.equal(test.available, false);
        assert.match(test.reason, /variabilidade/i);
    });

    it('não deixa o piso numérico de sigma virar "p = 0" em série degenerada', () => {
        const flat = new Array(50).fill(0.4);
        const analysis = SequentialTestEngine.analyzePaired(flat, new Array(50).fill(0));
        assert.equal(analysis.available, false);
        assert.equal(analysis.alwaysValidPValue, undefined);
    });
});

describe('Inferência sequencial — propriedades matemáticas', () => {
    it('e-value é positivo e o p fica em [0,1]', () => {
        const values = series({ n: 120, effect: 0.2, sd: 2, seed: 3 });
        const ev = SequentialTestEngine.mixtureEValue(values);
        assert.ok(ev.eValue > 0 && Number.isFinite(ev.eValue));
        assert.ok(ev.pValue === undefined);
        const p = SequentialTestEngine.alwaysValidPValue(values);
        assert.ok(p.pValue >= 0 && p.pValue <= 1);
    });

    it('com sigma fornecido, a ordem dos dados não altera o e-value', () => {
        const values = series({ n: 120, effect: 0.5, sd: 2, seed: 11 });
        const reversed = [...values].reverse();
        const a = SequentialTestEngine.mixtureEValue(values, { sigma: 2 });
        const b = SequentialTestEngine.mixtureEValue(reversed, { sigma: 2 });
        assert.equal(a.monitored, b.monitored);
        assert.ok(Math.abs(a.logEValue - b.logEValue) < 1e-9);
    });

    it('o intervalo sequencial contém a média e é mais largo que o IC clássico', () => {
        const values = series({ n: 200, effect: 0.4, sd: 2, seed: 15 });
        const cs = SequentialTestEngine.confidenceSequence(values);
        assert.ok(cs.lower < cs.meanDiff && cs.meanDiff < cs.upper);
        const classicHalf = 1.96 * cs.meanDiff === 0 ? 0 : 1.96 * 2 / Math.sqrt(cs.n);
        assert.ok(
            cs.halfWidth > classicHalf,
            `IC sequencial (${cs.halfWidth.toFixed(3)}) deveria ser mais largo que o clássico (${classicHalf.toFixed(3)})`
        );
    });

    it('intervalo e teste nunca se contradizem', () => {
        for (const effect of [0, 0.5, 1.2]) {
            const values = series({ n: 200, effect, sd: 2, seed: 31337 + effect * 10 });
            const cs = SequentialTestEngine.confidenceSequence(values);
            const p = SequentialTestEngine.alwaysValidPValue(values);
            assert.equal(
                cs.excludesZero,
                p.pValue < SEQUENTIAL_DEFAULTS.alpha,
                `coerência quebrada em efeito ${effect}: IC exclui zero = ${cs.excludesZero}, p = ${p.pValue}`
            );
        }
    });

    it('a curva de monitoramento tem um ponto por olhada e o mínimo bate', () => {
        const values = series({ n: 80, effect: 0.2, sd: 2, seed: 21 });
        const monitoring = SequentialTestEngine.monitor(values);
        assert.equal(monitoring.curve.length, monitoring.looks);
        assert.ok(Math.abs(monitoring.minPValue - Math.min(...monitoring.curve)) < 1e-6);
        if (monitoring.firstSignificantLook !== null) {
            assert.ok(monitoring.curve[monitoring.firstSignificantLook - 1] <= monitoring.alpha);
        }
    });

    it('rejeita tau, sigma e burnIn inválidos', () => {
        const values = series({ n: 40, effect: 0, sd: 2, seed: 5 });
        assert.throws(() => SequentialTestEngine.mixtureEValue(values, { tau: 0 }), RangeError);
        assert.throws(() => SequentialTestEngine.mixtureEValue(values, { tau: -1 }), RangeError);
        assert.throws(() => SequentialTestEngine.mixtureEValue(values, { sigma: 0 }), RangeError);
        assert.throws(() => SequentialTestEngine.mixtureEValue(values, { burnIn: -3 }), RangeError);
    });

    it('analyzePaired junta p clássico, p sequencial e a interpretação do custo', () => {
        const values = series({ n: 200, effect: 0.3, sd: 2, seed: 8 });
        const analysis = SequentialTestEngine.analyzePaired(values, new Array(200).fill(0), { classicalPValue: 0.03 });
        assert.equal(analysis.available, true);
        assert.equal(analysis.classicalPValue, 0.03);
        assert.equal(analysis.samples, 200);
        assert.match(analysis.interpretation, /p clássico/i);
        assert.match(analysis.interpretation, /poder/i);
        assert.ok(analysis.confidenceSequence.lower < analysis.confidenceSequence.upper);
    });

    it('analyzePaired devolve motivo quando a amostra é curta', () => {
        const analysis = SequentialTestEngine.analyzePaired([1, 2], [0, 1]);
        assert.equal(analysis.available, false);
        assert.match(analysis.reason, /insuficiente|variabilidade/i);
    });
});

describe('Orçamento de α da sessão', () => {
    it('a soma dos limiares de infinitas olhadas não passa de alpha', () => {
        const budget = new AlphaBudget({ alpha: 0.05 });
        let total = 0;
        for (let m = 1; m <= 100000; m++) total += budget.thresholdFor(m);
        assert.ok(total <= 0.05 + 1e-9, `soma dos limiares = ${total} excedeu alpha`);
        assert.ok(total >= 0.0499, 'a série deveria gastar praticamente todo o alpha');
    });

    it('o limiar encolhe a cada olhada', () => {
        const budget = new AlphaBudget({ alpha: 0.05 });
        const limits = [1, 2, 3, 10, 100].map(m => budget.thresholdFor(m));
        for (let i = 1; i < limits.length; i++) assert.ok(limits[i] < limits[i - 1]);
    });

    it('p exatamente no limiar sobrevive e é reescalado para alpha', () => {
        const budget = new AlphaBudget({ alpha: 0.05 });
        const threshold = budget.thresholdFor(1);
        const look = budget.register({ pValue: threshold, label: 'primeira' });
        assert.equal(look.survives, true);
        assert.ok(Math.abs(look.adjustedPValue - 0.05) < 1e-12);
    });

    it('no esquema bonferroni o limiar é alpha/m', () => {
        const budget = new AlphaBudget({ alpha: 0.05, scheme: 'bonferroni' });
        assert.equal(budget.thresholdFor(4), 0.05 / 4);
    });

    it('cinco olhadas com p = 0,5 não sobrevivem e não esgotam o orçamento', () => {
        const budget = new AlphaBudget({ alpha: 0.05 });
        for (let i = 0; i < 5; i++) budget.register({ pValue: 0.5 });
        const report = budget.report();
        assert.equal(report.looks, 5);
        assert.equal(report.survivedLooks, 0);
        assert.ok(report.spent < 0.05);
        assert.ok(report.remaining > 0);
    });

    it('um p minúsculo sobrevive mesmo na décima olhada', () => {
        const budget = new AlphaBudget({ alpha: 0.05 });
        for (let i = 0; i < 9; i++) budget.register({ pValue: 0.5 });
        const look = budget.register({ pValue: 1e-9, label: 'geração 10' });
        assert.equal(look.index, 10);
        assert.equal(look.survives, true);
    });

    it('rejeita alpha, esquema e p-valor inválidos', () => {
        assert.throws(() => new AlphaBudget({ alpha: 0 }), RangeError);
        assert.throws(() => new AlphaBudget({ alpha: 1 }), RangeError);
        assert.throws(() => new AlphaBudget({ scheme: 'magia' }), RangeError);
        const budget = new AlphaBudget();
        assert.throws(() => budget.register({ pValue: -0.1 }), RangeError);
        assert.throws(() => budget.register({ pValue: 1.5 }), RangeError);
        assert.throws(() => budget.register({ pValue: NaN }), RangeError);
    });

    it('reset limpa as olhadas', () => {
        const budget = new AlphaBudget();
        budget.register({ pValue: 0.2 });
        budget.reset();
        assert.equal(budget.lookCount, 0);
        assert.equal(budget.spent, 0);
    });

    it('a sessão compartilhada registra olhadas e pode ser zerada', () => {
        SequentialTestEngine.resetSession();
        const look = SequentialTestEngine.registerLook({ label: 'teste', pValue: 0.04 });
        assert.equal(look.index, 1);
        const report = SequentialTestEngine.getSessionReport();
        assert.equal(report.looks, 1);
        assert.match(report.note, /olhada/i);
        SequentialTestEngine.resetSession();
        assert.equal(SequentialTestEngine.getSessionReport().looks, 0);
    });
});

describe('Integração com o controlador (uma olhada por geração)', () => {
    it('cada geração consome parte do orçamento de α da sessão', async () => {
        const { LotteryController } = await import('../js/controllers/lottery.js');
        SequentialTestEngine.resetSession();

        const makeGames = (p) => ({
            modelPipeline: {
                backtestResult: { pValue: p, evaluatedDraws: 150, sequentialAnalysis: { available: true, alwaysValidPValue: p } }
            }
        });

        const first = LotteryController._registerSessionLook(makeGames(0.5), { type: 'lotofacil', strategy: 'weighted', timeWindow: 100 });
        const second = LotteryController._registerSessionLook(makeGames(0.5), { type: 'mega', strategy: 'hot', timeWindow: 50 });

        assert.equal(first.index, 1);
        assert.equal(second.index, 2);
        assert.ok(second.threshold < first.threshold, 'a segunda olhada recebe menos α que a primeira');
        assert.equal(first.survives, false);
        SequentialTestEngine.resetSession();
    });

    it('ignora gerações sem backtest ou com p inválido', async () => {
        const { LotteryController } = await import('../js/controllers/lottery.js');
        SequentialTestEngine.resetSession();
        assert.equal(LotteryController._registerSessionLook({}, { type: 'x' }), null);
        assert.equal(
            LotteryController._registerSessionLook({ modelPipeline: { backtestResult: { pValue: NaN } } }, { type: 'x' }),
            null
        );
        assert.equal(SequentialTestEngine.getSessionReport().looks, 0);
    });
});

describe('Integração com o backtest', () => {
    it('o resultado do backtest traz o bloco sequencial coerente com a amostra', () => {
        const rng = new SeededRandom(555);
        // Histórico sintético de 60 concursos da Lotofácil.
        const history = [];
        for (let c = 0; c < 60; c++) {
            const set = new Set();
            while (set.size < 15) set.add(1 + Math.floor(rng.next() * 25));
            history.push({ concurso: 1000 - c, dezenas: [...set], data: '2025-01-01' });
        }
        const config = { total: 25, pick: 15, drawn: 15, apiName: 'lotofacil' };
        const generatorFn = (past) => {
            const analysis = StatisticalAnalyzer.analyzeFast(past, config);
            return GameGenerator.generateSingleCandidate('lotofacil', analysis, 'weighted', [], [], config);
        };

        const bt = BacktestEngine.runBacktest(history, config, generatorFn, { windowSize: 30, seed: 123456 });
        assert.ok(bt.sequentialAnalysis, 'backtest deveria trazer sequentialAnalysis');
        const seq = bt.sequentialAnalysis;
        if (seq.available) {
            assert.equal(seq.samples, bt.evaluatedDraws);
            assert.ok(seq.alwaysValidPValue >= 0 && seq.alwaysValidPValue <= 1);
            assert.equal(seq.classicalPValue, bt.pValue);
            assert.ok(seq.confidenceSequence.lower <= seq.meanDiff);
            assert.ok(seq.confidenceSequence.upper >= seq.meanDiff);
            assert.ok(seq.burnIn > 0);
        } else {
            assert.ok(typeof seq.reason === 'string' && seq.reason.length > 0);
        }
    });
});

describe('Proveniência e honestidade do módulo', () => {
    it('cada fonte citada tem referência completa', () => {
        const sources = Object.values(SEQUENTIAL_SOURCES);
        assert.ok(sources.length >= 4);
        for (const s of sources) {
            assert.ok(s.citation && s.citation.length > 20, `fonte ${s.id} sem citação`);
            assert.ok(s.contribution && s.contribution.length > 20, `fonte ${s.id} sem contribuição`);
        }
    });

    it('o cabeçalho declara o custo em poder e não promete previsão', async () => {
        const fs = await import('node:fs/promises');
        const header = await fs.readFile(new URL('../js/engine/sequentialTestEngine.js', import.meta.url), 'utf8');
        assert.match(header, /always-valid/i);
        assert.match(header, /poder/i);
        assert.match(header, /Ville/i);
        assert.match(header, /Johari/i);
        assert.doesNotMatch(header, /prev[eê] (as |os )?(dezenas|n[uú]meros|sorteio)/i);
    });
});
