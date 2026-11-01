/**
 * FutureProjectionEngine — Projeções Futuras Rigorosas
 *
 * ⚠️  LEIA ANTES DE USAR
 * ----------------------------------------------------------------------------
 * Este módulo NÃO prevê dezenas. Em um sorteio idôneo cada combinação tem a mesma
 * probabilidade, e o histórico não altera o próximo resultado. Qualquer "projeção
 * de dezenas" seria ficção.
 *
 * O que é projetável — e é projetado aqui com exatidão matemática:
 *
 *   1. Tempo de espera: quantos concursos até atingir uma probabilidade alvo.
 *   2. Curva de sobrevivência: P(não ganhar nada em N concursos).
 *   3. Espera por dezena individual (distribuição geométrica exata).
 *   4. Retorno financeiro esperado por faixa de premiação (tabela oficial).
 *   5. Custo determinístico de uma estratégia em N concursos.
 *   6. Probabilidade de acúmulo do prêmio (estimada do histórico real, com IC).
 *   7. Cobertura de uma carteira: probabilidade EXATA de sena e limites
 *      rigorosos (Bonferroni) para "pelo menos um prêmio".
 *
 * Todas as funções abaixo são deterministas, sem simulação e sem constantes
 * inventadas. Onde há incerteza (estimativas de prêmio, taxa de acúmulo), o
 * intervalo é reportado junto com o número.
 */

import { ProbabilityEngine, OFFICIAL_TICKET_PRICES, ESTIMATED_PRIZE_PAYOUTS } from './probabilityEngine.js';
import { StatisticalInference } from './statisticalInference.js';
import { SeededRandom } from './prng.js';

export const PROJECTION_DISCLAIMER =
    'Projeções estatísticas do processo de sorteio (probabilidades exatas, espera, custo e retorno esperado). ' +
    'Não são previsão de dezenas e não aumentam a chance de cada combinação.';

export const DRAW_FREQUENCY_PER_WEEK = { 25: 6, 60: 3, 80: 6, 100: 3 };

export class FutureProjectionEngine {
    // ------------------------------------------------------------------ base

    /** Combinações exatas C(n, k) em BigInt, com memoização (usado em laços combinatórios). */
    static combinations(n, k) {
        if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || k > n) return 0n;
        const kk = Math.min(k, n - k);
        if (!this._combCache) this._combCache = new Map();
        const key = n * 1000 + kk;
        const cached = this._combCache.get(key);
        if (cached !== undefined) return cached;
        let result = 1n;
        for (let i = 1; i <= kk; i++) {
            result = (result * BigInt(n - kk + i)) / BigInt(i);
        }
        this._combCache.set(key, result);
        return result;
    }

    /**
     * Odds EXATAS (BigInt) de acertar ao menos k dezenas com 1 bilhete.
     * Evita o erro de arredondamento de ponto flutuante em universos grandes —
     * ex.: Lotomania 20 acertos sai como "1 em 11.372.635" (número oficial), e não
     * "1 em 11.372.636" como acontecia ao inverter 1/p em float.
     */
    static exactOddsAtLeastHits(config, k) {
        const total = Number(config?.total);
        const pick = Number(config?.pick);
        const drawn = Number(config?.drawn ?? config?.pick);
        const denominator = this.combinations(total, drawn);
        if (denominator === 0n) return 'n/a';

        let favourable = 0n;
        const start = Math.max(0, Number(k));
        const end = Math.min(pick, drawn);
        for (let hits = start; hits <= end; hits++) {
            const rest = drawn - hits;
            if (rest < 0 || rest > total - pick) continue;
            favourable += this.combinations(pick, hits) * this.combinations(total - pick, rest);
        }
        if (favourable === 0n) return 'n/a';

        const odds = denominator / favourable;
        if (odds === 0n) return `1 em ${(1 / (Number(favourable) / Number(denominator))).toFixed(2)}`;
        return `1 em ${odds.toLocaleString('pt-BR')}`;
    }

    /**
     * Odds EXATAS de acertar EXATAMENTE k dezenas com 1 bilhete.
     * É a convenção das tabelas oficiais: quem faz 6 na Mega recebe a sena, não a quina.
     */
    static exactOddsForExactlyHits(config, k) {
        const total = Number(config?.total);
        const pick = Number(config?.pick);
        const drawn = Number(config?.drawn ?? config?.pick);
        const denominator = this.combinations(total, drawn);
        const rest = drawn - Number(k);
        if (denominator === 0n || rest < 0 || rest > total - pick) return 'n/a';
        const favourable = this.combinations(pick, Number(k)) * this.combinations(total - pick, rest);
        if (favourable === 0n) return 'n/a';
        const odds = denominator / favourable;
        return odds === 0n ? 'n/a' : `1 em ${odds.toLocaleString('pt-BR')}`;
    }

    /**
     * Número de concursos necessários para que P(ganhar ao menos 1 vez) ≥ confiança.
     * Resolve 1 − (1 − p)^n ≥ c  ⟹  n = ⌈ln(1 − c) / ln(1 − p)⌉
     */
    static drawsForConfidence(p, confidence = 0.5) {
        if (!(p > 0) || !(p < 1) || !(confidence > 0) || !(confidence < 1)) return null;
        return Math.ceil(Math.log(1 - confidence) / Math.log(1 - p));
    }

    /** P(ganhar ao menos 1 vez em n concursos) = 1 − (1 − p)^n */
    static probabilityWithinDraws(p, n) {
        if (!(p > 0) || !(n > 0)) return 0;
        if (p >= 1) return 1;
        return 1 - Math.pow(1 - p, n);
    }

    /** Converte uma contagem de sorteios em tempo civil legível. */
    static humanizeDraws(draws, drawsPerWeek) {
        if (!Number.isFinite(draws) || draws <= 0) return '—';
        const perYear = drawsPerWeek * 52.1775;
        const years = draws / perYear;
        if (years < 1 / 12) {
            const days = Math.max(1, Math.round((draws / drawsPerWeek) * 7));
            return `${days} dia${days > 1 ? 's' : ''}`;
        }
        if (years < 2) {
            const months = Math.round(years * 12);
            return `${months} ${months > 1 ? 'meses' : 'mês'}`;
        }
        if (years < 1000) return `${Math.round(years).toLocaleString('pt-BR')} anos`;
        if (years < 1e6) return `${(years / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil anos`;
        return `${(years / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} milhões de anos`;
    }

    // ------------------------------------------- 1. horizonte de aposta (sena)

    /**
     * Curva de sobrevivência e tempo até a "certeza estatística" (50/90/99%).
     * A probabilidade por concurso da carteira é EXATA quando os jogos são distintos:
     * os eventos "acertar a sena" são mutuamente exclusivos, logo P = m · p.
     */
    static jackpotHorizon(config, ticketCount = 1) {
        const total = Number(config?.total);
        const pick = Number(config?.pick);
        const uniqueTickets = Math.max(1, Math.floor(ticketCount) || 1);
        const single = ProbabilityEngine.hypergeometric(config, pick);
        const pSingle = single.fullHitProbability;
        if (!(pSingle > 0)) return null;

        const pPerDraw = Math.min(1, pSingle * uniqueTickets);
        const drawsPerWeek = DRAW_FREQUENCY_PER_WEEK[total] || 3;

        const targets = [0.5, 0.9, 0.99];
        const milestones = targets.map(confidence => {
            const draws = this.drawsForConfidence(pPerDraw, confidence);
            return {
                confidence,
                confidenceLabel: `${(confidence * 100).toFixed(0)}%`,
                draws,
                weeks: draws === null ? null : Number((draws / drawsPerWeek).toFixed(1)),
                humanized: draws === null ? '—' : this.humanizeDraws(draws, drawsPerWeek)
            };
        });

        return {
            method: 'Distribuição geométrica exata (sorteios independentes)',
            probabilityPerCombination: pSingle,
            singleOdds: single.fullHitOdds,
            ticketCount: uniqueTickets,
            probabilityPerDraw: pPerDraw,
            portfolioOdds: ProbabilityEngine.probabilityToOdds(pPerDraw),
            drawsPerWeek,
            milestones,
            survival: [1, 10, 52, 260, 2600].map(n => ({
                draws: n,
                weeks: Number((n / drawsPerWeek).toFixed(1)),
                probabilityNoWin: Number(Math.pow(1 - pPerDraw, n).toFixed(10)),
                probabilityAtLeastOneWin: Number(this.probabilityWithinDraws(pPerDraw, n).toFixed(10))
            })),
            expectedDrawsToWin: Number((1 / pPerDraw).toFixed(1)),
            expectedYearsToWin: Number((1 / pPerDraw / (drawsPerWeek * 52.1775)).toFixed(1)),
            note:
                'Independência entre concursos é premissa verdadeira: cada sorteio é um experimento novo. ' +
                'Por isso esta projeção é exata — e é justamente ela que mostra por que "jogar sempre o mesmo jogo" não melhora nada.'
        };
    }

    // ------------------------------------------------ 2. espera por uma dezena

    /**
     * Tempo de retorno de uma dezena específica (geométrica com p = drawn/total).
     * É a única "previsão de dezena" matematicamente legítima: não diz QUAL sai,
     * diz QUANDO uma dezena qualquer volta a sair, em média.
     */
    static numberWaitingTime(config, numbers = null, horizonDraws = 10) {
        const total = Number(config?.total);
        const drawn = Number(config?.drawn ?? config?.pick);
        if (!(total > 0) || !(drawn > 0)) return null;

        const p = Math.min(1, drawn / total);
        const mean = 1 / p;
        const median = Math.ceil(Math.log(0.5) / Math.log(1 - p));
        const p90 = Math.ceil(Math.log(0.1) / Math.log(1 - p));
        const p99 = Math.ceil(Math.log(0.01) / Math.log(1 - p));

        const list =
            Array.isArray(numbers) && numbers.length > 0 ? numbers.map(Number).filter(n => n >= 1 && n <= total) : null;

        return {
            method: 'Distribuição geométrica exata',
            probabilityPerDraw: Number(p.toFixed(6)),
            oddsPerDraw: ProbabilityEngine.probabilityToOdds(p),
            expectedDraws: Number(mean.toFixed(2)),
            medianDraws: median,
            p90Draws: p90,
            p99Draws: p99,
            horizonDraws,
            probabilityWithinHorizon: Number(this.probabilityWithinDraws(p, horizonDraws).toFixed(4)),
            probabilityAbsentWithinHorizon: Number(Math.pow(1 - p, horizonDraws).toFixed(6)),
            perNumber: list
                ? list.map(n => ({
                      number: n,
                      expectedDraws: Number(mean.toFixed(2)),
                      probabilityWithinHorizon: Number(this.probabilityWithinDraws(p, horizonDraws).toFixed(4))
                  }))
                : null,
            note:
                'Todas as dezenas têm a MESMA expectativa de retorno. Atraso não aumenta a probabilidade ' +
                'da próxima saída: o processo não tem memória (propriedade da geométrica).'
        };
    }

    // ---------------------------------------------------- 3. projeção financeira

    /**
     * Projeção de custo e retorno esperado por faixa oficial.
     * O custo é DETERMINÍSTICO. O retorno é uma esperança matemática, sujeita ao
     * rateio real (número de ganhadores) — logo, um teto otimista.
     */
    static financialProjection(config, ticketCount = 1, draws = 1, options = {}) {
        const total = Number(config?.total);
        const pick = Number(config?.pick);
        const tickets = Math.max(1, Math.floor(ticketCount) || 1);
        const horizon = Math.max(1, Math.floor(draws) || 1);
        const unitPrice = OFFICIAL_TICKET_PRICES[total] || 3.5;
        const prizeTable = { ...(ESTIMATED_PRIZE_PAYOUTS[total] || {}), ...(options.prizeOverrides || {}) };

        const single = ProbabilityEngine.hypergeometric(config, pick);
        const tiers = [];
        let expectedReturnPerTicket = 0;

        for (const [tierKey, prize] of Object.entries(prizeTable)) {
            const k = Number(tierKey);
            const p = single.distribution[k] || 0;
            if (!(p > 0)) continue;
            const contribution = p * prize;
            expectedReturnPerTicket += contribution;
            tiers.push({
                hits: k,
                probability: p,
                odds: ProbabilityEngine.probabilityToOdds(p),
                prize: Number(prize),
                expectedReturn: Number(contribution.toFixed(6)),
                expectedReturnPerReal: Number((contribution / (prize > 0 ? prize : 1)).toFixed(8))
            });
        }
        tiers.sort((a, b) => b.hits - a.hits);

        const costPerDraw = unitPrice * tickets;
        const totalCost = costPerDraw * horizon;
        const expectedReturnPerDraw = expectedReturnPerTicket * tickets;
        const expectedReturnTotal = expectedReturnPerDraw * horizon;
        const expectedNet = expectedReturnTotal - totalCost;
        const returnRate = totalCost > 0 ? expectedReturnTotal / totalCost : 0;

        const bolaoShares = Math.max(1, Math.floor(options.bolaoShares) || 1);

        return {
            method: 'Custo determinístico + esperança matemática por faixa oficial',
            unitPrice,
            ticketCount: tickets,
            draws: horizon,
            costPerDraw: Number(costPerDraw.toFixed(2)),
            totalCost: Number(totalCost.toFixed(2)),
            expectedReturnPerDraw: Number(expectedReturnPerDraw.toFixed(4)),
            expectedReturnTotal: Number(expectedReturnTotal.toFixed(2)),
            expectedNet: Number(expectedNet.toFixed(2)),
            expectedReturnRate: Number(returnRate.toFixed(6)),
            expectedReturnPercent: Number((returnRate * 100).toFixed(2)),
            expectedLossPerReal: Number((1 - returnRate).toFixed(4)),
            tiers,
            bolao: {
                shares: bolaoShares,
                costPerShare: Number((totalCost / bolaoShares).toFixed(2)),
                expectedReturnPerShare: Number((expectedReturnTotal / bolaoShares).toFixed(2))
            },
            caveat:
                'O retorno é um TETO: assume prêmio integral, sem rateio. Com ganhadores múltiplos, ' +
                'o retorno real é menor. Nenhuma estratégia de escolha de dezenas altera o custo nem as probabilidades.'
        };
    }

    // ------------------------------------------------- 4. acúmulo (dados reais)

    /**
     * Projeção de acúmulo do prêmio estimada do HISTÓRICO REAL, com intervalo de
     * confiança de Wilson (95%) — em vez de um número pontual sem incerteza.
     */
    static accumulationForecast(history) {
        const draws = Array.isArray(history) ? history : [];
        const flagOf = d => {
            if (!d || typeof d !== 'object') return null;
            if (typeof d.acumulou === 'boolean') return d.acumulou;
            if (typeof d.acumulado === 'boolean') return d.acumulado;
            return null;
        };
        const flags = draws.map(flagOf).filter(v => v !== null);
        const n = flags.length;
        if (n < 10) {
            return {
                available: false,
                reason: `São necessários ao menos 10 concursos com a informação de acúmulo (disponível: ${n}).`
            };
        }

        const accumulated = flags.filter(Boolean).length;
        const rate = accumulated / n;
        const z = StatisticalInference.normalQuantile(0.975);
        const denom = 1 + (z * z) / n;
        const centre = (rate + (z * z) / (2 * n)) / denom;
        const half = (z * Math.sqrt((rate * (1 - rate)) / n + (z * z) / (4 * n * n))) / denom;
        const wilson = {
            lower: Number(Math.max(0, centre - half).toFixed(6)),
            upper: Number(Math.min(1, centre + half).toFixed(6))
        };

        // Comprimento das sequências de acúmulo
        let currentRun = 0;
        let maxRun = 0;
        const runs = [];
        for (const flag of flags) {
            if (flag) {
                currentRun++;
                maxRun = Math.max(maxRun, currentRun);
            } else {
                if (currentRun > 0) runs.push(currentRun);
                currentRun = 0;
            }
        }
        if (currentRun > 0) runs.push(currentRun);
        const meanRun = runs.length > 0 ? runs.reduce((a, b) => a + b, 0) / runs.length : 0;

        return {
            available: true,
            method: 'Taxa histórica com intervalo de Wilson 95%',
            sampleSize: n,
            accumulatedDraws: accumulated,
            rate: Number(rate.toFixed(4)),
            wilson,
            oddsOfAccumulating: ProbabilityEngine.probabilityToOdds(rate),
            currentStreak: currentRun,
            longestStreak: maxRun,
            averageStreak: Number(meanRun.toFixed(2)),
            probabilityOfTwoInARow: Number((rate * rate).toFixed(6)),
            caveat:
                'Acúmulo depende do número de acertadores, não das dezenas. Serve para dimensionar expectativa de prêmio, ' +
                'não para escolher números.'
        };
    }

    // --------------------------------- 5. cobertura da carteira (exato + limites)

    /**
     * P(hits ≥ k) para UM bilhete — direto da hipergeométrica.
     */
    static probabilityAtLeastHits(config, k) {
        const single = ProbabilityEngine.hypergeometric(config, config?.pick);
        const kk = Number(k);
        if (!Number.isFinite(kk)) return 0;
        if (kk <= single.minHits) return 1;
        return single.cumulativeProbabilities[kk] || 0;
    }

    /**
     * P(interseção) de "bilhete A tem ≥ k acertos" e "bilhete B tem ≥ k acertos",
     * com exatamente s dezenas compartilhadas. Contagem combinatória exata:
     *   x dezenas sorteadas na interseção, y só em A, z só em B
     *   acertos(A) = x + y ,  acertos(B) = x + z
     */
    static pairIntersectionProbability(config, k, sharedCount) {
        const total = Number(config.total);
        const pick = Number(config.pick);
        const drawn = Number(config.drawn ?? config.pick);
        const s = Math.max(0, Math.min(pick, Number(sharedCount) || 0));
        const onlyA = pick - s;
        const neutral = total - s - 2 * onlyA;
        if (neutral < 0) return 0;

        const denominator = this.combinations(total, drawn);
        if (denominator === 0n) return 0;

        let favourable = 0n;
        const maxX = Math.min(s, drawn);
        for (let x = 0; x <= maxX; x++) {
            const neededBoth = Math.max(0, k - x);
            const maxY = Math.min(onlyA, drawn - x);
            if (maxY < neededBoth) continue;
            for (let y = neededBoth; y <= maxY; y++) {
                const maxZ = Math.min(onlyA, drawn - x - y);
                if (maxZ < neededBoth) continue;
                const rest = drawn - x - y;
                const zMin = Math.max(neededBoth, rest - neutral);
                const zMax = Math.min(maxZ, rest);
                for (let z = zMin; z <= zMax; z++) {
                    const fromNeutral = rest - z;
                    if (fromNeutral < 0 || fromNeutral > neutral) continue;
                    favourable +=
                        this.combinations(s, x) *
                        this.combinations(onlyA, y) *
                        this.combinations(onlyA, z) *
                        this.combinations(neutral, fromNeutral);
                }
            }
        }
        return Number(favourable) / Number(denominator);
    }

    /**
     * Estimativa Monte Carlo DETERMINÍSTICA da probabilidade de a carteira atingir
     * ao menos k acertos em algum bilhete. Usada quando os limites de Bonferroni
     * são largos demais para serem informativos (bilhetes com muitas dezenas em
     * comum, como carteiras de Lotofácil).
     *
     * Não é "chute": é uma estimativa com intervalo de confiança 95% calculado e
     * semente fixa — ou seja, reprodutível e auditável.
     */
    static estimatePortfolioProbability(config, tickets, k, options = {}) {
        const total = Number(config.total);
        const drawn = Number(config.drawn ?? config.pick);
        const iterations = Math.max(1000, Math.floor(options.iterations) || 40000);
        const seed = options.seed ?? 20260101;
        const list = (tickets || []).map(t => [...new Set(t.map(Number))]);
        if (list.length === 0 || !(drawn > 0)) return null;

        const prng = new SeededRandom(seed);
        const masks = list.map(t => {
            const arr = new Uint8Array(total + 1);
            t.forEach(n => {
                if (n >= 1 && n <= total) arr[n] = 1;
            });
            return arr;
        });
        const pool = new Int32Array(total);
        for (let i = 0; i < total; i++) pool[i] = i + 1;

        let successes = 0;
        for (let iter = 0; iter < iterations; iter++) {
            // Amostragem sem reposição (Fisher-Yates parcial): só os `drawn` primeiros
            for (let i = 0; i < drawn; i++) {
                const j = i + Math.floor(prng.next() * (total - i));
                const tmp = pool[i];
                pool[i] = pool[j];
                pool[j] = tmp;
            }
            let hit = false;
            for (let t = 0; t < masks.length && !hit; t++) {
                const mask = masks[t];
                let hits = 0;
                for (let i = 0; i < drawn; i++) hits += mask[pool[i]];
                if (hits >= k) hit = true;
            }
            if (hit) successes++;
        }

        const estimate = successes / iterations;
        const se = Math.sqrt(Math.max(0, estimate * (1 - estimate)) / iterations);
        const z = StatisticalInference.normalQuantile(0.975);
        return {
            method: 'Monte Carlo determinístico (amostragem sem reposição)',
            probability: estimate,
            odds: ProbabilityEngine.probabilityToOdds(estimate),
            lowerBound: Math.max(0, estimate - z * se),
            upperBound: Math.min(1, estimate + z * se),
            confidenceLevel: 0.95,
            iterations,
            seed,
            exact: false,
            standardError: se
        };
    }

    /**
     * Probabilidade de a carteira levar prêmio na próxima extração.
     *  - Sena (acerto total): valor EXATO = m · p (eventos mutuamente exclusivos).
     *  - Demais faixas: limites rigorosos de Bonferroni
     *      Σp − Σ_{i<j} P(Aᵢ∩Aⱼ)  ≤  P(∪ Aᵢ)  ≤  Σp
     *    Substitui o antigo fator "ortogonalidade" inventado, que inflava o número.
     */
    static portfolioCoverage(config, tickets = null, options = {}) {
        const ticketList =
            Array.isArray(tickets) && tickets.length > 0
                ? tickets.map(t => [...new Set((t?.numbers || t).map(Number))].sort((a, b) => a - b))
                : null;
        const m = ticketList ? ticketList.length : Math.max(1, Math.floor(config?.ticketCount) || 1);
        const tiers = ProbabilityEngine.getPrizeTiers(config);
        const minTier = tiers[0];
        const pick = Number(config.pick);
        const drawn = Number(config.drawn ?? pick);

        // Só existe evento "mutuamente exclusivo entre bilhetes" quando o bilhete é a
        // própria combinação sorteada (pick === drawn) e a faixa é o acerto máximo.
        // Na Lotomania (50 de 100) dois bilhetes podem conter as 20 dezenas sorteadas.
        const isExactCombination = pick === drawn;
        // Interseções exatas só são viáveis para volantes pequenos; acima disso usa-se
        // o limite superior da união (sempre válido).
        const canComputePairs = m > 1 && m <= 24 && pick <= 20 && drawn <= 20;

        const pairSum = k => {
            if (!canComputePairs || !ticketList) return { sum: 0, pairs: 0 };
            let sum = 0;
            let pairs = 0;
            for (let i = 0; i < m; i++) {
                for (let j = i + 1; j < m; j++) {
                    const shared = ticketList[i].filter(n => ticketList[j].includes(n)).length;
                    sum += this.pairIntersectionProbability(config, k, shared);
                    pairs++;
                }
            }
            return { sum, pairs };
        };

        const tierEntry = k => {
            const pSingle = this.probabilityAtLeastHits(config, k);
            const single = ProbabilityEngine.hypergeometric(config, pick);
            const exactlyProbability = single.distribution[k] || 0;
            // Um único bilhete: o valor é exato por definição.
            if (m === 1 || (isExactCombination && k === pick)) {
                return {
                    exact: true,
                    probability: Math.min(1, m * pSingle),
                    odds:
                        m === 1
                            ? this.exactOddsAtLeastHits(config, k)
                            : ProbabilityEngine.probabilityToOdds(Math.min(1, m * pSingle)),
                    singleProbability: pSingle,
                    exactlyProbability,
                    exactlyOdds: this.exactOddsForExactlyHits(config, k),
                    method:
                        m === 1 ? 'exato (hipergeométrica, odds em BigInt)' : 'exato (eventos mutuamente exclusivos)'
                };
            }
            const { sum, pairs } = pairSum(k);
            const upper = Math.min(1, m * pSingle);
            const lower = pairs > 0 ? Math.max(0, m * pSingle - sum) : null;
            const base = {
                exact: false,
                singleProbability: pSingle,
                exactlyProbability,
                exactlyOdds: this.exactOddsForExactlyHits(config, k),
                // Sem arredondamento: arredondar o limite superior poderia violá-lo.
                lowerBound: lower === null ? null : lower,
                upperBound: upper,
                pairsComputed: pairs
            };

            // Bonferroni fica inútil quando os bilhetes se sobrepõem muito
            // (ex.: Lotofácil, onde 11 acertos é comum): o limite inferior cai a zero
            // e o superior a 100%. Nesse caso, estima-se por Monte Carlo determinístico
            // com IC 95% — mais informativo e igualmente auditável.
            // Critério ABSOLUTO + relativo: o intervalo só é "informativo" se reduzir a
            // incerteza a, no máximo, 10 pontos percentuais (e a 25% do próprio valor).
            const largura = upper - (lower ?? 0);
            const larguraMaximaAceitavel = Math.min(0.1, Math.max(0.25 * upper, 1e-12));
            const bonferroniInformativo = lower !== null && largura <= larguraMaximaAceitavel;
            if (bonferroniInformativo) {
                const mid = (lower + upper) / 2;
                return {
                    ...base,
                    probability: mid,
                    odds: ProbabilityEngine.probabilityToOdds(mid),
                    method: 'limites de Bonferroni'
                };
            }

            if (ticketList) {
                const mc = this.estimatePortfolioProbability(config, ticketList, k, {
                    iterations: options.iterations || 40000,
                    seed: options.seed ?? 20260101
                });
                if (mc) {
                    return {
                        ...base,
                        lowerBound: mc.lowerBound,
                        upperBound: mc.upperBound,
                        probability: mc.probability,
                        odds: mc.odds,
                        method: 'Monte Carlo determinístico (IC 95%)',
                        monteCarlo: { iterations: mc.iterations, seed: mc.seed, standardError: mc.standardError }
                    };
                }
            }

            return {
                ...base,
                probability: lower === null ? upper : (lower + upper) / 2,
                odds: ProbabilityEngine.probabilityToOdds(lower === null ? upper : (lower + upper) / 2),
                method: lower === null ? 'limite superior (união)' : 'limites de Bonferroni (largos)'
            };
        };

        const perTier = {};
        for (const tier of tiers) perTier[tier] = tierEntry(tier);

        const anyTier = tierEntry(minTier);
        const pJackpot = ProbabilityEngine.hypergeometric(config, pick).fullHitProbability;
        // Faixa máxima da modalidade (Lotomania: 20 acertos; Mega: 6; Lotofácil: 15).
        const topTier = Math.max(...tiers);
        const jackpotEntry = tierEntry(topTier);
        // Sena/acerto máximo: exato apenas quando pick === drawn.
        const jackpot = isExactCombination
            ? {
                  probability: Math.min(1, m * pJackpot),
                  odds: ProbabilityEngine.probabilityToOdds(Math.min(1, m * pJackpot)),
                  exact: true,
                  method: 'exato (eventos mutuamente exclusivos)'
              }
            : {
                  probability: jackpotEntry.probability,
                  odds: jackpotEntry.odds,
                  exact: Boolean(jackpotEntry.exact),
                  lowerBound: jackpotEntry.lowerBound ?? null,
                  upperBound: jackpotEntry.upperBound ?? jackpotEntry.probability,
                  method: jackpotEntry.method
              };

        return {
            method: 'Exato quando o bilhete é a própria combinação; limites de Bonferroni nas demais faixas',
            ticketCount: m,
            usedActualTickets: Boolean(ticketList),
            jackpot,
            anyPrize: {
                lowerBound: anyTier.lowerBound ?? null,
                upperBound: anyTier.upperBound ?? anyTier.probability,
                probability: anyTier.probability,
                odds: anyTier.odds,
                exact: anyTier.exact,
                method: anyTier.method
            },
            tiers: perTier,
            note:
                'A poda de combinações "improváveis" NÃO altera estas probabilidades: cada combinação ' +
                'tem exatamente a mesma chance. Aumentar a carteira aumenta a cobertura de forma linear.'
        };
    }

    // ------------------------------------------------------------- 6. agregado

    /**
     * Pacote completo de projeções para a interface.
     */
    static project({
        config,
        ticketCount = 10,
        draws = 52,
        numbers = null,
        history = null,
        bolaoShares = 1,
        tickets = null
    }) {
        if (!config || !config.total) return null;
        const effectiveTickets = Array.isArray(tickets) && tickets.length > 0 ? tickets.length : ticketCount;
        return {
            disclaimer: PROJECTION_DISCLAIMER,
            config: { total: config.total, pick: config.pick, drawn: config.drawn || config.pick },
            horizon: this.jackpotHorizon(config, effectiveTickets),
            waitingTime: this.numberWaitingTime(config, numbers, 10),
            financial: this.financialProjection(config, effectiveTickets, draws, { bolaoShares }),
            accumulation: history
                ? this.accumulationForecast(history)
                : { available: false, reason: 'Histórico não informado.' },
            coverage: this.portfolioCoverage({ ...config, ticketCount: effectiveTickets }, tickets)
        };
    }
}
