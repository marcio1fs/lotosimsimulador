/**
 * Testes — Proveniência e calibração do AntiCrowdEngine (item 6.8)
 *
 * Cobre: registro de priors com fonte declarada, API de proveniência,
 * calibração por popularidade observada com encolhimento, validação de entrada
 * e o comportamento do índice antes/depois de calibrar.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AntiCrowdEngine, CROWD_PRIORS, CROWD_SOURCES, LUCKY_CROWD_NUMBERS } from '../js/engine/antiCrowdEngine.js';
import { LotteryModel } from '../js/models/lottery.js';

const megaCfg = LotteryModel.CONFIG.mega;

/** Garante que o estado estático não vaze entre testes. */
function semCalibracao(fn) {
    return (...args) => {
        AntiCrowdEngine.clearCalibration();
        try {
            return fn(...args);
        } finally {
            AntiCrowdEngine.clearCalibration();
        }
    };
}

describe('AntiCrowdEngine — proveniência dos priors', () => {
    it('todo prior declara base e, quando a base é literatura, uma fonte citável', () => {
        for (const [chave, prior] of Object.entries(CROWD_PRIORS)) {
            assert.ok(
                ['literatura', 'arbitrário', 'sem fonte'].includes(prior.basis),
                `${chave}: basis inválida (${prior.basis})`
            );
            assert.ok(Number.isFinite(prior.value), `${chave}: value não numérico`);
            assert.ok(
                typeof prior.note === 'string' && prior.note.length > 3,
                `${chave}: falta nota explicando o que é`
            );
            if (prior.basis === 'literatura') {
                assert.ok(prior.source, `${chave}: afirma literatura sem citar fonte`);
            }
        }
    });

    it('as fontes citadas existem no registro CROWD_SOURCES', () => {
        const citadas = new Set(Object.values(CROWD_SOURCES));
        for (const [chave, prior] of Object.entries(CROWD_PRIORS)) {
            if (prior.source) {
                assert.ok(citadas.has(prior.source), `${chave} cita fonte fora do registro`);
            }
        }
    });

    it('afirmações sem fonte estão marcadas como tal', () => {
        assert.equal(CROWD_PRIORS.evScaleLarge.basis, 'sem fonte');
        assert.equal(CROWD_PRIORS.evScaleSmall.basis, 'sem fonte');
        assert.equal(CROWD_PRIORS.evScaleLarge.source, null);
    });

    it('getPriorProvenance separa o que tem suporte do que é julgamento', () => {
        const prov = AntiCrowdEngine.getPriorProvenance();
        assert.equal(prov.total, Object.keys(CROWD_PRIORS).length);
        assert.equal(prov.calibrated, false);
        assert.equal(prov.byBasis.literatura + prov.byBasis['arbitrário'] + prov.byBasis['sem fonte'], prov.total);
        assert.ok(prov.byBasis.literatura >= 4, 'deveria haver ao menos 4 direções documentadas');
        assert.match(prov.note, /Sem calibração/);
        assert.ok(Object.keys(prov.sources).length >= 4);
    });

    it('não afirma o "~65% das apostas" sem fonte (o número saiu do cabeçalho)', () => {
        const prov = AntiCrowdEngine.getPriorProvenance();
        const texto = JSON.stringify(prov);
        assert.ok(!/65% das apostas/.test(texto));
    });
});

describe('AntiCrowdEngine — calibração', () => {
    const popularidade = { 1: 9.0, 2: 8.0, 7: 7.5, 31: 6.0, 32: 3.0, 60: 1.0 };

    it(
        'sem calibração, os pesos são apenas o prior',
        semCalibracao(() => {
            // 60: > 31 (+0.25) mas múltiplo de 10 (-0.08) → 0.70 + 0.25 - 0.08
            assert.equal(AntiCrowdEngine.getNumberAntiCrowdWeight(60, 60), 0.87);
            // 12 é mês + dia: 0.70 - 0.22 = 0.48
            assert.equal(AntiCrowdEngine.getNumberAntiCrowdWeight(12, 60), 0.48);
        })
    );

    it('setCalibration devolve resumo com λ = n / (n + k)', () => {
        try {
            const r = AntiCrowdEngine.setCalibration({
                popularityByNumber: popularidade,
                sampleSize: 100000,
                source: 'teste sintético'
            });
            assert.equal(r.calibrated, true);
            assert.equal(r.sampleSize, 100000);
            assert.equal(r.shrinkageLambda, 0.5);
            assert.equal(r.numbersCovered, 6);
            assert.equal(r.source, 'teste sintético');
        } finally {
            AntiCrowdEngine.clearCalibration();
        }
    });

    it('com pouca amostra, o peso fica praticamente no prior', () => {
        try {
            const antes = AntiCrowdEngine.getNumberAntiCrowdWeight(60, 60);
            AntiCrowdEngine.setCalibration({ popularityByNumber: popularidade, sampleSize: 10 });
            const depois = AntiCrowdEngine.getNumberAntiCrowdWeight(60, 60);
            assert.ok(Math.abs(depois - antes) < 0.01, `mudou demais com n=10: ${antes} → ${depois}`);
        } finally {
            AntiCrowdEngine.clearCalibration();
        }
    });

    it('com muita amostra, o peso segue a popularidade observada', () => {
        try {
            AntiCrowdEngine.setCalibration({ popularityByNumber: popularidade, sampleSize: 100000000 });
            // 60 é o menos popular da amostra → peso máximo
            assert.ok(AntiCrowdEngine.getNumberAntiCrowdWeight(60, 60) > 0.99);
            // 1 é o mais popular → peso mínimo
            assert.ok(Math.abs(AntiCrowdEngine.getNumberAntiCrowdWeight(1, 60) - 0.15) < 0.01);
        } finally {
            AntiCrowdEngine.clearCalibration();
        }
    });

    it('dezena menos popular recebe peso maior (monotonicidade)', () => {
        try {
            AntiCrowdEngine.setCalibration({ popularityByNumber: popularidade, sampleSize: 1000000 });
            const p60 = popularidade[60],
                p1 = popularidade[1];
            assert.ok(p60 < p1, 'pré-condição do teste');
            assert.ok(
                AntiCrowdEngine.getNumberAntiCrowdWeight(60, 60) > AntiCrowdEngine.getNumberAntiCrowdWeight(1, 60)
            );
        } finally {
            AntiCrowdEngine.clearCalibration();
        }
    });

    it('λ cresce com o tamanho da amostra', () => {
        const lambdas = [1000, 10000, 100000, 1000000].map(n => {
            try {
                return AntiCrowdEngine.setCalibration({ popularityByNumber: popularidade, sampleSize: n })
                    .shrinkageLambda;
            } finally {
                AntiCrowdEngine.clearCalibration();
            }
        });
        for (let i = 1; i < lambdas.length; i++) {
            assert.ok(lambdas[i] > lambdas[i - 1], `λ não cresceu: ${lambdas.join(', ')}`);
        }
    });

    it('popularidade uniforme devolve o meio da escala', () => {
        try {
            AntiCrowdEngine.setCalibration({
                popularityByNumber: { 10: 5, 20: 5, 30: 5 },
                sampleSize: 100000000
            });
            // λ = n/(n+k) com k = 100.000: mesmo n = 10⁸ deixa ~0,1% de prior,
            // então a convergência é assintótica, não exata.
            assert.ok(
                Math.abs(AntiCrowdEngine.getNumberAntiCrowdWeight(20, 60) - 0.575) < 1e-3,
                `peso = ${AntiCrowdEngine.getNumberAntiCrowdWeight(20, 60)}`
            );
        } finally {
            AntiCrowdEngine.clearCalibration();
        }
    });

    it('clearCalibration restaura exatamente o comportamento de prior', () => {
        const antes = AntiCrowdEngine.getNumberAntiCrowdWeight(45, 60);
        AntiCrowdEngine.setCalibration({ popularityByNumber: popularidade, sampleSize: 100000000 });
        AntiCrowdEngine.clearCalibration();
        assert.equal(AntiCrowdEngine.getNumberAntiCrowdWeight(45, 60), antes);
        assert.equal(AntiCrowdEngine.getCalibration(), null);
    });

    it('rejeita entrada inválida', () => {
        assert.throws(
            () => AntiCrowdEngine.setCalibration({ popularityByNumber: { 1: 5 }, sampleSize: 100 }),
            RangeError
        );
        assert.throws(
            () => AntiCrowdEngine.setCalibration({ popularityByNumber: { 1: 5, 2: -3 }, sampleSize: 100 }),
            RangeError
        );
        assert.throws(
            () => AntiCrowdEngine.setCalibration({ popularityByNumber: { 1: 5, 2: 5 }, sampleSize: 0 }),
            RangeError
        );
        assert.throws(() => AntiCrowdEngine.setCalibration({ popularityByNumber: null, sampleSize: 100 }), TypeError);
        AntiCrowdEngine.clearCalibration();
    });
});

describe('AntiCrowdEngine — índice com e sem calibração', () => {
    const bilhetePopular = [1, 2, 3, 4, 5, 6]; // datas + sequência
    const bilheteImpopular = [33, 41, 44, 47, 53, 58]; // > 31, sem padrão óbvio

    it(
        'o ticket impopular continua pontuando mais que o popular',
        semCalibracao(() => {
            const popular = AntiCrowdEngine.evaluateTicketAntiCrowd(bilhetePopular, megaCfg);
            const impopular = AntiCrowdEngine.evaluateTicketAntiCrowd(bilheteImpopular, megaCfg);
            assert.ok(impopular.antiCrowdScore > popular.antiCrowdScore);
        })
    );

    it(
        'priorStatus declara a ausência de calibração',
        semCalibracao(() => {
            const r = AntiCrowdEngine.evaluateTicketAntiCrowd(bilheteImpopular, megaCfg);
            assert.equal(r.priorStatus.calibrated, false);
            assert.match(r.priorStatus.note, /não calibrad/i);
            assert.equal(r.priorStatus.source, null);
        })
    );

    it('priorStatus muda quando há calibração, sem quebrar o índice', () => {
        try {
            AntiCrowdEngine.setCalibration({
                popularityByNumber: { 33: 1, 41: 1.2, 44: 1.1, 47: 1.3, 53: 1, 58: 1.4 },
                sampleSize: 50000,
                source: 'simulação de popularidade'
            });
            const r = AntiCrowdEngine.evaluateTicketAntiCrowd(bilheteImpopular, megaCfg);
            assert.equal(r.priorStatus.calibrated, true);
            assert.equal(r.priorStatus.source, 'simulação de popularidade');
            assert.ok(r.antiCrowdScore >= 5 && r.antiCrowdScore <= 99);
            assert.ok(Number.isFinite(r.expectedValueMultiplier));
        } finally {
            AntiCrowdEngine.clearCalibration();
        }
    });

    it('getPriorProvenance reflete o estado calibrado', () => {
        try {
            AntiCrowdEngine.setCalibration({ popularityByNumber: { 10: 2, 20: 4 }, sampleSize: 1000, source: 'x' });
            const prov = AntiCrowdEngine.getPriorProvenance();
            assert.equal(prov.calibrated, true);
            assert.equal(prov.calibration.source, 'x');
            assert.match(prov.note, /Calibração ativa/);
        } finally {
            AntiCrowdEngine.clearCalibration();
        }
        assert.equal(AntiCrowdEngine.getPriorProvenance().calibrated, false);
    });

    it(
        ' números de sorte continuam penalizados no prior',
        semCalibracao(() => {
            for (const n of LUCKY_CROWD_NUMBERS) {
                if (n > 31) {
                    // 33 é > 31: bônus de aniversário menos penalidade de sorte
                    assert.equal(AntiCrowdEngine.getNumberAntiCrowdWeight(n, 60), 0.85, `dezena ${n}`);
                }
            }
        })
    );
});
