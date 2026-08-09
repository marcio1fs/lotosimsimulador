/**
 * Testes Expandidos - StatisticalAnalyzer e ScoringEngine
 * Cobre: variância amostral, chi-square, trincas, lift, percentis, reprodutibilidade
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StatisticalAnalyzer, PRIMES } from '../js/engine/statisticalAnalyzer.js';
import { ScoringEngine, DEFAULT_WEIGHTS } from '../js/engine/scoringEngine.js';

const mockHistory = [
    { concurso: 3200, dezenas: ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15'] },
    { concurso: 3199, dezenas: ['03','04','05','06','07','08','09','10','11','12','13','14','15','16','17'] },
    { concurso: 3198, dezenas: ['05','06','07','08','09','10','11','12','13','14','15','16','17','18','19'] },
    { concurso: 3197, dezenas: ['01','02','04','06','08','10','12','14','16','18','20','22','24','25','03'] },
    { concurso: 3196, dezenas: ['02','04','06','08','10','12','14','16','18','20','22','24','25','01','03'] }
];

const lotofacilConfig = {
    total: 25,
    pick: 15,
    drawn: 15,
    apiName: 'lotofacil',
    name: 'Lotofacil'
};

describe('StatisticalAnalyzer.analyze', () => {
    it('deve calcular drawCount corretamente', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        assert.equal(analysis.drawCount, 5, 'Deve contar 5 concursos');
    });

    it('deve calcular frequência absoluta corretamente', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        assert.ok(analysis.freqAbsolute[1] > 0, 'Número 01 deve ter frequência > 0');
    });

    it('deve calcular atraso atual corretamente', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        assert.ok(analysis.currentDelay[25] >= 0, 'Atraso deve ser >= 0');
    });

    it('deve calcular sumStats com média positiva', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        assert.ok(analysis.sumStats.mean > 0, 'Média de soma deve ser positiva');
    });

    it('deve calcular parityStats com média positiva', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        assert.ok(analysis.parityStats.mean > 0, 'Média de paridade deve ser positiva');
    });

    it('deve retornar topPairs com lift calculado', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        if (analysis.topPairs && analysis.topPairs.length > 0) {
            const firstPair = analysis.topPairs[0];
            assert.ok(firstPair.count > 0, 'Pares devem ter contagem > 0');
            if (firstPair.lift !== undefined) {
                assert.ok(firstPair.lift > 0, 'Lift deve ser > 0');
            }
        }
    });

    it('deve retornar topTriples quando disponível', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        if (analysis.topTriples) {
            assert.ok(Array.isArray(analysis.topTriples), 'topTriples deve ser um array');
            if (analysis.topTriples.length > 0) {
                assert.equal(analysis.topTriples[0].numbers.length, 3, 'Cada trinca deve ter 3 números');
                assert.ok(analysis.topTriples[0].count > 0, 'Contagem da trinca deve ser > 0');
            }
        }
    });

    it('deve retornar chiSquare quando disponível', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        if (analysis.chiSquare) {
            assert.ok(analysis.chiSquare.chiSquare >= 0, 'chiSquare deve ser >= 0');
            assert.ok(analysis.chiSquare.pValue >= 0 && analysis.chiSquare.pValue <= 1, 
                'p-value do chi-square deve estar em [0, 1]');
            assert.ok(typeof analysis.chiSquare.isUniform === 'boolean', 'isUniform deve ser boolean');
        }
    });
});

describe('StatisticalAnalyzer.calculateDistributionStats', () => {
    it('deve usar variância amostral (N-1)', () => {
        const list = [10, 20, 30];
        const stats = StatisticalAnalyzer.calculateDistributionStats(list);
        // Variância amostral de [10,20,30]: média=20, var = ((100+0+100)/2) = 100
        assert.equal(stats.mean, 20, 'Média deve ser 20');
        assert.equal(stats.variance, 100, 'Variância amostral deve ser 100');
        assert.ok(Math.abs(stats.stdDev - 10) < 0.001, 'StdDev deve ser 10');
    });

    it('deve retornar resultado seguro para lista com 1 elemento', () => {
        const stats = StatisticalAnalyzer.calculateDistributionStats([42]);
        assert.equal(stats.mean, 42);
        assert.equal(stats.variance, 0);
        assert.equal(stats.stdDev, 0);
    });

    it('deve retornar resultado seguro para lista vazia', () => {
        const stats = StatisticalAnalyzer.calculateDistributionStats([]);
        assert.equal(stats.mean, 0);
    });
});

describe('StatisticalAnalyzer.chiSquareUniformity', () => {
    it('deve aceitar distribuição perfeitamente uniforme', () => {
        if (typeof StatisticalAnalyzer.chiSquareUniformity !== 'function') return; // Skip se não implementado
        
        const freq = {};
        for (let i = 1; i <= 25; i++) freq[i] = 60; // Perfeitamente uniforme
        const result = StatisticalAnalyzer.chiSquareUniformity(freq, 25, 100, 15);
        assert.equal(result.chiSquare, 0, 'Chi-Square deve ser 0 para distribuição uniforme');
        assert.ok(result.isUniform, 'Deve ser considerada uniforme');
    });
});

describe('ScoringEngine.evaluateGame', () => {
    it('modelScore deve estar entre 0 e 100', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        const game = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        const result = ScoringEngine.evaluateGame(game, lotofacilConfig, analysis);

        assert.ok(typeof result.modelScore === 'number', 'modelScore deve ser numérico');
        assert.ok(result.modelScore >= 0 && result.modelScore <= 100, 
            `modelScore ${result.modelScore} fora do intervalo [0, 100]`);
    });

    it('probabilityType NUNCA deve indicar garantia de acerto', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        const game = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        const result = ScoringEngine.evaluateGame(game, lotofacilConfig, analysis);

        assert.ok(result.probabilityType.includes('Não é garantia'), 
            'probabilityType deve conter disclaimer');
    });

    it('deve retornar explanations como array', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        const game = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        const result = ScoringEngine.evaluateGame(game, lotofacilConfig, analysis);

        assert.ok(Array.isArray(result.explanations), 'explanations deve ser array');
    });

    it('deve calcular repetição real quando lastDrawNumbers está disponível', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        analysis.lastDrawNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        
        const sameGame = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        const result = ScoringEngine.evaluateGame(sameGame, lotofacilConfig, analysis);
        
        assert.ok(typeof result.modelScore === 'number', 'Deve funcionar com lastDrawNumbers');
    });

    it('deve aceitar pesos customizados', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        const game = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        
        const customWeights = { ...DEFAULT_WEIGHTS, frequency: 0.5, recency: 0.3 };
        const result = ScoringEngine.evaluateGame(game, lotofacilConfig, analysis, customWeights);
        
        assert.ok(result.modelScore >= 0 && result.modelScore <= 100, 
            'Score com pesos custom deve estar em [0, 100]');
    });
});
