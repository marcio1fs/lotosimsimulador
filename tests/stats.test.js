import test from 'node:test';
import assert from 'node:assert/strict';
import { StatisticalAnalyzer } from '../js/engine/statisticalAnalyzer.js';
import { ScoringEngine } from '../js/engine/scoringEngine.js';

test('StatisticalAnalyzer - Frequência, Atraso e Estatísticas Descritivas', () => {
    const mockHistory = [
        { concurso: 3, dezenas: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15'] },
        { concurso: 2, dezenas: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '16', '17', '18', '19', '20'] },
        { concurso: 1, dezenas: ['01', '02', '03', '04', '05', '21', '22', '23', '24', '25', '16', '17', '18', '19', '20'] }
    ];

    const config = { total: 25, pick: 15, drawn: 15 };
    const analysis = StatisticalAnalyzer.analyze(mockHistory, config);

    assert.equal(analysis.drawCount, 3);
    assert.equal(analysis.freqAbsolute[1], 3, 'Número 01 deve ter saído 3 vezes');
    assert.equal(analysis.freqAbsolute[25], 1, 'Número 25 deve ter saído 1 vez');
    assert.equal(analysis.currentDelay[1], 0, 'Atraso atual do 01 deve ser 0 (saiu no concurso mais recente)');
    assert.equal(analysis.currentDelay[25], 2, 'Atraso atual do 25 deve ser 2 concursos');

    assert.ok(analysis.sumStats.mean > 0, 'Média de soma deve ser positiva');
    assert.ok(analysis.parityStats.mean > 0, 'Média de paridade deve ser positiva');
});

test('ScoringEngine - Avaliação Transparente sem Falsa Probabilidade', () => {
    const mockHistory = [
        { concurso: 2, dezenas: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15'] },
        { concurso: 1, dezenas: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '16', '17', '18', '19', '20'] }
    ];
    const config = { total: 25, pick: 15, drawn: 15, minPar: 6, maxPar: 9, minSum: 160, maxSum: 220 };
    const analysis = StatisticalAnalyzer.analyze(mockHistory, config);

    const game = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const evaluation = ScoringEngine.evaluateGame(game, config, analysis);

    assert.ok(typeof evaluation.modelScore === 'number', 'Model score deve ser um número');
    assert.ok(evaluation.modelScore >= 0 && evaluation.modelScore <= 100, 'Score deve estar entre 0 e 100');
    assert.ok(evaluation.probabilityType.includes('Não é garantia'), 'Deve explicitar que não é garantia matemática');
    assert.ok(Array.isArray(evaluation.explanations), 'Deve retornar lista de explicações');
});
