/**
 * Testes Automatizados para GaussianFilterEngine, WheelingEngine e Projeção Combinatória de Portfólio
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GaussianFilterEngine } from '../js/engine/gaussianFilterEngine.js';
import { WheelingEngine } from '../js/engine/wheelingEngine.js';
import { ProbabilityEngine } from '../js/engine/probabilityEngine.js';
import { StatisticalAnalyzer } from '../js/engine/statisticalAnalyzer.js';
import { LotteryModel } from '../js/models/lottery.js';
import { SeededRandom } from '../js/engine/prng.js';

function createMockHistory(config, count = 40) {
    const history = [];
    const prng = new SeededRandom(424242);
    const drawn = config.drawn || config.pick;
    for (let i = 0; i < count; i++) {
        const used = new Set();
        while (used.size < drawn) {
            used.add(prng.nextInt(1, config.total));
        }
        const dezenas = [...used].sort((a, b) => a - b).map(n => String(n).padStart(2, '0'));
        history.push({ concurso: 4000 - i, dezenas, data: '2025-01-01' });
    }
    return history;
}

describe('GaussianFilterEngine - Poda de Espaço Amostral por Curva de Gauss', () => {
    const megaConfig = LotteryModel.CONFIG.mega;
    const lotofacilConfig = LotteryModel.CONFIG.lotofacil;

    it('deve rejeitar combinações absurdas nas caudas extremas (ex: 01-02-03-04-05-06 na Mega-Sena)', () => {
        const history = createMockHistory(megaConfig, 40);
        const analysis = StatisticalAnalyzer.analyze(history, megaConfig);

        const extremeTicket = [1, 2, 3, 4, 5, 6];
        const evalRes = GaussianFilterEngine.evaluateCandidate(extremeTicket, megaConfig, analysis);

        assert.equal(evalRes.passed, false, 'Sequência 01-02-03-04-05-06 deve ser barrada pelo Filtro Gaussiano');
        assert.equal(evalRes.checks.sumOK, false, 'Soma 21 deve ser rejeitada por estar na cauda esquerda');
        assert.equal(evalRes.checks.sequenceOK, false, 'Corrida de 6 consecutivos deve ser rejeitada');
    });

    it('deve aprovar combinações bem distribuídas no centro da Curva de Gauss', () => {
        const history = createMockHistory(megaConfig, 40);
        const analysis = StatisticalAnalyzer.analyze(history, megaConfig);

        // Jogo equilibrado: 3 pares, 3 ímpares, soma 183, 4 linhas diferentes, sem trinca consecutiva
        const balancedTicket = [5, 18, 27, 34, 43, 56];
        const evalRes = GaussianFilterEngine.evaluateCandidate(balancedTicket, megaConfig, analysis);

        assert.equal(evalRes.passed, true, 'Combinação central equilibrada deve ser aprovada');
        assert.ok(evalRes.gaussianQualityIndex >= 80, `Quality Index deve ser alto (>=80), obteve ${evalRes.gaussianQualityIndex}`);
    });

    it('deve rejeitar jogos idênticos a sorteios já ocorridos no histórico', () => {
        const history = createMockHistory(lotofacilConfig, 20);
        const analysis = StatisticalAnalyzer.analyze(history, lotofacilConfig);
        const alreadyDrawn = history[0].dezenas.map(Number);

        const evalRes = GaussianFilterEngine.evaluateCandidate(alreadyDrawn, lotofacilConfig, analysis);
        assert.equal(evalRes.checks.notAlreadyDrawn, false, 'Deve identificar que a combinação já saiu no histórico');
        assert.equal(evalRes.passed, false, 'Não deve aprovar repetição integral de sorteio passado');
    });
});

describe('WheelingEngine - Matriz de Fechamento e Desdobramento Combinatório', () => {
    it('deve gerar matriz de fechamento com alta cobertura de pares e distância de Hamming', () => {
        const config = LotteryModel.CONFIG.lotofacil;
        const history = createMockHistory(config, 40);
        const analysis = StatisticalAnalyzer.analyze(history, config);

        const wheel = WheelingEngine.generateWheelingMatrix(config, analysis, [], [], 10, null, null, 123456);

        assert.equal(wheel.tickets.length, 10, 'Deve gerar exatamente 10 bilhetes na matriz');
        assert.ok(wheel.wheelMetadata.elitePoolSize >= 18, 'Grupo de elite para Lotofácil deve ter ao menos 18 dezenas');
        assert.ok(wheel.wheelMetadata.pairCoverageGuaranteePct > 75, `Cobertura de pares no grupo de elite deve ser > 75%, obteve ${wheel.wheelMetadata.pairCoverageGuaranteePct}%`);

        // Verifica que todos os bilhetes são distintos
        const signatures = new Set(wheel.tickets.map(t => t.numbers.join(',')));
        assert.equal(signatures.size, 10, 'Todos os 10 bilhetes da matriz devem ser únicos');
    });
});

describe('ProbabilityEngine.calculatePortfolioProjection - Projeção de Carteira e Redução de Odds', () => {
    it('deve melhorar as odds proporcionalmente ao tamanho da carteira e à redução do espaço amostral', () => {
        const megaConfig = LotteryModel.CONFIG.mega;
        const proj10 = ProbabilityEngine.calculatePortfolioProjection(megaConfig, 10, 6, 85);
        const proj35 = ProbabilityEngine.calculatePortfolioProjection(megaConfig, 35, 6, 85);

        assert.equal(proj10.rawSingleOdds, '1 em 50.063.860');
        assert.equal(proj10.portfolioDirectOdds, '1 em 5.006.386');
        assert.ok(proj35.anyPrizePortfolioProbability > proj10.anyPrizePortfolioProbability,
            'Carteira de 35 jogos deve ter maior probabilidade acumulada de premiação que 10 jogos');
    });
});
