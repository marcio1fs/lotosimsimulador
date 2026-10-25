import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AntiCrowdEngine } from '../js/engine/antiCrowdEngine.js';
import { StatisticalAnalyzer } from '../js/engine/statisticalAnalyzer.js';
import { WheelingEngine } from '../js/engine/wheelingEngine.js';
import { ProbabilityEngine } from '../js/engine/probabilityEngine.js';
import { LotteryModel } from '../js/models/lottery.js';
import { LotteryAPIService } from '../js/services/lotteryApi.js';

describe('Out-of-the-Box Innovations: Anti-Crowd EV+, Markov Chains, Simulated Annealing & Financials', () => {
    it('AntiCrowdEngine penalizes human birthday/arithmetic biases and rewards above-31 organic combinations', () => {
        const megaCfg = LotteryModel.CONFIG.mega;

        // Jogo típico humano: datas de aniversário + progressão aritmética (05, 10, 15, 20, 25, 30)
        const crowdTicket = [5, 10, 15, 20, 25, 30];
        const crowdEval = AntiCrowdEngine.evaluateTicketAntiCrowd(crowdTicket, megaCfg);

        // Jogo orgânico com dezenas > 31 e espaçamentos irregulares
        const smartTicket = [8, 19, 34, 43, 51, 58];
        const smartEval = AntiCrowdEngine.evaluateTicketAntiCrowd(smartTicket, megaCfg);

        assert.ok(smartEval.antiCrowdScore > crowdEval.antiCrowdScore, 'Smart ticket should have higher Anti-Crowd score');
        assert.ok(smartEval.expectedValueMultiplier > crowdEval.expectedValueMultiplier, 'Smart ticket should have higher EV multiplier');
        assert.equal(crowdEval.hasArithmeticProgression, true);
        assert.equal(smartEval.hasArithmeticProgression, false);
    });

    it('StatisticalAnalyzer.analyzeMarkovTransitions computes 1st-order stochastic transition lifts (t-1 -> t)', () => {
        const history = LotteryAPIService.ensureMinimumHistoryDepth([], 'lotofacil', 80);
        const cfg = LotteryModel.CONFIG.lotofacil;
        const analysis = StatisticalAnalyzer.analyze(history, cfg);

        assert.ok(analysis.markovStats, 'Markov stats should be attached to analysis');
        assert.equal(Object.keys(analysis.markovStats.nextDrawProbabilities).length, 25);
        assert.ok(Array.isArray(analysis.markovStats.topTriggeredNumbers));
        assert.equal(analysis.markovStats.topTriggeredNumbers.length, 10);
        assert.ok(analysis.markovStats.topTriggeredNumbers[0].probability > 0);
    });

    it('WheelingEngine applies Simulated Annealing, computes Schoenheim lower bound and Conditional Guarantees', () => {
        const history = LotteryAPIService.ensureMinimumHistoryDepth([], 'lotofacil', 90);
        const cfg = LotteryModel.CONFIG.lotofacil;
        const analysis = StatisticalAnalyzer.analyze(history, cfg);

        const wheel = WheelingEngine.generateWheelingMatrix(cfg, analysis, [], [], 12, null, null, 42);

        assert.equal(wheel.tickets.length, 12);
        assert.ok(wheel.wheelMetadata.schoenheimLowerBound >= 1);
        assert.ok(wheel.wheelMetadata.coveredPairsCount >= wheel.wheelMetadata.initialCoveredPairsCount);
        assert.ok(Array.isArray(wheel.wheelMetadata.conditionalGuarantees));
        assert.ok(wheel.wheelMetadata.conditionalGuarantees.length > 0);

        const topScenario = wheel.wheelMetadata.conditionalGuarantees.find(g => g.conditionHitsInPool === 15);
        assert.ok(topScenario, 'Should include 15-hit conditional guarantee scenario for Lotofacil');
        assert.ok(topScenario.guaranteedMinBestHit >= 11, 'If 15 drawn numbers fall in 19-number elite pool, minimum best hit must be >= 11');
    });

    it('ProbabilityEngine calculates official Caixa financial summary, Bolão shares and Teimosinha', () => {
        const megaCfg = LotteryModel.CONFIG.mega;
        const proj = ProbabilityEngine.calculatePortfolioProjection(megaCfg, 10, 6, 85);

        assert.ok(proj.financial, 'Portfolio projection should include financial summary');
        assert.equal(proj.financial.unitPrice, 6.00);
        assert.equal(proj.financial.totalInvestment, 60.00);
        assert.equal(proj.financial.costPerShare, 12.00);
    });

    it('LotteryModel.generateSmartGames supports new anti_crowd and markov strategies end-to-end', () => {
        const history = LotteryAPIService.ensureMinimumHistoryDepth([], 'mega', 80);
        const antiCrowdGames = LotteryModel.generateSmartGames('mega', history, 'anti_crowd', [], [], 6, 80, 999);
        const markovGames = LotteryModel.generateSmartGames('mega', history, 'markov', [], [], 6, 80, 999);

        assert.equal(antiCrowdGames.length, 6);
        assert.equal(markovGames.length, 6);
        assert.ok(antiCrowdGames[0].antiCrowdScore > 0);
        assert.ok(antiCrowdGames[0].expectedValueMultiplier > 0);
    });
});
