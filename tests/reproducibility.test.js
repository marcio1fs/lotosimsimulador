/**
 * Teste Estrito de Reprodutibilidade 100% Determinística
 * Executa RUN A e RUN B com a mesma semente (123456) e valida identidade total.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LotteryModel } from '../js/models/lottery.js';
import { SeededRandom } from '../js/engine/prng.js';
import { ScoringEngine } from '../js/engine/scoringEngine.js';

function createMockHistory(count = 40) {
    const history = [];
    const prng = new SeededRandom(777);
    for (let i = 0; i < count; i++) {
        const dezenas = [];
        const used = new Set();
        while (dezenas.length < 15) {
            const n = prng.nextInt(1, 25);
            if (!used.has(n)) {
                used.add(n);
                dezenas.push(String(n).padStart(2, '0'));
            }
        }
        history.push({ concurso: 3000 - i, dezenas, data: '2025-01-01' });
    }
    return history;
}

describe('Reproducibility Suite', () => {
    it('RUN A vs RUN B com mesma semente deve gerar resultados 100% idênticos', () => {
        const history = createMockHistory(40);
        const config = LotteryModel.CONFIG.lotofacil;
        const seed = 123456;

        // Execução A
        const runA = LotteryModel.generateSmartGames('lotofacil', history, 'maximum_precision', [], [], 10, 'full', seed);

        // Execução B
        const runB = LotteryModel.generateSmartGames('lotofacil', history, 'maximum_precision', [], [], 10, 'full', seed);

        // Comparação de jogos gerados
        assert.equal(runA.length, runB.length, 'Quantidade de jogos deve ser igual');

        for (let i = 0; i < runA.length; i++) {
            assert.deepStrictEqual(runA[i].numbers, runB[i].numbers, `Jogo #${i+1} números devem ser idênticos`);
            assert.equal(runA[i].modelScore, runB[i].modelScore, `Jogo #${i+1} modelScore deve ser idêntico`);
        }

        // Comparação de pipeline e metadados estatísticos
        const pipeA = runA.modelPipeline;
        const pipeB = runB.modelPipeline;

        assert.equal(pipeA.status, pipeB.status, 'Status do modelo deve ser idêntico');
        assert.equal(pipeA.backtestResult.meanHits, pipeB.backtestResult.meanHits, 'Média do backtest deve ser idêntica');
        assert.equal(pipeA.backtestResult.pValue, pipeB.backtestResult.pValue, 'p-value deve ser idêntico');
        assert.equal(pipeA.portfolioCoverage, pipeB.portfolioCoverage, 'Coverage deve ser idêntico');
        assert.deepStrictEqual(pipeA.optWeightsResult.optimizedWeights, pipeB.optWeightsResult.optimizedWeights, 'Pesos otimizados devem ser idênticos');
    });

    it('ScoringEngine.optimizeWeights deve ser 100% determinístico com mesma seed', () => {
        const history = createMockHistory(40);
        const config = LotteryModel.CONFIG.lotofacil;
        const seed = 123456;

        const opt1 = ScoringEngine.optimizeWeights(history, config, { seed });
        const opt2 = ScoringEngine.optimizeWeights(history, config, { seed });

        assert.deepStrictEqual(opt1, opt2, 'Otimização de pesos deve ser idêntica com mesma semente');
    });
});
