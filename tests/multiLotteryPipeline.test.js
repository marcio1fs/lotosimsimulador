/**
 * Teste de Validação de Pipeline Completo para Múltiplas Loterias
 * Garante que o pipeline de Precisão Máxima executa perfeitamente para:
 * - Lotofácil (total 25, pick 15)
 * - Mega-Sena (total 60, pick 6)
 * - Quina (total 80, pick 5)
 * - Lotomania (total 100, pick 50)
 * sem assumir universos padrão ou causar estouro de limites.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LotteryModel } from '../js/models/lottery.js';
import { SeededRandom } from '../js/engine/prng.js';
import { MonteCarloEngine } from '../js/engine/monteCarloEngine.js';

function createMockHistoryForConfig(config, drawCount = 40) {
    const history = [];
    const prng = new SeededRandom(12345);
    const { total, pick, drawn = pick } = config;

    for (let i = 0; i < drawCount; i++) {
        const dezenas = [];
        const used = new Set();
        while (dezenas.length < drawn) {
            const n = prng.nextInt(1, total);
            if (!used.has(n)) {
                used.add(n);
                dezenas.push(String(n).padStart(2, '0'));
            }
        }
        history.push({ concurso: 5000 - i, dezenas, data: '2025-01-01' });
    }
    return history;
}

describe('Multi-Lottery Pipeline Certification Suite', () => {

    const lotteries = [
        { key: 'lotofacil', name: 'Lotofácil', total: 25, pick: 15, drawn: 15 },
        { key: 'mega', name: 'Mega-Sena', total: 60, pick: 6, drawn: 6 },
        { key: 'quina', name: 'Quina', total: 80, pick: 5, drawn: 5 },
        { key: 'lotomania', name: 'Lotomania', total: 100, pick: 50, drawn: 20 }
    ];

    lotteries.forEach(lottery => {
        it(`deve executar o pipeline completo de Precisão Máxima para ${lottery.name} (${lottery.key}) com parâmetros próprios`, () => {
            const config = LotteryModel.CONFIG[lottery.key];
            assert.ok(config, `Configuração para ${lottery.key} deve existir`);
            assert.equal(config.total, lottery.total, `Total para ${lottery.key} deve ser ${lottery.total}`);

            const history = createMockHistoryForConfig(config, 40);
            const seed = 98765;
            const games = LotteryModel.generateSmartGames(lottery.key, history, 'maximum_precision', [], [], 5, 'full', seed);

            assert.ok(Array.isArray(games), 'Retorno deve ser um array de jogos');
            assert.equal(games.length, 5, 'Deve gerar exatamente 5 jogos');

            // Validação individual dos jogos
            games.forEach((game, idx) => {
                assert.equal(game.numbers.length, config.pick, `Jogo #${idx+1} de ${lottery.name} deve conter exatamente ${config.pick} dezenas`);
                game.numbers.forEach(n => {
                    assert.ok(n >= 1 && n <= config.total, `Dezena ${n} deve estar no intervalo [1, ${config.total}]`);
                });
                assert.ok(Number.isFinite(game.modelScore), `modelScore do jogo #${idx+1} deve ser um número finito`);
            });

            // Validação dos metadados do pipeline
            const pipeline = games.modelPipeline;
            assert.ok(pipeline, 'Metadados do pipeline devem estar anexados');
            assert.ok(pipeline.coverageScore !== null, `Coverage score para ${lottery.name} não deve ser null`);
            assert.ok(pipeline.diversificationScore !== null, `Diversification score para ${lottery.name} não deve ser null`);
            assert.ok(pipeline.coverageScore >= 0 && pipeline.coverageScore <= 100, `Coverage score deve estar em [0, 100], obteve ${pipeline.coverageScore}`);
            assert.ok(pipeline.diversificationScore >= 0 && pipeline.diversificationScore <= 100, `Diversification score deve estar em [0, 100], obteve ${pipeline.diversificationScore}`);

            // Teste de cálculo explícito de Coverage sem fallback silencioso para 25
            const explicitCoverage = MonteCarloEngine.calculateCoverageScore(games, config);
            assert.equal(explicitCoverage, pipeline.coverageScore, 'Coverage calculado deve bater com o metadado do pipeline');
        });
    });
});
