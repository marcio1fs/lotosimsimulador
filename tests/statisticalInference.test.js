/**
 * Testes Unitários de Inferência Estatística Exata
 * Valida a exatidão matemática do Módulo de Inferência Estatística:
 * - Log-Gama e Incomplete Beta
 * - CDF exata de t de Student e Normal Z
 * - Intervalos de Confiança (Student-t para n < 30, Normal Z para n >= 30)
 * - Teste t Pareado e p-value exato
 * - Tamanho do Efeito de Cohen (d)
 * - Bootstrap determinístico
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StatisticalInference } from '../js/engine/statisticalInference.js';

describe('StatisticalInference - Funções Matemáticas Especiais', () => {
    it('logGamma deve retornar valores exatos', () => {
        // ln(Γ(1)) = 0, ln(Γ(2)) = 0, ln(Γ(3)) = ln(2) ≈ 0.693147
        assert.ok(Math.abs(StatisticalInference.logGamma(1)) < 1e-10);
        assert.ok(Math.abs(StatisticalInference.logGamma(2)) < 1e-10);
        assert.ok(Math.abs(StatisticalInference.logGamma(3) - Math.log(2)) < 1e-8);
    });

    it('studentTCDF deve ser consistente em pontos simétricos', () => {
        const cdf0 = StatisticalInference.studentTCDF(0, 10);
        assert.equal(cdf0, 0.5, 'CDF(0) deve ser exatamente 0.5');

        const cdfPos = StatisticalInference.studentTCDF(2.0, 10);
        const cdfNeg = StatisticalInference.studentTCDF(-2.0, 10);
        assert.ok(Math.abs((cdfPos + cdfNeg) - 1.0) < 1e-6, 'CDF(t) + CDF(-t) deve ser igual a 1.0');
    });

    it('studentTCriticalValue deve retornar o valor crítico correto para 95% de confiança', () => {
        // Para df=10, t_crit(0.05, 10) ≈ 2.228
        const tCrit = StatisticalInference.studentTCriticalValue(0.95, 10);
        assert.ok(Math.abs(tCrit - 2.228) < 0.05, `t_crit real era 2.228, obteve ${tCrit}`);
    });
});

describe('StatisticalInference - Intervalo de Confiança Dinâmico', () => {
    it('deve usar Student-t para amostras pequenas (n < 30)', () => {
        const smallSample = [8, 9, 10, 9, 8, 10, 9, 8, 9, 10]; // n = 10
        const ci = StatisticalInference.confidenceInterval(smallSample, 0.95);

        assert.equal(ci.method, 'Student-t');
        assert.ok(ci.lower < ci.mean);
        assert.ok(ci.upper > ci.mean);
        assert.equal(ci.sampleSize, 10);
    });

    it('deve usar Normal Z para amostras grandes (n >= 30)', () => {
        const largeSample = Array.from({ length: 40 }, (_, i) => 8 + (i % 5));
        const ci = StatisticalInference.confidenceInterval(largeSample, 0.95);

        assert.equal(ci.method, 'Normal Z');
        assert.ok(ci.lower < ci.mean);
        assert.ok(ci.upper > ci.mean);
        assert.equal(ci.sampleSize, 40);
    });

    it('deve retornar null para amostra vazia', () => {
        const ci = StatisticalInference.confidenceInterval([], 0.95);
        assert.equal(ci, null);
    });
});

describe('StatisticalInference - Teste t Pareado e Cohen d', () => {
    it('deve calcular p-value e Cohen d para amostras com diferença positiva', () => {
        const modelHits = [12, 13, 14, 13, 12, 14, 13, 12, 13, 14, 13, 12, 14, 13, 12];
        const baselineHits = [9, 8, 9, 8, 9, 8, 9, 8, 9, 8, 9, 8, 9, 8, 9];

        const test = StatisticalInference.pairedTTest(modelHits, baselineHits);

        assert.ok(test.difference > 0, 'Diferença deve ser positiva');
        assert.ok(test.pValue < 0.01, `p-value deve ser significativo (< 0.01), obteve ${test.pValue}`);
        assert.equal(test.statisticallySignificant, true);
        assert.ok(test.effectSize > 0.8, `Efeito Cohen d deve ser grande, obteve ${test.effectSize}`);
        assert.equal(test.effectDescriptor, 'Grande');
    });

    it('deve marcar como NÃO significante quando o modelo não tem evidência suficiente (p >= 0.05)', () => {
        // Amostras muito semelhantes com alta variância
        const modelHits = [9, 8, 10, 8, 9, 7, 10, 8, 9, 8];
        const baselineHits = [8, 9, 8, 9, 8, 9, 8, 9, 8, 9];

        const test = StatisticalInference.pairedTTest(modelHits, baselineHits);

        assert.equal(test.statisticallySignificant, false);
        assert.ok(test.pValue >= 0.05, `p-value deve ser >= 0.05, obteve ${test.pValue}`);
        assert.ok(test.conclusion.toLowerCase().includes('não há evidência estatística suficiente'), 'Conclusão transparente');
    });
});

describe('StatisticalInference - Bootstrap Determinístico', () => {
    it('deve produzir os mesmos resultados com a mesma seed', () => {
        const modelHits = [11, 12, 13, 10, 12, 13, 11, 12, 13, 11];
        const baselineHits = [8, 9, 8, 9, 8, 9, 8, 9, 8, 9];

        const res1 = StatisticalInference.bootstrapCompare(modelHits, baselineHits, { iterations: 1000, seed: 123456 });
        const res2 = StatisticalInference.bootstrapCompare(modelHits, baselineHits, { iterations: 1000, seed: 123456 });

        assert.equal(res1.meanDiff, res2.meanDiff);
        assert.equal(res1.ciLower, res2.ciLower);
        assert.equal(res1.ciUpper, res2.ciUpper);
        assert.equal(res1.pValue, res2.pValue);
    });
});
