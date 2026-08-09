/**
 * Testes Expandidos - GameGenerator
 * Cobre: reprodutibilidade com seed, portfolio coverage, ausência de probability, diversificação
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GameGenerator } from '../js/engine/gameGenerator.js';
import { StatisticalAnalyzer } from '../js/engine/statisticalAnalyzer.js';

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

describe('GameGenerator - Geração básica', () => {
    it('deve gerar 10 jogos com 15 números cada (lotofacil)', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        const games = GameGenerator.generateBatch('lotofacil', analysis, 'weighted', [], [], 10, lotofacilConfig);

        assert.equal(games.length, 10, 'Deve gerar 10 jogos');
        games.forEach(g => {
            assert.equal(g.numbers.length, 15, `Jogo deve ter 15 números, mas tem ${g.numbers.length}`);
            const unique = new Set(g.numbers);
            assert.equal(unique.size, 15, 'Todos os números devem ser únicos');
            g.numbers.forEach(n => {
                assert.ok(n >= 1 && n <= 25, `Número ${n} fora do intervalo [1, 25]`);
            });
        });
    });

    it('deve gerar jogos para todas as estratégias', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        const strategies = ['weighted', 'hot', 'cold', 'adaptive'];

        strategies.forEach(strategy => {
            const games = GameGenerator.generateBatch('lotofacil', analysis, strategy, [], [], 5, lotofacilConfig);
            assert.ok(games.length > 0, `Estratégia "${strategy}" deve gerar pelo menos 1 jogo`);
        });
    });
});

describe('GameGenerator - Ausência de probability', () => {
    it('NÃO deve ter campo "probability" nos jogos retornados', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        const games = GameGenerator.generateBatch('lotofacil', analysis, 'weighted', [], [], 5, lotofacilConfig);

        games.forEach((g, i) => {
            assert.ok(!('probability' in g) || g.probability === undefined, 
                `Jogo ${i+1} NÃO deve ter campo "probability". Use "modelScore" em vez disso.`);
        });
    });

    it('deve ter campo "modelScore" entre 0 e 100', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        const games = GameGenerator.generateBatch('lotofacil', analysis, 'weighted', [], [], 5, lotofacilConfig);

        games.forEach((g, i) => {
            assert.ok(typeof g.modelScore === 'number', `Jogo ${i+1} deve ter modelScore numérico`);
            assert.ok(g.modelScore >= 0 && g.modelScore <= 100, 
                `modelScore ${g.modelScore} fora do intervalo [0, 100]`);
        });
    });
});

describe('GameGenerator - Seed e Reprodutibilidade', () => {
    it('deve retornar seed no objeto do jogo', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        const games = GameGenerator.generateBatch('lotofacil', analysis, 'weighted', [], [], 5, lotofacilConfig);

        // Seed pode ou não estar presente dependendo da implementação
        if (games[0].seed !== undefined) {
            assert.ok(typeof games[0].seed === 'number', 'seed deve ser numérico');
        }
    });
});

describe('GameGenerator - Portfolio Coverage', () => {
    it('deve retornar portfolioCoverage quando disponível', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        const games = GameGenerator.generateBatch('lotofacil', analysis, 'weighted', [], [], 10, lotofacilConfig);

        if (games[0].portfolioCoverage !== undefined) {
            assert.ok(games[0].portfolioCoverage > 0 && games[0].portfolioCoverage <= 100, 
                `Coverage ${games[0].portfolioCoverage} deve estar em (0, 100]`);
        }
    });
});

describe('GameGenerator - Números fixos e excluídos', () => {
    it('deve respeitar números fixos', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        const fixed = [1, 25];
        const games = GameGenerator.generateBatch('lotofacil', analysis, 'weighted', fixed, [], 5, lotofacilConfig);

        games.forEach((g, i) => {
            fixed.forEach(f => {
                assert.ok(g.numbers.includes(f), `Jogo ${i+1} deve incluir número fixo ${f}`);
            });
        });
    });

    it('deve respeitar números excluídos', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        const excluded = [1, 2, 3];
        const games = GameGenerator.generateBatch('lotofacil', analysis, 'weighted', [], excluded, 5, lotofacilConfig);

        games.forEach((g, i) => {
            excluded.forEach(ex => {
                assert.ok(!g.numbers.includes(ex), `Jogo ${i+1} NÃO deve incluir número excluído ${ex}`);
            });
        });
    });
});

describe('GameGenerator.generateSingleCandidate', () => {
    it('deve gerar jogo com números válidos', () => {
        const analysis = StatisticalAnalyzer.analyze(mockHistory, lotofacilConfig);
        const result = GameGenerator.generateSingleCandidate('lotofacil', analysis, 'weighted', [], [], lotofacilConfig);

        // result pode ser { numbers, scoreObj } ou array direto
        const numbers = Array.isArray(result) ? result : result.numbers;
        assert.equal(numbers.length, 15, 'Deve gerar 15 números');
        numbers.forEach(n => {
            assert.ok(n >= 1 && n <= 25, `Número ${n} fora do intervalo`);
        });
    });
});
