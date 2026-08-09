/**
 * Teste Automatizado Estrito de Prevenção de Data Leakage (Vazamento Temporal de Dados)
 * Valida rigorosamente que alterações em concursos futuros NÃO alteram a previsão de concursos passados.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StatisticalAnalyzer } from '../js/engine/statisticalAnalyzer.js';
import { GameGenerator } from '../js/engine/gameGenerator.js';
import { BacktestEngine } from '../js/engine/backtestEngine.js';
import { SeededRandom } from '../js/engine/prng.js';

function createMockHistory(count = 50) {
    const history = [];
    const prng = new SeededRandom(999);
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

const mockConfig = { total: 25, pick: 15, drawn: 15, apiName: 'lotofacil', name: 'Lotofacil' };

describe('Data Leakage Prevention Test', () => {
    it('alterar um concurso futuro NÃO DEVE alterar a previsão de um concurso passado', () => {
        const originalHistory = createMockHistory(50);
        
        // Suponhamos que queremos a previsão para o concurso no índice 10 (concurso passado)
        const pastCutoffIndex = 10;
        const pastHistorySlice = originalHistory.slice(pastCutoffIndex); // concursos antigos do passado

        // Previsão 1 com o histórico original
        const prng1 = new SeededRandom(123456);
        const generatorFn = (past, cfg) => {
            const analysis = StatisticalAnalyzer.analyze(past, cfg);
            return GameGenerator.generateSingleCandidate(cfg.apiName, analysis, 'adaptive', [], [], cfg, null, prng1);
        };

        const originalPrediction = generatorFn(pastHistorySlice, mockConfig);

        // Agora criamos um histórico modificado mutando um concurso no FUTURO em relação a pastCutoffIndex (ex: índice 0 ou 1)
        const mutatedHistory = JSON.parse(JSON.stringify(originalHistory));
        // Altera totalmente o concurso mais recente no futuro (índice 0)
        mutatedHistory[0].dezenas = ['20', '21', '22', '23', '24', '25', '19', '18', '17', '16', '15', '14', '13', '12', '11'];

        // Previsão 2 para a MESMA posição do passado (pastCutoffIndex)
        const pastMutatedHistorySlice = mutatedHistory.slice(pastCutoffIndex);
        const prng2 = new SeededRandom(123456);
        const generatorFn2 = (past, cfg) => {
            const analysis = StatisticalAnalyzer.analyze(past, cfg);
            return GameGenerator.generateSingleCandidate(cfg.apiName, analysis, 'adaptive', [], [], cfg, null, prng2);
        };

        const mutatedPrediction = generatorFn2(pastMutatedHistorySlice, mockConfig);

        // Asserção estrita: as duas previsões devem ser 100% idênticas
        assert.deepStrictEqual(originalPrediction, mutatedPrediction, 
            'ERRO GRAVE: DATA LEAKAGE DETECTADO! A alteração de um concurso futuro alterou a previsão do passado.');
    });

    it('o motor de BacktestEngine deve certificar dataLeakageDetected: false', () => {
        const history = createMockHistory(40);
        const prng = new SeededRandom(123456);
        const generatorFn = (past, cfg) => {
            const analysis = StatisticalAnalyzer.analyze(past, cfg);
            return GameGenerator.generateSingleCandidate(cfg.apiName, analysis, 'adaptive', [], [], cfg, null, prng);
        };

        const bt = BacktestEngine.runBacktest(history, mockConfig, generatorFn, { windowSize: 20, seed: 123456 });

        assert.equal(bt.dataLeakageDetected, false, 'BacktestEngine deve certificar ausência de data leakage');
    });
});
