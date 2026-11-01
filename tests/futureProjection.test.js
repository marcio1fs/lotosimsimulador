/**
 * Testes das Projeções Futuras (FutureProjectionEngine)
 *
 * Estas projeções são a única forma legítima de "prever" em loteria: elas projetam
 * o PROCESSO (espera, sobrevivência, custo, retorno, cobertura), nunca as dezenas.
 * Todos os valores são confrontados com as tabelas OFICIAIS das Loterias Caixa.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FutureProjectionEngine } from '../js/engine/futureProjectionEngine.js';
import { ProbabilityEngine } from '../js/engine/probabilityEngine.js';

const MEGA = { total: 60, pick: 6, drawn: 6, name: 'Mega-Sena' };
const LOTOFACIL = { total: 25, pick: 15, drawn: 15, name: 'Lotofácil' };
const QUINA = { total: 80, pick: 5, drawn: 5, name: 'Quina' };
const LOTOMANIA = { total: 100, pick: 50, drawn: 20, name: 'Lotomania' };

describe('Projeções — odds exatas conferem com as tabelas oficiais', () => {
    it('Mega-Sena: sena, quina e quadra', () => {
        assert.equal(FutureProjectionEngine.exactOddsForExactlyHits(MEGA, 6), '1 em 50.063.860');
        assert.equal(FutureProjectionEngine.exactOddsForExactlyHits(MEGA, 5), '1 em 154.518');
        assert.equal(FutureProjectionEngine.exactOddsForExactlyHits(MEGA, 4), '1 em 2.332');
    });

    it('Lotofácil: 15 acertos', () => {
        assert.equal(FutureProjectionEngine.exactOddsForExactlyHits(LOTOFACIL, 15), '1 em 3.268.760');
    });

    it('Quina: 5 acertos', () => {
        assert.equal(FutureProjectionEngine.exactOddsForExactlyHits(QUINA, 5), '1 em 24.040.016');
    });

    it('Lotomania: 20 acertos (BigInt, sem erro de arredondamento em float)', () => {
        assert.equal(FutureProjectionEngine.exactOddsForExactlyHits(LOTOMANIA, 20), '1 em 11.372.635');
    });

    it('"ao menos k" nunca pode ser maior que "exatamente k" em termos de probabilidade', () => {
        const pAtLeast5 = FutureProjectionEngine.probabilityAtLeastHits(MEGA, 5);
        const pExactly5 = ProbabilityEngine.hypergeometric(MEGA, 6).distribution[5];
        assert.ok(pAtLeast5 > pExactly5, 'P(≥5) deve incluir P(6)');
    });

    it('a probabilidade de "ao menos k" deve decrescer com k', () => {
        let anterior = 1;
        for (const k of [0, 2, 4, 5, 6]) {
            const p = FutureProjectionEngine.probabilityAtLeastHits(MEGA, k);
            assert.ok(p <= anterior + 1e-15, `P(≥${k}) deveria ser <= P(≥${k - 1})`);
            anterior = p;
        }
    });
});

describe('Projeções — interseção exata entre dois bilhetes', () => {
    it('dois bilhetes idênticos: a interseção da sena é a própria probabilidade da sena', () => {
        const p = FutureProjectionEngine.pairIntersectionProbability(MEGA, 6, 6);
        const pSena = ProbabilityEngine.hypergeometric(MEGA, 6).fullHitProbability;
        assert.ok(Math.abs(p - pSena) / pSena < 1e-9, `esperado ${pSena}, obteve ${p}`);
    });

    it('bilhetes sem dezenas em comum não podem acertar a sena ao mesmo tempo', () => {
        assert.equal(FutureProjectionEngine.pairIntersectionProbability(MEGA, 6, 0), 0);
    });

    it('k = 0 é evento certo para os dois bilhetes', () => {
        const p = FutureProjectionEngine.pairIntersectionProbability(MEGA, 0, 3);
        assert.ok(Math.abs(p - 1) < 1e-12);
    });

    it('a interseção deve crescer com o número de dezenas compartilhadas', () => {
        const valores = [0, 1, 2, 3, 4, 5, 6].map(s => FutureProjectionEngine.pairIntersectionProbability(MEGA, 4, s));
        for (let i = 1; i < valores.length; i++) {
            assert.ok(
                valores[i] >= valores[i - 1] - 1e-15,
                `interseção deveria ser monotônica em s (${valores[i - 1]} -> ${valores[i]})`
            );
        }
    });

    it('a interseção nunca pode exceder a probabilidade individual', () => {
        const pIndividual = FutureProjectionEngine.probabilityAtLeastHits(MEGA, 4);
        for (const s of [0, 2, 4, 6]) {
            const p = FutureProjectionEngine.pairIntersectionProbability(MEGA, 4, s);
            assert.ok(p <= pIndividual + 1e-15);
        }
    });
});

describe('Projeções — tempo até a certeza estatística', () => {
    it('espera média até o primeiro acerto deve ser exatamente 1/p', () => {
        const h = FutureProjectionEngine.jackpotHorizon(MEGA, 1);
        const p = ProbabilityEngine.hypergeometric(MEGA, 6).fullHitProbability;
        assert.ok(Math.abs(h.expectedDrawsToWin - 1 / p) / (1 / p) < 1e-9);
        assert.equal(h.probabilityPerDraw, p);
    });

    it('uma carteira de m jogos multiplica a chance por m (eventos exclusivos)', () => {
        const h1 = FutureProjectionEngine.jackpotHorizon(MEGA, 1);
        const h10 = FutureProjectionEngine.jackpotHorizon(MEGA, 10);
        assert.ok(Math.abs(h10.probabilityPerDraw - 10 * h1.probabilityPerDraw) < 1e-18);
        assert.equal(h10.portfolioOdds, '1 em 5.006.386');
    });

    it('os marcos de 50/90/99% devem ser estritamente crescentes', () => {
        const h = FutureProjectionEngine.jackpotHorizon(MEGA, 1);
        const [m50, m90, m99] = h.milestones;
        assert.ok(m50.draws < m90.draws && m90.draws < m99.draws);
        assert.ok(m50.humanized.length > 0);
    });

    it('drawsForConfidence deve ser o inverso de probabilityWithinDraws', () => {
        const p = 1 / 50063860;
        for (const c of [0.5, 0.9, 0.99]) {
            const n = FutureProjectionEngine.drawsForConfidence(p, c);
            const atingido = FutureProjectionEngine.probabilityWithinDraws(p, n);
            assert.ok(atingido >= c - 1e-12, `em n=${n} a confiança deveria ser >= ${c}, foi ${atingido}`);
            const antes = FutureProjectionEngine.probabilityWithinDraws(p, n - 1);
            assert.ok(antes < c, 'n precisa ser o MÍNIMO que atinge a confiança');
        }
    });

    it('a curva de sobrevivência deve decair e ser complementar', () => {
        const h = FutureProjectionEngine.jackpotHorizon(MEGA, 1);
        let anterior = 1;
        for (const s of h.survival) {
            assert.ok(s.probabilityNoWin <= anterior + 1e-12);
            assert.ok(Math.abs(s.probabilityNoWin + s.probabilityAtLeastOneWin - 1) < 1e-8);
            anterior = s.probabilityNoWin;
        }
    });

    it('o primeiro marco de 50% da Mega-Sena deve levar dezenas de milhões de concursos', () => {
        const h = FutureProjectionEngine.jackpotHorizon(MEGA, 1);
        assert.ok(
            h.milestones[0].draws > 30e6 && h.milestones[0].draws < 40e6,
            `esperado ~34,7 milhões, obteve ${h.milestones[0].draws}`
        );
        assert.ok(h.milestones[0].humanized.includes('mil anos'));
    });
});

describe('Projeções — espera por dezena (geométrica)', () => {
    it('a espera média de qualquer dezena é total/drawn', () => {
        const w = FutureProjectionEngine.numberWaitingTime(MEGA, null, 10);
        assert.equal(w.expectedDraws, 10); // 60/6
        assert.equal(w.oddsPerDraw, '1 em 10');
    });

    it('a CDF geométrica deve bater com o cálculo manual', () => {
        const cfg = { total: 25, pick: 15, drawn: 15 };
        const w = FutureProjectionEngine.numberWaitingTime(cfg, null, 4);
        const manual = 1 - Math.pow(1 - 15 / 25, 4);
        assert.ok(
            Math.abs(w.probabilityWithinHorizon - manual) < 1e-9,
            `esperado ${manual}, obteve ${w.probabilityWithinHorizon}`
        );
    });

    it('todas as dezenas têm a mesma espera — o atraso não altera a probabilidade', () => {
        const w = FutureProjectionEngine.numberWaitingTime(MEGA, [1, 30, 60], 5);
        const esperas = new Set(w.perNumber.map(n => n.expectedDraws));
        assert.equal(esperas.size, 1, 'nenhuma dezena pode ter expectativa diferente');
    });
});

describe('Projeções — financeiro', () => {
    it('o custo é determinístico', () => {
        const f = FutureProjectionEngine.financialProjection(MEGA, 10, 52);
        assert.equal(f.unitPrice, 6);
        assert.equal(f.costPerDraw, 60);
        assert.equal(f.totalCost, 3120);
        assert.equal(f.bolao.costPerShare, 3120);
    });

    it('o retorno esperado por faixa é p × prêmio', () => {
        const f = FutureProjectionEngine.financialProjection(MEGA, 1, 1);
        const sena = f.tiers.find(t => t.hits === 6);
        // expectedReturn é arredondado a 6 casas na serialização
        assert.ok(Math.abs(sena.expectedReturn - (1 / 50063860) * 35000000) < 1e-5);
    });

    it('a taxa de retorno deve ser menor que 100% (loteria é jogo de valor esperado negativo)', () => {
        for (const cfg of [MEGA, LOTOFACIL, QUINA, LOTOMANIA]) {
            const f = FutureProjectionEngine.financialProjection(cfg, 1, 1);
            assert.ok(
                f.expectedReturnRate > 0 && f.expectedReturnRate < 1,
                `${cfg.name}: taxa ${f.expectedReturnRate} deveria estar em (0,1)`
            );
            assert.ok(f.expectedNet < 0, `${cfg.name}: resultado esperado deve ser negativo`);
        }
    });
});

describe('Projeções — acúmulo do prêmio (dados reais)', () => {
    const history = Array.from({ length: 100 }, (_, i) => ({
        concurso: 100 - i,
        dezenas: [1, 2, 3, 4, 5, 6],
        acumulou: i % 4 === 0
    }));

    it('deve calcular a taxa e o intervalo de Wilson coerente', () => {
        const a = FutureProjectionEngine.accumulationForecast(history);
        assert.equal(a.available, true);
        assert.equal(a.sampleSize, 100);
        assert.equal(a.accumulatedDraws, 25);
        assert.equal(a.rate, 0.25);
        assert.ok(a.wilson.lower < a.rate && a.wilson.upper > a.rate, 'o IC deve conter a estimativa');
        assert.ok(a.wilson.upper - a.wilson.lower < 0.25, 'com n=100 o IC deve ser razoavelmente estreito');
    });

    it('sequências de acúmulo devem ser medidas corretamente', () => {
        const a = FutureProjectionEngine.accumulationForecast(history);
        assert.equal(a.longestStreak, 1, 'neste padrão nenhum acúmulo se repete em sequência');
    });

    it('deve recusar amostra insuficiente em vez de inventar uma taxa', () => {
        const a = FutureProjectionEngine.accumulationForecast(history.slice(0, 5));
        assert.equal(a.available, false);
        assert.ok(a.reason.includes('10'));
    });

    it('deve aceitar o campo alternativo "acumulado"', () => {
        const alt = history.map(h => ({ ...h, acumulou: undefined, acumulado: h.acumulou }));
        const a = FutureProjectionEngine.accumulationForecast(alt);
        assert.equal(a.rate, 0.25);
    });
});

describe('Projeções — cobertura da carteira', () => {
    it('um único bilhete tem probabilidade exata (sem limites)', () => {
        const c = FutureProjectionEngine.portfolioCoverage(MEGA, null);
        assert.equal(c.anyPrize.exact, true);
        assert.ok(Math.abs(c.anyPrize.probability - FutureProjectionEngine.probabilityAtLeastHits(MEGA, 4)) < 1e-12);
    });

    it('para pick === drawn, o prêmio máximo da carteira é exatamente m × p', () => {
        const tickets = [
            [1, 2, 3, 4, 5, 6],
            [7, 8, 9, 10, 11, 12],
            [13, 14, 15, 16, 17, 18]
        ];
        const c = FutureProjectionEngine.portfolioCoverage(MEGA, tickets);
        const p = ProbabilityEngine.hypergeometric(MEGA, 6).fullHitProbability;
        assert.ok(Math.abs(c.jackpot.probability - 3 * p) < 1e-20);
        assert.equal(c.jackpot.exact, true);
    });

    it('na Lotomania (pick > drawn) o prêmio máximo NÃO é evento exclusivo entre bilhetes', () => {
        const um = FutureProjectionEngine.portfolioCoverage({ ...LOTOMANIA, ticketCount: 1 }, null);
        const dois = FutureProjectionEngine.portfolioCoverage({ ...LOTOMANIA, ticketCount: 2 }, null);
        assert.equal(um.jackpot.odds, '1 em 11.372.635', 'um bilhete é exato');
        assert.equal(um.jackpot.exact, true, 'um único bilhete é sempre exato');
        assert.equal(dois.jackpot.exact, false, 'dois bilhetes de 50 dezenas podem conter as 20 sorteadas');
        // o limite superior da união dobra a cobertura, mas não é valor exato
        assert.ok(dois.jackpot.upperBound <= 2 * um.jackpot.probability + 1e-13);
    });

    it('os limites de Bonferroni devem ser válidos e conter a estimativa', () => {
        const tickets = [
            [1, 2, 3, 4, 5, 6],
            [4, 5, 6, 7, 8, 9],
            [1, 7, 13, 19, 25, 31]
        ];
        const c = FutureProjectionEngine.portfolioCoverage(MEGA, tickets);
        const faixa = c.tiers[4];
        assert.equal(faixa.exact, false);
        assert.ok(faixa.lowerBound <= faixa.probability + 1e-12);
        assert.ok(faixa.probability <= faixa.upperBound + 1e-12);
        assert.ok(faixa.lowerBound >= 0);
        assert.ok(faixa.upperBound <= 1);
    });

    it('bilhetes idênticos não devem inflar a probabilidade (interseção = 1)', () => {
        const iguais = [
            [1, 2, 3, 4, 5, 6],
            [1, 2, 3, 4, 5, 6],
            [1, 2, 3, 4, 5, 6]
        ];
        const c = FutureProjectionEngine.portfolioCoverage(MEGA, iguais);
        const p = FutureProjectionEngine.probabilityAtLeastHits(MEGA, 4);
        // com bilhetes idênticos, a união é 1 evento, não 3
        assert.ok(
            c.anyPrize.lowerBound <= p + 1e-9,
            `limite inferior (${c.anyPrize.lowerBound}) deveria voltar à probabilidade de 1 bilhete (${p})`
        );
    });
});

describe('Projeções — integridade: podar combinações NÃO melhora as odds', () => {
    it('calculatePortfolioProjection não pode alegar ganho de probabilidade pela poda', () => {
        const proj = ProbabilityEngine.calculatePortfolioProjection(MEGA, 10, 6, 85);
        assert.equal(
            proj.gaussianCorePortfolioOdds,
            proj.portfolioDirectOdds,
            'o "núcleo gaussiano" não pode ter odds melhores que a carteira direta'
        );
        assert.equal(proj.gaussianCoreOddsAreUnchanged, true);
        assert.ok(proj.spaceReduction.oddsImpact.includes('Nenhum'));
    });

    it('a probabilidade de prêmio da carteira deve respeitar o limite da união', () => {
        for (const tickets of [1, 10, 35]) {
            const proj = ProbabilityEngine.calculatePortfolioProjection(MEGA, tickets, 6, 85);
            const pAny = FutureProjectionEngine.probabilityAtLeastHits(MEGA, 4);
            const limite = Math.min(1, pAny * tickets);
            // a probabilidade é serializada com 4 casas decimais de porcentagem
            assert.ok(
                proj.anyPrizePortfolioProbability <= limite * 100 + 1e-3,
                `carteira de ${tickets}: ${proj.anyPrizePortfolioProbability}% excedeu o limite ${limite * 100}%`
            );
        }
    });

    it('o fator de redução de espaço não pode ser apresentado como ganho de acerto', () => {
        const proj = ProbabilityEngine.calculatePortfolioProjection(MEGA, 10, 6, 85);
        assert.ok(typeof proj.totalFactorGain === 'string');
        assert.ok(
            /menos combinações/.test(proj.totalFactorGain),
            'o rótulo deve falar de espaço gerado, não de probabilidade'
        );
    });
});

describe('Projeções — pacote agregado', () => {
    it('project() deve retornar todas as seções sem valores inválidos', () => {
        const history = Array.from({ length: 60 }, (_, i) => ({
            concurso: 60 - i,
            dezenas: [1, 2, 3, 4, 5, 6],
            acumulou: i % 3 === 0
        }));
        const p = FutureProjectionEngine.project({
            config: MEGA,
            ticketCount: 5,
            draws: 52,
            history
        });
        assert.ok(p.horizon && p.waitingTime && p.financial && p.accumulation && p.coverage);
        assert.ok(p.disclaimer.includes('Não são previsão de dezenas'));

        const serialized = JSON.stringify(p);
        assert.ok(!serialized.includes('NaN'), 'nenhum campo pode conter NaN');
        assert.ok(!serialized.includes('null,"probability"'), 'probabilidades não podem ser nulas');
    });

    it('deve ser determinístico (sem aleatoriedade)', () => {
        const a = JSON.stringify(FutureProjectionEngine.project({ config: MEGA, ticketCount: 4, draws: 10 }));
        const b = JSON.stringify(FutureProjectionEngine.project({ config: MEGA, ticketCount: 4, draws: 10 }));
        assert.equal(a, b);
    });
});

describe('Projeções — Monte Carlo determinístico quando Bonferroni é inútil', () => {
    function buildLotoTickets(n, seed) {
        // PRNG simples e determinístico para o teste
        let state = seed;
        const next = () => {
            state = (state * 1103515245 + 12345) & 0x7fffffff;
            return state / 0x7fffffff;
        };
        const tickets = [];
        for (let t = 0; t < n; t++) {
            const set = new Set();
            while (set.size < 15) set.add(1 + Math.floor(next() * 25));
            tickets.push([...set]);
        }
        return tickets;
    }

    it('a estimativa para 1 bilhete deve concordar com o valor analítico dentro do IC', () => {
        const tickets = buildLotoTickets(1, 42);
        const mc = FutureProjectionEngine.estimatePortfolioProbability(LOTOFACIL, tickets, 11, { iterations: 40000 });
        const analitico = FutureProjectionEngine.probabilityAtLeastHits(LOTOFACIL, 11);
        assert.ok(
            mc.lowerBound <= analitico && analitico <= mc.upperBound,
            `analítico ${analitico} deveria cair em [${mc.lowerBound}, ${mc.upperBound}]`
        );
    });

    it('deve ser reprodutível com a mesma semente', () => {
        const tickets = buildLotoTickets(6, 99);
        const a = FutureProjectionEngine.estimatePortfolioProbability(LOTOFACIL, tickets, 11, {
            iterations: 20000,
            seed: 123
        });
        const b = FutureProjectionEngine.estimatePortfolioProbability(LOTOFACIL, tickets, 11, {
            iterations: 20000,
            seed: 123
        });
        assert.equal(a.probability, b.probability);
        assert.equal(a.lowerBound, b.lowerBound);
    });

    it('aumentar a carteira deve aumentar a probabilidade estimada', () => {
        const tres = FutureProjectionEngine.estimatePortfolioProbability(LOTOFACIL, buildLotoTickets(3, 7), 11, {
            iterations: 20000
        });
        const dez = FutureProjectionEngine.estimatePortfolioProbability(LOTOFACIL, buildLotoTickets(10, 7), 11, {
            iterations: 20000
        });
        assert.ok(dez.probability > tres.probability);
    });

    it('portfolioCoverage deve usar Monte Carlo quando Bonferroni fica largo, e o IC deve ser estreito', () => {
        const tickets = buildLotoTickets(10, 2024);
        const c = FutureProjectionEngine.portfolioCoverage(LOTOFACIL, tickets);
        const faixa11 = c.tiers[11];
        assert.equal(faixa11.exact, false);
        assert.ok(faixa11.method.includes('Monte Carlo'), `método obtido: ${faixa11.method}`);
        assert.ok(faixa11.monteCarlo && faixa11.monteCarlo.iterations > 0);
        assert.ok(
            faixa11.upperBound - faixa11.lowerBound < 0.1,
            'o IC não pode ser mais largo que 10 pontos percentuais'
        );
        assert.ok(faixa11.probability > 0.5, 'com 10 jogos de Lotofácil a chance de ≥11 acertos passa de 50%');
    });

    it('nunca deve retornar probabilidade fora de [0,1]', () => {
        for (const k of [11, 12, 13, 14, 15]) {
            const c = FutureProjectionEngine.portfolioCoverage(LOTOFACIL, buildLotoTickets(8, 5));
            const t = c.tiers[k];
            assert.ok(t.probability >= 0 && t.probability <= 1);
        }
    });
});
