/**
 * Testes Automatizados para Coverage Score e Diversification Score (Fase 4)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MonteCarloEngine } from '../js/engine/monteCarloEngine.js';

const mockConfig = { total: 25, pick: 15, drawn: 15, apiName: 'lotofacil' };

describe('Coverage Score & Diversification Score Suite', () => {

    describe('MonteCarloEngine.calculateCoverageScore', () => {
        it('deve retornar 0 para portfólio vazio ou nulo', () => {
            assert.equal(MonteCarloEngine.calculateCoverageScore([], mockConfig), 0);
            assert.equal(MonteCarloEngine.calculateCoverageScore(null, mockConfig), 0);
        });

        it('deve calcular um score entre 0 e 100 para um portfólio típico', () => {
            const games = [
                { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
                { numbers: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] },
                { numbers: [1, 3, 5, 7, 9, 11, 13, 15, 17, 18, 19, 20, 21, 22, 23] },
                { numbers: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 25, 1, 3] }
            ];

            const score = MonteCarloEngine.calculateCoverageScore(games, mockConfig);
            assert.ok(score >= 0 && score <= 100, `Score deve estar entre 0 e 100, obteve ${score}`);
            assert.ok(score > 50, `Score de cobertura para 25 dezenas cobertas deve ser elevado, obteve ${score}`);
        });

        it('deve penalizar alta concentração quando os mesmos números se repetem em todos os jogos', () => {
            const identicalCoverageGames = [
                { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
                { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
                { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }
            ];

            const score = MonteCarloEngine.calculateCoverageScore(identicalCoverageGames, mockConfig);
            assert.ok(score < 70, `Score de cobertura deve ser menor para portfólio restrito (15 dezenas), obteve ${score}`);
        });
    });

    describe('MonteCarloEngine.calculateDiversificationScore', () => {
        it('deve retornar 100 para apenas 1 jogo ou array vazio', () => {
            assert.equal(MonteCarloEngine.calculateDiversificationScore([], mockConfig), 100);
            assert.equal(MonteCarloEngine.calculateDiversificationScore([{ numbers: [1, 2, 3] }], mockConfig), 100);
        });

        it('deve detectar baixa diversificação em jogos praticamente idênticos (Jaccard elevado)', () => {
            const nearDuplicateGames = [
                { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
                { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16] } // 14 dezenas iguais
            ];

            const divScore = MonteCarloEngine.calculateDiversificationScore(nearDuplicateGames, mockConfig);
            assert.ok(divScore < 30, `Diversification score deve ser baixo (< 30) para jogos quase idênticos, obteve ${divScore}`);
        });

        it('deve retornar alta diversificação para jogos com poucas dezenas em comum', () => {
            const diverseGames = [
                { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
                { numbers: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25] }
            ];

            const divScore = MonteCarloEngine.calculateDiversificationScore(diverseGames, mockConfig);
            assert.ok(divScore > 50, `Diversification score deve ser elevado (> 50) para jogos com sobreposição parcial, obteve ${divScore}`);
        });
    });
});
