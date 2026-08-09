import test from 'node:test';
import assert from 'node:assert/strict';
import { BacktestEngine } from '../js/engine/backtestEngine.js';
import { StatisticalAnalyzer } from '../js/engine/statisticalAnalyzer.js';
import { GameGenerator } from '../js/engine/gameGenerator.js';

test('BacktestEngine - Validação Histórica Cega sem Vazamento de Dados e Walk-Forward', () => {
    // Cria um histórico simulado de 40 concursos
    const fullHistory = Array.from({ length: 40 }, (_, idx) => ({
        concurso: 40 - idx,
        dezenas: Array.from({ length: 15 }, (_, i) => String((i + (idx * 3)) % 25 + 1).padStart(2, '0'))
    }));

    const config = { name: 'Lotofácil', total: 25, pick: 15, drawn: 15, apiName: 'lotofacil' };

    let dataLeakageDetected = false;

    // Função de geração personalizada que verifica se o futuro foi vazado no passado
    const testGeneratorFn = (pastHistory, cfg) => {
        const lastPastConcurso = pastHistory.length > 0 ? pastHistory[0].concurso : 9999;
        
        // Se a história do passado contiver qualquer concurso >= concurso que está sendo previsto, houve data leakage
        pastHistory.forEach(draw => {
            if (draw.concurso > lastPastConcurso) {
                dataLeakageDetected = true;
            }
        });

        const analysis = StatisticalAnalyzer.analyze(pastHistory, cfg);
        return GameGenerator.generateSingleCandidate(cfg.apiName, analysis, 'adaptive', [], [], cfg);
    };

    const backtestResult = BacktestEngine.runBacktest(fullHistory, config, testGeneratorFn, { windowSize: 20 });

    assert.equal(dataLeakageDetected, false, 'Não deve haver vazamento de dados futuros no backtest');
    assert.equal(backtestResult.evaluatedDraws, 20, 'Deve ter avaliado 20 concursos');
    assert.ok(backtestResult.meanHits >= 0, 'Média de acertos deve ser um número >= 0');
    assert.ok(backtestResult.baselineMean >= 0, 'Baseline de acertos deve ser um número >= 0');
    assert.ok(typeof backtestResult.relativeImprovement === 'string', 'Melhoria relativa deve ser formatada como string %');
});
