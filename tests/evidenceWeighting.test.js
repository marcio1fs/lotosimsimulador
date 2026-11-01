/**
 * Testes — EvidenceWeightingEngine
 *
 * Cobre: portão de evidência (FDR), renormalização, "sem teste ≠ sem efeito",
 * integração com ScoringEngine e GameGenerator, e validade estrutural dos jogos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EvidenceWeightingEngine } from '../js/engine/evidenceWeightingEngine.js';
import { ScoringEngine, DEFAULT_WEIGHTS } from '../js/engine/scoringEngine.js';
import { GameGenerator } from '../js/engine/gameGenerator.js';
import { StatisticalAnalyzer } from '../js/engine/statisticalAnalyzer.js';
import { LotteryModel } from '../js/models/lottery.js';
import { SeededRandom } from '../js/engine/prng.js';

const cfg = LotteryModel.CONFIG.lotofacil;

/** Análise mínima com Markov e pares controláveis. */
function makeAnalysis({ testedTransitions = 100, significantTransitions = 0, pairs = [], examined = 300 } = {}) {
    return {
        markovStats: {
            testedTransitions,
            significantTransitions,
            hasStatisticallySignificantSignal: significantTransitions > 0,
            method: 'FDR de Benjamini-Hochberg (5%)'
        },
        topPairs: pairs,
        pairStats: { examined, tested: pairs.length, significant: pairs.filter(p => p.significant).length }
    };
}

function makePairs(total, significantCount) {
    return Array.from({ length: total }, (_, i) => ({
        pair: [i + 1, i + 2],
        count: 10,
        pValue: 0.5,
        qValue: significantCount > i ? 0.001 : 0.9,
        significant: i < significantCount
    }));
}

describe('EvidenceWeightingEngine — avaliação', () => {
    it('sem análise, nenhum fator é avaliado e nada é zerado', () => {
        const a = EvidenceWeightingEngine.assess(null);
        assert.equal(a.assessedAny, false);
        assert.deepEqual(a.gatedFactors, []);
        for (const f of a.factors) {
            assert.equal(f.assessed, false);
            assert.equal(f.multiplier, 1);
        }
    });

    it('Markov sem transição significativa é zerado', () => {
        const a = EvidenceWeightingEngine.assess(makeAnalysis({ testedTransitions: 360, significantTransitions: 0 }));
        const mkv = a.factors.find(f => f.factor === 'markov');
        assert.equal(mkv.assessed, true);
        assert.equal(mkv.rejectedH0, false);
        assert.equal(mkv.multiplier, 0);
        assert.match(mkv.reason, /nenhuma das 360 transições/);
        assert.ok(a.gatedFactors.includes('markov'));
    });

    it('Markov com transição significativa mantém o peso', () => {
        const a = EvidenceWeightingEngine.assess(makeAnalysis({ testedTransitions: 360, significantTransitions: 4 }));
        const mkv = a.factors.find(f => f.factor === 'markov');
        assert.equal(mkv.rejectedH0, true);
        assert.equal(mkv.multiplier, 1);
        assert.match(mkv.reason, /4 de 360/);
        assert.ok(!a.gatedFactors.includes('markov'));
    });

    it('co-ocorrência sem par significativo é zerada', () => {
        const a = EvidenceWeightingEngine.assess(makeAnalysis({ pairs: makePairs(30, 0) }));
        const co = a.factors.find(f => f.factor === 'cooccurrence');
        assert.equal(co.multiplier, 0);
        assert.match(co.reason, /nenhum dos 30 pares/);
    });

    it('co-ocorrência com par significativo mantém o peso', () => {
        const a = EvidenceWeightingEngine.assess(makeAnalysis({ pairs: makePairs(30, 2) }));
        const co = a.factors.find(f => f.factor === 'cooccurrence');
        assert.equal(co.multiplier, 1);
        assert.match(co.reason, /2 par\(es\)/);
    });

    it('histórico curto NÃO zera nada: ausência de teste não é evidência de ausência', () => {
        const analysis = {
            markovStats: { testedTransitions: 0, significantTransitions: 0 },
            topPairs: []
        };
        const a = EvidenceWeightingEngine.assess(analysis);
        assert.equal(a.assessedAny, false);
        assert.deepEqual(a.gatedFactors, []);
        for (const f of a.factors) {
            assert.equal(f.multiplier, 1, `${f.factor} não deveria ser zerado sem teste`);
        }
        assert.ok(a.notes.some(n => /sem teste disponível/.test(n)));
    });

    it('desligar a ponderação mantém todos os multiplicadores em 1', () => {
        const analysis = makeAnalysis({ testedTransitions: 200, significantTransitions: 0, pairs: makePairs(30, 0) });
        const a = EvidenceWeightingEngine.assess(analysis, { enabled: false });
        for (const f of a.factors) assert.equal(f.multiplier, 1);
        assert.deepEqual(a.gatedFactors, []);
    });
});

describe('EvidenceWeightingEngine — aplicação dos pesos', () => {
    const semEvidencia = makeAnalysis({
        testedTransitions: 300, significantTransitions: 0, pairs: makePairs(30, 0)
    });

    it('zera os fatores refutados e renormaliza para somar 1', () => {
        const { weights, report } = EvidenceWeightingEngine.applyWeights(DEFAULT_WEIGHTS, semEvidencia);
        assert.equal(weights.markov, 0);
        assert.equal(weights.cooccurrence, 0);
        const soma = Object.values(weights).reduce((s, w) => s + w, 0);
        assert.ok(Math.abs(soma - 1) < 1e-12, `soma = ${soma}`);
        assert.equal(report.applied, true);
        assert.equal(report.removedWeight, 0.21);
        assert.deepEqual(report.gatedFactors.sort(), ['cooccurrence', 'markov']);
    });

    it('redistribui o peso removido proporcionalmente entre os demais', () => {
        const { weights } = EvidenceWeightingEngine.applyWeights(DEFAULT_WEIGHTS, semEvidencia);
        const fator = 1 / (1 - 0.21);
        for (const [k, v] of Object.entries(DEFAULT_WEIGHTS)) {
            if (k === 'markov' || k === 'cooccurrence') continue;
            assert.ok(Math.abs(weights[k] - v * fator) < 1e-9, `${k}: ${weights[k]} vs ${v * fator}`);
        }
    });

    it('com evidência presente, os pesos originais são preservados', () => {
        const comEvidencia = makeAnalysis({ testedTransitions: 300, significantTransitions: 5, pairs: makePairs(30, 3) });
        const { weights, report } = EvidenceWeightingEngine.applyWeights(DEFAULT_WEIGHTS, comEvidencia);
        assert.deepEqual(weights, DEFAULT_WEIGHTS);
        assert.equal(report.applied, false);
        assert.deepEqual(report.gatedFactors, []);
    });

    it('não mexe em fatores que já tinham peso zero', () => {
        const base = { ...DEFAULT_WEIGHTS, markov: 0 };
        const { weights, report } = EvidenceWeightingEngine.applyWeights(base, semEvidencia);
        assert.equal(weights.markov, 0);
        assert.equal(report.removedWeight, 0.11, 'só a co-ocorrência deveria ser contabilizada');
    });

    it('respeita pesos customizados', () => {
        const base = { ...DEFAULT_WEIGHTS, markov: 0.4, cooccurrence: 0.1, frequency: 0.2 };
        const { weights } = EvidenceWeightingEngine.applyWeights(base, semEvidencia);
        assert.equal(weights.markov, 0);
        assert.equal(weights.cooccurrence, 0);
        assert.ok(Math.abs(Object.values(weights).reduce((s, w) => s + w, 0) - 1) < 1e-12);
    });

    it('não vaza resultado entre chamadas com pesos diferentes', () => {
        const a = EvidenceWeightingEngine.applyWeights(DEFAULT_WEIGHTS, semEvidencia).weights;
        const b = EvidenceWeightingEngine.applyWeights({ ...DEFAULT_WEIGHTS, frequency: 0.5 }, semEvidencia).weights;
        assert.notEqual(a.frequency, b.frequency);
        assert.equal(a.markov, 0);
        assert.equal(b.markov, 0);
    });

    it('protege contra soma zero', () => {
        const base = { markov: 0.1, cooccurrence: 0.1 };
        const { weights } = EvidenceWeightingEngine.applyWeights(base, semEvidencia);
        assert.ok(Object.values(weights).every(w => Number.isFinite(w)));
        assert.equal(Object.values(weights).reduce((s, w) => s + w, 0), 0);
    });

    it('summarize devolve só o essencial', () => {
        const { report } = EvidenceWeightingEngine.applyWeights(DEFAULT_WEIGHTS, semEvidencia);
        const s = EvidenceWeightingEngine.summarize(report);
        assert.deepEqual(Object.keys(s).sort(), ['applied', 'factors', 'gatedFactors', 'removedWeight', 'summary']);
        assert.equal(s.applied, true);
        assert.equal(s.factors.length, 2);
        assert.equal(s.factors[0].defaultWeight, DEFAULT_WEIGHTS.markov);
        assert.equal(s.factors[0].effectiveWeight, 0);
        assert.equal(EvidenceWeightingEngine.summarize(null), null);
    });
});

describe('EvidenceWeightingEngine — integração', () => {
    function syntheticHistory(draws = 300, seed = 2026) {
        const rng = new SeededRandom(seed);
        const history = [];
        for (let i = 0; i < draws; i++) {
            const set = new Set();
            while (set.size < cfg.drawn) set.add(rng.nextInt(1, cfg.total));
            history.push({ concurso: draws - i, dezenas: [...set].sort((a, b) => a - b) });
        }
        return history;
    }

    const analysis = StatisticalAnalyzer.analyze(syntheticHistory(), cfg);

    it('a análise expõe pairStats para a ponderação', () => {
        assert.ok(analysis.pairStats, 'pairStats ausente');
        assert.equal(analysis.pairStats.examined, (cfg.total * (cfg.total - 1)) / 2);
        assert.ok(Number.isInteger(analysis.pairStats.significant));
    });

    it('em sorteio uniforme, os dois fatores são zerados', () => {
        const a = EvidenceWeightingEngine.assess(analysis);
        assert.equal(a.factors.find(f => f.factor === 'markov').multiplier, 0);
        assert.equal(a.factors.find(f => f.factor === 'cooccurrence').multiplier, 0);
    });

    it('evaluateGame registra o ajuste e continua devolvendo score válido', () => {
        const game = Array.from({ length: cfg.pick }, (_, i) => i + 1);
        const withGate = ScoringEngine.evaluateGame(game, cfg, analysis);
        const withoutGate = ScoringEngine.evaluateGame(game, cfg, analysis, null, null, { evidenceWeighting: false });

        assert.equal(withGate.evidenceAdjustment.applied, true);
        assert.deepEqual(withGate.evidenceAdjustment.gatedFactors.sort(), ['cooccurrence', 'markov']);
        assert.equal(withoutGate.evidenceAdjustment.applied, false);

        for (const r of [withGate, withoutGate]) {
            assert.ok(Number.isFinite(r.modelScore));
            assert.ok(r.modelScore >= 0 && r.modelScore <= 100);
        }
        assert.notEqual(withGate.modelScore, withoutGate.modelScore,
            'o score deveria mudar quando 21% do peso deixa de contar');
    });

    it('evaluateGame lida com análise parcial (analyzeFast)', () => {
        // analyzeFast calcula Markov mas não pares: só o fator testável é
        // avaliado. A co-ocorrência fica com o peso, porque não foi testada —
        // e ausência de teste não é evidência de ausência.
        const fast = StatisticalAnalyzer.analyzeFast(syntheticHistory(120), cfg);
        const game = Array.from({ length: cfg.pick }, (_, i) => i + 1);
        const r = ScoringEngine.evaluateGame(game, cfg, fast);

        assert.ok(Number.isFinite(r.modelScore));
        assert.deepEqual(r.evidenceAdjustment.gatedFactors, ['markov']);
        assert.equal(r.evidenceAdjustment.removedWeight, DEFAULT_WEIGHTS.markov);
    });

    it('a geração respeita a flag e produz jogos estruturalmente válidos', () => {
        const original = GameGenerator.evidenceWeightingEnabled;
        try {
            GameGenerator.evidenceWeightingEnabled = false;
            const semPortao = GameGenerator.generateBatch('lotofacil', analysis, 'adaptive', [], [], 5, cfg, null, null, 4242);

            GameGenerator.evidenceWeightingEnabled = true;
            const comPortao = GameGenerator.generateBatch('lotofacil', analysis, 'adaptive', [], [], 5, cfg, null, null, 4242);

            for (const batch of [semPortao, comPortao]) {
                assert.equal(batch.length, 5);
                for (const g of batch) {
                    assert.equal(new Set(g.numbers).size, cfg.pick, 'dezenas repetidas');
                    assert.ok(g.numbers.every(n => n >= 1 && n <= cfg.total));
                    const evens = g.numbers.filter(n => n % 2 === 0).length;
                    assert.ok(evens >= cfg.minPar && evens <= cfg.maxPar, `paridade fora da faixa: ${evens}`);
                }
            }

            const iguais = semPortao.filter(g =>
                comPortao.some(o => o.numbers.join(',') === g.numbers.join(','))).length;
            assert.equal(iguais, 0, 'os jogos deveriam mudar quando 21% do peso deixa de contar');
        } finally {
            GameGenerator.evidenceWeightingEnabled = original;
        }
    });

    it('é determinístico com a mesma semente', () => {
        const original = GameGenerator.evidenceWeightingEnabled;
        try {
            GameGenerator.evidenceWeightingEnabled = true;
            const a = GameGenerator.generateBatch('lotofacil', analysis, 'adaptive', [], [], 5, cfg, null, null, 99);
            const b = GameGenerator.generateBatch('lotofacil', analysis, 'adaptive', [], [], 5, cfg, null, null, 99);
            assert.deepEqual(a.map(g => g.numbers), b.map(g => g.numbers));
        } finally {
            GameGenerator.evidenceWeightingEnabled = original;
        }
    });
});
