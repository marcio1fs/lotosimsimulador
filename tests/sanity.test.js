/**
 * Testes de Sanidade com Dados Controlados
 * Valida o comportamento do modelo sob condições ideais conhecidas:
 * 1. Dataset Uniforme Artificial: não deve declarar significância fictícia ou dezena mágica.
 * 2. Dataset com Padrão Controlado (Viés Artificial): deve detectar o viés e registrar significância estatística real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StatisticalAnalyzer } from '../js/engine/statisticalAnalyzer.js';
import { StatisticalInference } from '../js/engine/statisticalInference.js';
import { BacktestEngine } from '../js/engine/backtestEngine.js';
import { GameGenerator } from '../js/engine/gameGenerator.js';
import { SeededRandom } from '../js/engine/prng.js';

const mockConfig = { total: 25, pick: 15, drawn: 15, apiName: 'lotofacil', name: 'Lotofacil' };

describe('Sanity Tests - Dataset Uniforme', () => {
    it('em um dataset perfeitamente uniforme, Chi-Square deve ser 0 e p-value deve ser alto', () => {
        // Gera 100 concursos onde cada número de 1 a 25 aparece exatamente 60 vezes
        const freqAbsolute = {};
        for (let i = 1; i <= 25; i++) freqAbsolute[i] = 60;

        const chi = StatisticalAnalyzer.chiSquareUniformity(freqAbsolute, 25, 100, 15);

        assert.equal(chi.chiSquare, 0, 'Chi-square deve ser 0 para frequência idêntica');
        assert.ok(chi.isUniform, 'Deve ser classificado como uniforme');
        assert.ok(chi.pValue > 0.9, 'p-value do chi-square deve ser alto');
    });

    it('em um dataset uniforme, a diferença para baseline deve ter p-value alto (sem falsa vantagem)', () => {
        // Amostras idênticas de modelo e baseline (sem padrão)
        const modelHits = [9, 9, 9, 9, 9, 9, 9, 9, 9, 9];
        const baselineHits = [9, 9, 9, 9, 9, 9, 9, 9, 9, 9];

        const test = StatisticalInference.pairedTTest(modelHits, baselineHits);

        assert.equal(test.statisticallySignificant, false, 'Não deve inventar significância em dataset uniforme');
        assert.equal(test.difference, 0);
    });
});

describe('Sanity Tests - Dataset com Padrão Controlado (Viés Injetado)', () => {
    it('deve detectar padrão quando dezenas específicas (01 a 15) saem com 100% de frequência', () => {
        // Injeta viés artificial: dezenas 01 a 15 saem SEMPRE nos concursos
        const biasedHistory = [];
        for (let i = 0; i < 50; i++) {
            biasedHistory.push({
                concurso: 3000 - i,
                dezenas: ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15'],
                data: '2025-01-01'
            });
        }

        const prng = new SeededRandom(123456);
        const generatorFn = (past, cfg) => {
            const analysis = StatisticalAnalyzer.analyze(past, cfg);
            return GameGenerator.generateSingleCandidate(cfg.apiName, analysis, 'adaptive', [], [], cfg, null, prng);
        };

        const bt = BacktestEngine.runBacktest(biasedHistory, mockConfig, generatorFn, { windowSize: 30, seed: 123456 });

        assert.ok(bt.meanHits > bt.baselineMean, 'Média do modelo deve ser significativamente maior que baseline');
        assert.ok(bt.isStatisticallySignificant, 'Deve detectar a vantagem estatística real');
        assert.ok(bt.pValue < 0.001, 'p-value deve ser extremamente pequeno (alta evidência)');
    });
});
