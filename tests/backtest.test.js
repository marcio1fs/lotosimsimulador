/**
 * Testes Expandidos - BacktestEngine
 * Cobre: data leakage, p-value, intervalo de confiança, walk-forward, overfitting, seeds
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BacktestEngine } from '../js/engine/backtestEngine.js';
import { StatisticalAnalyzer } from '../js/engine/statisticalAnalyzer.js';
import { GameGenerator } from '../js/engine/gameGenerator.js';

// Dados mock - 40 concursos para lotofacil
function generateMockHistory(count = 40) {
    const history = [];
    for (let i = 0; i < count; i++) {
        const dezenas = [];
        const used = new Set();
        while (dezenas.length < 15) {
            const n = Math.floor(Math.random() * 25) + 1;
            if (!used.has(n)) { used.add(n); dezenas.push(String(n).padStart(2, '0')); }
        }
        history.push({ concurso: 3200 - i, dezenas, data: `2025-01-${String(count - i).padStart(2, '0')}` });
    }
    return history;
}

const mockConfig = { total: 25, pick: 15, drawn: 15, apiName: 'lotofacil', name: 'Lotofacil' };

describe('BacktestEngine - Data Leakage', () => {
    it('não deve permitir vazamento de dados futuros', () => {
        const history = generateMockHistory(40);
        let leakDetected = false;

        const generatorFn = (pastHistory, cfg) => {
            const futureDraws = history.slice(0, history.indexOf(pastHistory[0]));
            futureDraws.forEach(fd => {
                if (pastHistory.some(p => p.concurso === fd.concurso)) {
                    leakDetected = true;
                }
            });
            const analysis = StatisticalAnalyzer.analyze(pastHistory, cfg);
            return GameGenerator.generateSingleCandidate(cfg.apiName, analysis, 'weighted', [], [], cfg);
        };

        const result = BacktestEngine.runBacktest(history, mockConfig, generatorFn, { windowSize: 20 });
        assert.equal(result.dataLeakageDetected, false, 'Não deve detectar data leakage');
    });
});

describe('BacktestEngine - Métricas Estatísticas', () => {
    it('deve retornar resultado válido com todas as métricas', () => {
        const history = generateMockHistory(40);
        const generatorFn = (past, cfg) => {
            const analysis = StatisticalAnalyzer.analyze(past, cfg);
            return GameGenerator.generateSingleCandidate(cfg.apiName, analysis, 'adaptive', [], [], cfg);
        };

        const result = BacktestEngine.runBacktest(history, mockConfig, generatorFn, { windowSize: 20 });

        assert.ok(result.meanHits >= 0, 'meanHits deve ser >= 0');
        assert.ok(result.baselineMean >= 0, 'baselineMean deve ser >= 0');
        assert.ok(result.evaluatedDraws > 0, 'evaluatedDraws deve ser > 0');
    });

    it('deve calcular intervalo de confiança real', () => {
        const history = generateMockHistory(40);
        const generatorFn = (past, cfg) => {
            const analysis = StatisticalAnalyzer.analyze(past, cfg);
            return GameGenerator.generateSingleCandidate(cfg.apiName, analysis, 'weighted', [], [], cfg);
        };

        const result = BacktestEngine.runBacktest(history, mockConfig, generatorFn, { windowSize: 20 });

        if (result.confidenceInterval) {
            assert.ok(result.confidenceInterval.lower <= result.confidenceInterval.upper, 
                'IC lower deve ser <= IC upper');
            assert.ok(result.confidenceInterval.lower <= result.meanHits, 
                'IC lower deve ser <= meanHits');
        }
    });

    it('deve calcular p-value entre 0 e 1', () => {
        const history = generateMockHistory(40);
        const generatorFn = (past, cfg) => {
            const analysis = StatisticalAnalyzer.analyze(past, cfg);
            return GameGenerator.generateSingleCandidate(cfg.apiName, analysis, 'adaptive', [], [], cfg);
        };

        const result = BacktestEngine.runBacktest(history, mockConfig, generatorFn, { windowSize: 20 });

        if (result.pValue !== undefined) {
            assert.ok(result.pValue >= 0 && result.pValue <= 1, 
                `p-value ${result.pValue} fora do intervalo [0, 1]`);
        }
    });

    it('deve retornar breakdown de acertos por faixa', () => {
        const history = generateMockHistory(40);
        const generatorFn = (past, cfg) => {
            const analysis = StatisticalAnalyzer.analyze(past, cfg);
            return GameGenerator.generateSingleCandidate(cfg.apiName, analysis, 'weighted', [], [], cfg);
        };

        const result = BacktestEngine.runBacktest(history, mockConfig, generatorFn, { windowSize: 20 });

        if (result.hitTierBreakdown) {
            assert.ok(typeof result.hitTierBreakdown === 'object', 'hitTierBreakdown deve ser um objeto');
        }
    });
});

describe('BacktestEngine - Paired T-Test', () => {
    it('deve retornar resultado válido para amostras iguais', () => {
        const model = [8, 9, 10, 8, 9, 10, 8, 9, 10, 8];
        const baseline = [8, 9, 10, 8, 9, 10, 8, 9, 10, 8];
        const result = BacktestEngine.pairedTTest(model, baseline);
        
        assert.equal(result.tStatistic, 0, 'tStatistic deve ser 0 para amostras iguais');
    });

    it('deve detectar diferença significativa para amostras distintas', () => {
        const model = [12, 13, 12, 14, 13, 12, 13, 14, 12, 13];
        const baseline = [9, 8, 9, 8, 9, 8, 9, 8, 9, 8];
        const result = BacktestEngine.pairedTTest(model, baseline);
        
        assert.ok(result.tStatistic > 0, 'tStatistic deve ser positivo quando modelo > baseline');
        assert.ok(result.pValue < 0.05, 'p-value deve indicar significância');
        assert.ok(result.isSignificant, 'Deve ser estatisticamente significante');
    });
});

describe('BacktestEngine - Confidence Interval', () => {
    it('deve calcular IC 95% correto', () => {
        const values = [10, 10, 10, 10, 10]; // Todos iguais
        const ci = BacktestEngine.confidenceInterval95(values);
        
        assert.equal(ci.mean, 10, 'Média deve ser 10');
        assert.equal(ci.lower, 10, 'Lower deve ser 10 (sem variação)');
        assert.equal(ci.upper, 10, 'Upper deve ser 10 (sem variação)');
        assert.equal(ci.margin, 0, 'Margem deve ser 0');
    });

    it('deve ter margem positiva para dados com variação', () => {
        const values = [8, 10, 12, 9, 11, 7, 13, 10, 8, 12];
        const ci = BacktestEngine.confidenceInterval95(values);
        
        assert.ok(ci.margin > 0, 'Margem deve ser positiva');
        assert.ok(ci.lower < ci.upper, 'Lower deve ser menor que upper');
        assert.ok(ci.lower < ci.mean, 'Lower deve ser menor que a média');
        assert.ok(ci.upper > ci.mean, 'Upper deve ser maior que a média');
    });
});

describe('BacktestEngine - Walk-Forward', () => {
    it('deve retornar resultado de walk-forward', () => {
        const history = generateMockHistory(40);
        const generatorFn = (past, cfg) => {
            const analysis = StatisticalAnalyzer.analyze(past, cfg);
            return GameGenerator.generateSingleCandidate(cfg.apiName, analysis, 'adaptive', [], [], cfg);
        };

        const chronological = [...history].reverse();
        const result = BacktestEngine.evaluateWalkForward(chronological, mockConfig, generatorFn, 20);

        assert.ok(typeof result.isOverfitting === 'boolean', 'isOverfitting deve ser boolean');
    });
});

describe('BacktestEngine - emptyResult', () => {
    it('deve retornar resultado vazio quando histórico insuficiente', () => {
        const shortHistory = generateMockHistory(5);
        const generatorFn = (past, cfg) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

        const result = BacktestEngine.runBacktest(shortHistory, mockConfig, generatorFn, { windowSize: 20 });
        assert.equal(result.evaluatedDraws, 0, 'Deve ter 0 draws avaliados com histórico curto');
    });
});
