/**
 * Testes Automatizados para Coverage Score e Diversification Score (Fase 4.1)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MonteCarloEngine } from '../js/engine/monteCarloEngine.js';

const lotofacilConfig = { total: 25, pick: 15, drawn: 15, apiName: 'lotofacil' };
const megasenaConfig = { total: 60, pick: 6, drawn: 6, apiName: 'megasena' };
const quinaConfig = { total: 80, pick: 5, drawn: 5, apiName: 'quina' };
const lotomaniaConfig = { total: 100, pick: 50, drawn: 20, apiName: 'lotomania' };

describe('Coverage Score & Diversification Score Suite (Fase 4.1)', () => {

    describe('MonteCarloEngine.calculateCoverageScore', () => {
        it('deve retornar null se a configuração da loteria for ausente ou inválida (sem fallback para 25)', () => {
            const games = [{ numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }];
            assert.equal(MonteCarloEngine.calculateCoverageScore(games, null), null);
            assert.equal(MonteCarloEngine.calculateCoverageScore(games, {}), null);
            assert.equal(MonteCarloEngine.calculateCoverageScore(games, { total: null }), null);
        });

        it('deve retornar 0 para portfólio vazio', () => {
            assert.equal(MonteCarloEngine.calculateCoverageScore([], lotofacilConfig), 0);
        });

        it('deve calcular scores distintos para universos de loterias diferentes (Lotofácil vs Mega-Sena vs Quina)', () => {
            const megaGames = [
                { numbers: [1, 10, 20, 30, 40, 50] },
                { numbers: [2, 12, 22, 32, 42, 52] }
            ];

            const megaScore = MonteCarloEngine.calculateCoverageScore(megaGames, megasenaConfig);
            const quinaScore = MonteCarloEngine.calculateCoverageScore(megaGames, quinaConfig);
            const lotofacilScore = MonteCarloEngine.calculateCoverageScore(megaGames, lotofacilConfig);

            assert.ok(megaScore !== null && megaScore >= 0 && megaScore <= 100);
            assert.ok(quinaScore !== null && quinaScore >= 0 && quinaScore <= 100);
            assert.notEqual(megaScore, quinaScore, 'Mega-Sena e Quina devem produzir coverage scores distintos para as mesmas dezenas devido ao tamanho do universo');
            assert.notEqual(megaScore, lotofacilScore, 'Mega-Sena e Lotofácil devem produzir coverage scores distintos');
        });

        it('deve penalizar alta concentração quando os mesmos números se repetem em todos os jogos', () => {
            const identicalCoverageGames = [
                { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
                { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
                { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }
            ];

            const score = MonteCarloEngine.calculateCoverageScore(identicalCoverageGames, lotofacilConfig);
            assert.ok(score < 70, `Score de cobertura deve ser menor para portfólio restrito, obteve ${score}`);
        });
    });

    describe('MonteCarloEngine.calculateDiversificationScore', () => {
        it('deve retornar 0 para 0 jogos', () => {
            assert.equal(MonteCarloEngine.calculateDiversificationScore([], lotofacilConfig), 0);
            assert.equal(MonteCarloEngine.calculateDiversificationScore(null, lotofacilConfig), 0);
        });

        it('deve retornar 100 para exatamente 1 jogo', () => {
            assert.equal(MonteCarloEngine.calculateDiversificationScore([{ numbers: [1, 2, 3] }], lotofacilConfig), 100);
        });

        it('deve retornar 0 para jogos idênticos [jogoA, jogoA]', () => {
            const identicalGames = [
                { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
                { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] }
            ];
            assert.equal(MonteCarloEngine.calculateDiversificationScore(identicalGames, lotofacilConfig), 0);
        });

        it('deve retornar baixa diversificação para jogos com apenas 1 dezena diferente', () => {
            const nearDuplicateGames = [
                { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
                { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16] } // 14 dezenas iguais
            ];

            const divScore = MonteCarloEngine.calculateDiversificationScore(nearDuplicateGames, lotofacilConfig);
            assert.ok(divScore < 30, `Diversification score deve ser baixo (< 30) para jogos quase idênticos, obteve ${divScore}`);
        });

        it('deve retornar alta diversificação para jogos com poucas dezenas em comum', () => {
            const diverseGames = [
                { numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] },
                { numbers: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25] }
            ];

            const divScore = MonteCarloEngine.calculateDiversificationScore(diverseGames, lotofacilConfig);
            assert.ok(divScore > 50, `Diversification score deve ser elevado (> 50) para jogos com sobreposição parcial, obteve ${divScore}`);
        });
    });
});
