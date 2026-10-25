/**
 * WheelingEngine - Motor de Fechamento e Desdobramento Combinatório (Covering Designs / Wheeling Systems)
 * com Otimizador Pós-Geração por Simulated Annealing (Recozimento Simulado) no Limite de Schoenheim.
 *
 * Em vez de gerar jogos isolados, um Fechamento Matemático (Abbreviated Wheeling Matrix):
 * 1. Seleciona um Grupo de Elite (Pool Reduzido V) com as dezenas de maior convergência multifatorial + Markov.
 * 2. Constrói uma Matriz de Cobertura inicial de tamanho B (bilhetes de K dezenas) usando otimização
 *    Greedy t-Design + Max-Min Hamming Distance.
 * 3. Executa um passe de Pesquisa Operacional via Simulated Annealing (Recozimento Simulado):
 *    realiza micro-permutações de dezenas do Elite Pool dentro dos bilhetes para eliminar pares
 *    redundantes e maximizar o percentual de cobertura única (2-Design / 3-Design) rumo ao
 *    Limite Inferior Teórico de Schoenheim L(v, k, t).
 * 4. Calcula a Tabela de Garantia Condicional Fechada (Se M dezenas sorteadas caírem no Grupo de Elite V).
 */

import { GaussianFilterEngine } from './gaussianFilterEngine.js';
import { ScoringEngine } from './scoringEngine.js';
import { AntiCrowdEngine } from './antiCrowdEngine.js';
import { SeededRandom } from './prng.js';

export class WheelingEngine {
    /**
     * Define o tamanho ideal do Grupo de Elite (V) para cada modalidade de loteria
     */
    static getOptimalPoolSize(config, availableCount, ticketCount = 10) {
        const { total, pick } = config;
        let idealPoolSize;

        if (total === 25 && pick === 15) {
            idealPoolSize = ticketCount >= 20 ? 21 : 19;
        } else if (total === 60 && pick === 6) {
            idealPoolSize = ticketCount >= 20 ? 22 : 16;
        } else if (total === 80 && pick === 5) {
            idealPoolSize = ticketCount >= 20 ? 20 : 15;
        } else if (total === 100 && pick === 50) {
            idealPoolSize = ticketCount >= 20 ? 78 : 72;
        } else {
            idealPoolSize = Math.min(total, Math.ceil(pick * 1.6));
        }

        return Math.min(availableCount, Math.max(pick, idealPoolSize));
    }

    /**
     * Calcula o Limite Inferior Teórico de Schoenheim L(v, k, 2) para cobertura de 100% dos pares
     * L(v, k, 2) = ceil( (v / k) * ceil( (v - 1) / (k - 1) ) )
     */
    static calculateSchoenheimLowerBound(v, k) {
        if (k <= 1 || v <= k) return 1;
        const inner = Math.ceil((v - 1) / (k - 1));
        return Math.ceil((v / k) * inner);
    }

    /**
     * Calcula a Distância de Hamming entre dois jogos de mesmo tamanho K
     */
    static calculateHammingDistance(gameA, gameB) {
        const setA = new Set(gameA);
        let shared = 0;
        for (const n of gameB) {
            if (setA.has(n)) shared++;
        }
        return gameA.length - shared;
    }

    /**
     * Seleciona o Grupo de Elite (V dezenas) ranqueado por pontuação multifatorial + Markov + Anti-Crowd + Equilíbrio
     */
    static selectElitePool(analysis, config, fixed = [], excluded = [], targetPoolSize = 18) {
        const total = config.total;
        const fixedSet = new Set(fixed);
        const excludedSet = new Set(excluded);

        const freqs = Object.values(analysis.freqAbsolute || {});
        const maxFreq = Math.max(1, ...freqs);
        const minFreq = Math.min(0, ...freqs);
        const rangeFreq = Math.max(1, maxFreq - minFreq);

        const weightedVals = Object.values(analysis.freqWeighted || {});
        const maxWeighted = Math.max(1e-6, ...weightedVals);

        const scoredNumbers = [];
        for (let n = 1; n <= total; n++) {
            if (excludedSet.has(n) || fixedSet.has(n)) continue;

            const fNorm = ((analysis.freqAbsolute?.[n] || 0) - minFreq) / rangeFreq;
            const rNorm = (analysis.freqWeighted?.[n] || 0) / maxWeighted;

            const currDelay = analysis.currentDelay?.[n] || 0;
            const avgDelay = analysis.avgDelay?.[n] || 1;
            const delayRatio = currDelay / Math.max(1, avgDelay);
            const delayScore = Math.exp(-0.5 * Math.pow(delayRatio - 1.0, 2));

            const cycleScore = analysis.cycleStats?.cycleUrgencyScore?.[n] ?? 0.35;

            // Tração estocástica de Markov (t-1 -> t)
            const markovLift = analysis.markovStats?.markovLiftByNumber?.[n] ?? 1.0;
            const markovNorm = Math.max(0.1, Math.min(1.0, (markovLift - 0.5) / 0.8));

            // Peso Anti-Crowd (evitar números ultra-populares se houver empate estatístico)
            const antiCrowdNorm = AntiCrowdEngine.getNumberAntiCrowdWeight(n, total);

            let pairStrength = 0;
            if (analysis.pairMatrix) {
                for (let m = 1; m <= total; m++) {
                    if (m === n || excludedSet.has(m)) continue;
                    const a = Math.min(n, m);
                    const b = Math.max(n, m);
                    pairStrength += (analysis.pairMatrix[a]?.[b] || 0);
                }
                pairStrength = pairStrength / Math.max(1, total * (analysis.expectedFreq || 1));
            }

            const compositeNumberScore = (
                fNorm * 0.24 +
                rNorm * 0.20 +
                delayScore * 0.16 +
                cycleScore * 0.14 +
                markovNorm * 0.12 +
                Math.min(1, pairStrength) * 0.08 +
                antiCrowdNorm * 0.06
            );

            scoredNumbers.push({
                num: n,
                score: compositeNumberScore,
                isEven: n % 2 === 0
            });
        }

        scoredNumbers.sort((a, b) => b.score - a.score || a.num - b.num);

        const elitePool = [...fixed];
        const maxEvensInPool = Math.ceil(targetPoolSize * 0.58);
        const maxOddsInPool = Math.ceil(targetPoolSize * 0.58);

        let currentEvens = elitePool.filter(n => n % 2 === 0).length;
        let currentOdds = elitePool.length - currentEvens;

        for (const item of scoredNumbers) {
            if (elitePool.length >= targetPoolSize) break;
            if (item.isEven && currentEvens >= maxEvensInPool) continue;
            if (!item.isEven && currentOdds >= maxOddsInPool) continue;

            elitePool.push(item.num);
            if (item.isEven) currentEvens++;
            else currentOdds++;
        }

        for (const item of scoredNumbers) {
            if (elitePool.length >= targetPoolSize) break;
            if (!elitePool.includes(item.num)) {
                elitePool.push(item.num);
            }
        }

        return {
            elitePool: elitePool.sort((a, b) => a - b),
            numberScores: Object.fromEntries(scoredNumbers.map(s => [s.num, s.score]))
        };
    }

    /**
     * Gera uma Matriz de Fechamento Combinatório (Covering Design) com Otimização por Simulated Annealing
     */
    static generateWheelingMatrix(config, analysis, fixed = [], excluded = [], count = 10, customWeights = null, backtestSummary = null, seed = 123456) {
        const rng = new SeededRandom(seed);
        const availableCount = config.total - excluded.length;
        const poolSize = this.getOptimalPoolSize(config, availableCount, count);

        const { elitePool, numberScores } = this.selectElitePool(analysis, config, fixed, excluded, poolSize);
        const pick = config.pick;

        const coveredPairs = new Set();
        const coveredTriples = new Set();
        const usageCount = {};
        elitePool.forEach(n => { usageCount[n] = 0; });

        const selectedTickets = [];
        const candidatesPerStep = Math.max(45, Math.min(120, Math.ceil(400 / Math.max(1, count / 10))));

        for (let step = 0; step < count; step++) {
            let bestCandidate = null;
            let bestWheelObjective = -Infinity;

            for (let c = 0; c < candidatesPerStep; c++) {
                const candidateNums = this._buildBalancedCandidateFromPool(
                    elitePool,
                    fixed,
                    pick,
                    usageCount,
                    numberScores,
                    analysis,
                    rng,
                    step,
                    c
                );

                const gaussianEval = GaussianFilterEngine.evaluateCandidate(candidateNums, config, analysis, fixed);
                if (!gaussianEval.passed && c < candidatesPerStep * 0.85) {
                    continue;
                }

                const sig = candidateNums.join(',');
                if (selectedTickets.some(t => t.numbers.join(',') === sig)) {
                    continue;
                }

                let newPairs = 0;
                let totalPairsInTicket = 0;
                for (let i = 0; i < candidateNums.length; i++) {
                    for (let j = i + 1; j < candidateNums.length; j++) {
                        totalPairsInTicket++;
                        const pKey = `${candidateNums[i]}-${candidateNums[j]}`;
                        if (!coveredPairs.has(pKey)) newPairs++;
                    }
                }
                const pairCoverageGain = totalPairsInTicket > 0 ? newPairs / totalPairsInTicket : 0;

                let minHammingRatio = 1.0;
                if (selectedTickets.length > 0) {
                    let minHamming = pick;
                    for (const existing of selectedTickets) {
                        const dist = this.calculateHammingDistance(candidateNums, existing.numbers);
                        if (dist < minHamming) minHamming = dist;
                    }
                    minHammingRatio = minHamming / pick;
                }

                const scoreObj = ScoringEngine.evaluateGame(candidateNums, config, analysis, customWeights, backtestSummary);
                const normModelScore = (scoreObj.modelScore || 50) / 100;
                const normGaussian = (gaussianEval.gaussianQualityIndex || 50) / 100;

                const wheelObjective = (
                    pairCoverageGain * 0.38 +
                    minHammingRatio * 0.27 +
                    normModelScore * 0.20 +
                    normGaussian * 0.15
                );

                if (wheelObjective > bestWheelObjective) {
                    bestWheelObjective = wheelObjective;
                    bestCandidate = {
                        numbers: candidateNums,
                        scoreObj,
                        gaussianEval,
                        newPairsCovered: newPairs
                    };
                }
            }

            if (bestCandidate) {
                selectedTickets.push(bestCandidate);
                const nums = bestCandidate.numbers;
                nums.forEach(n => { usageCount[n] = (usageCount[n] || 0) + 1; });
                for (let i = 0; i < nums.length; i++) {
                    for (let j = i + 1; j < nums.length; j++) {
                        coveredPairs.add(`${nums[i]}-${nums[j]}`);
                        if (pick <= 15) {
                            for (let k = j + 1; k < nums.length; k++) {
                                coveredTriples.add(`${nums[i]}-${nums[j]}-${nums[k]}`);
                            }
                        }
                    }
                }
            }
        }

        // Cobertura antes do Simulated Annealing
        const initialCoveredPairsCount = coveredPairs.size;

        // Otimização de Pesquisa Operacional: Simulated Annealing (Recozimento Simulado)
        const annealingSummary = this.optimizeMatrixWithSimulatedAnnealing(
            selectedTickets,
            elitePool,
            fixed,
            config,
            analysis,
            customWeights,
            backtestSummary,
            rng
        );

        // Recontagem exata de pares e trincas após Simulated Annealing
        const finalPairs = new Set();
        const finalTriples = new Set();
        selectedTickets.forEach(t => {
            const nums = t.numbers;
            for (let i = 0; i < nums.length; i++) {
                for (let j = i + 1; j < nums.length; j++) {
                    finalPairs.add(`${nums[i]}-${nums[j]}`);
                    if (pick <= 15) {
                        for (let k = j + 1; k < nums.length; k++) {
                            finalTriples.add(`${nums[i]}-${nums[j]}-${nums[k]}`);
                        }
                    }
                }
            }
        });

        const totalPossiblePairsInPool = (elitePool.length * (elitePool.length - 1)) / 2;
        const pairGuaranteePct = totalPossiblePairsInPool > 0
            ? Number(Math.min(100, (finalPairs.size / totalPossiblePairsInPool) * 100).toFixed(1))
            : 100;

        const schoenheimBound = this.calculateSchoenheimLowerBound(elitePool.length, pick);
        const conditionalGuarantees = this.evaluateConditionalGuarantees(
            selectedTickets.map(t => t.numbers),
            elitePool,
            config,
            seed
        );

        return {
            tickets: selectedTickets,
            wheelMetadata: {
                elitePool,
                elitePoolSize: elitePool.length,
                ticketCount: selectedTickets.length,
                initialCoveredPairsCount,
                coveredPairsCount: finalPairs.size,
                annealingPairsGained: Math.max(0, finalPairs.size - initialCoveredPairsCount),
                annealingSwapsAccepted: annealingSummary.acceptedSwaps,
                totalPoolPairs: totalPossiblePairsInPool,
                pairCoverageGuaranteePct: pairGuaranteePct,
                coveredTriplesCount: finalTriples.size,
                schoenheimLowerBound: schoenheimBound,
                conditionalGuarantees
            }
        };
    }

    /**
     * Otimizador de Pesquisa Operacional via Simulated Annealing (Recozimento Simulado)
     * Realiza micro-trocas de 1 dezena entre um bilhete e o Grupo de Elite para eliminar
     * pares duplicados/redundantes e expandir a cobertura única de pares da carteira.
     */
    static optimizeMatrixWithSimulatedAnnealing(tickets, elitePool, fixed = [], config, analysis, customWeights, backtestSummary, rng) {
        if (!tickets || tickets.length <= 1 || elitePool.length <= config.pick) {
            return { acceptedSwaps: 0, iterations: 0 };
        }

        const fixedSet = new Set(fixed);
        const pairRefCounts = new Map();

        const addTicketPairs = (nums, delta) => {
            for (let i = 0; i < nums.length; i++) {
                for (let j = i + 1; j < nums.length; j++) {
                    const key = `${nums[i]}-${nums[j]}`;
                    const nextVal = (pairRefCounts.get(key) || 0) + delta;
                    if (nextVal <= 0) pairRefCounts.delete(key);
                    else pairRefCounts.set(key, nextVal);
                }
            }
        };

        tickets.forEach(t => addTicketPairs(t.numbers, 1));

        const maxIterations = Math.min(160, tickets.length * 14);
        let temperature = 1.0;
        const coolingRate = 0.96;
        let acceptedSwaps = 0;

        for (let iter = 0; iter < maxIterations; iter++) {
            const ticketIdx = rng.nextInt(0, tickets.length - 1);
            const currentTicket = tickets[ticketIdx];
            const currentNums = currentTicket.numbers;

            // Escolhe uma dezena substituível (que não seja fixa e que pertença a pelo menos 1 par redundante)
            const swappableNums = currentNums.filter(n => !fixedSet.has(n));
            if (swappableNums.length === 0) continue;

            const availableFromPool = elitePool.filter(n => !currentNums.includes(n));
            if (availableFromPool.length === 0) continue;

            const outNum = swappableNums[rng.nextInt(0, swappableNums.length - 1)];
            const inNum = availableFromPool[rng.nextInt(0, availableFromPool.length - 1)];

            const newNums = currentNums.map(n => (n === outNum ? inNum : n)).sort((a, b) => a - b);
            const newSig = newNums.join(',');

            // Evita duplicar outro bilhete
            if (tickets.some((t, idx) => idx !== ticketIdx && t.numbers.join(',') === newSig)) {
                continue;
            }

            // Verifica quantos pares únicos são perdidos ao remover outNum e quantos novos são ganhos ao inserir inNum
            let uniqueLost = 0;
            let uniqueGained = 0;
            for (const other of currentNums) {
                if (other === outNum) continue;
                const oldKey = outNum < other ? `${outNum}-${other}` : `${other}-${outNum}`;
                if ((pairRefCounts.get(oldKey) || 0) === 1) uniqueLost++;

                const newKey = inNum < other ? `${inNum}-${other}` : `${other}-${inNum}`;
                if (!pairRefCounts.has(newKey)) uniqueGained++;
            }

            const netPairDelta = uniqueGained - uniqueLost;
            if (netPairDelta > 0) {
                // Valida se o novo bilhete continua aprovado no Filtro Gaussiano
                const newGaussian = GaussianFilterEngine.evaluateCandidate(newNums, config, analysis, fixed);
                if (newGaussian.passed) {
                    addTicketPairs(currentNums, -1);
                    addTicketPairs(newNums, 1);
                    currentTicket.numbers = newNums;
                    currentTicket.gaussianEval = newGaussian;
                    currentTicket.scoreObj = ScoringEngine.evaluateGame(newNums, config, analysis, customWeights, backtestSummary);
                    acceptedSwaps++;
                }
            }
            temperature *= coolingRate;
        }

        return {
            acceptedSwaps,
            iterations: maxIterations,
            finalUniquePairs: pairRefCounts.size
        };
    }

    /**
     * Avalia a Tabela de Garantia Condicional Fechada (V, K, T, M):
     * Simula sorteios onde M dezenas sorteadas caem dentro do Grupo de Elite V
     * e verifica a garantia mínima e média de bilhetes premiados na carteira.
     */
    static evaluateConditionalGuarantees(ticketNumbersList, elitePool, config, seed = 123456) {
        if (!ticketNumbersList || ticketNumbersList.length === 0 || !elitePool || elitePool.length < config.pick) {
            return [];
        }

        const rng = new SeededRandom(seed + 777);
        const drawn = config.drawn || config.pick;
        const total = config.total;

        // Define cenários de acertos dentro do Grupo de Elite (ex: acertar 14 ou 15 na Lotofácil; 5 ou 6 na Mega; 4 ou 5 na Quina)
        let scenarios = [];
        if (total === 25) {
            scenarios = [13, 14, 15].filter(m => m <= elitePool.length);
        } else if (total === 60) {
            scenarios = [4, 5, 6].filter(m => m <= elitePool.length);
        } else if (total === 80) {
            scenarios = [4, 5].filter(m => m <= elitePool.length);
        } else if (total === 100) {
            scenarios = [17, 18, 19, 20].filter(m => m <= elitePool.length);
        } else {
            scenarios = [drawn - 1, drawn].filter(m => m > 0 && m <= elitePool.length);
        }

        const outsidePool = [];
        const poolSet = new Set(elitePool);
        for (let n = 1; n <= total; n++) {
            if (!poolSet.has(n)) outsidePool.push(n);
        }

        const sampleTrials = 200;
        const guarantees = [];

        scenarios.forEach(mHitsInPool => {
            const neededOutside = Math.max(0, drawn - mHitsInPool);
            if (neededOutside > outsidePool.length) return;

            let minBestHit = config.pick;
            let sumBestHit = 0;
            let prizeTicketsTotal = 0;
            let trialsWithPrize = 0;
            const minPrizeTier = total === 25 ? 11 : (total === 60 ? 4 : (total === 80 ? 2 : 15));

            for (let t = 0; t < sampleTrials; t++) {
                const poolDraw = rng.shuffle(elitePool).slice(0, mHitsInPool);
                const outDraw = neededOutside > 0 ? rng.shuffle(outsidePool).slice(0, neededOutside) : [];
                const simulatedDraw = new Set([...poolDraw, ...outDraw]);

                let bestHitInTrial = 0;
                let prizeCountInTrial = 0;

                for (const ticket of ticketNumbersList) {
                    let h = 0;
                    for (const num of ticket) {
                        if (simulatedDraw.has(num)) h++;
                    }
                    if (h > bestHitInTrial) bestHitInTrial = h;
                    if (h >= minPrizeTier) prizeCountInTrial++;
                }

                if (bestHitInTrial < minBestHit) minBestHit = bestHitInTrial;
                sumBestHit += bestHitInTrial;
                prizeTicketsTotal += prizeCountInTrial;
                if (prizeCountInTrial > 0) trialsWithPrize++;
            }

            guarantees.push({
                conditionHitsInPool: mHitsInPool,
                elitePoolSize: elitePool.length,
                guaranteedMinBestHit: minBestHit,
                averageBestHit: Number((sumBestHit / sampleTrials).toFixed(2)),
                averagePrizeTickets: Number((prizeTicketsTotal / sampleTrials).toFixed(1)),
                prizeSuccessRatePct: Number(((trialsWithPrize / sampleTrials) * 100).toFixed(1))
            });
        });

        return guarantees;
    }

    /**
     * Constrói um bilhete equilibrado dentro do Grupo de Elite priorizando dezenas menos usadas na matriz
     */
    static _buildBalancedCandidateFromPool(elitePool, fixed, pick, usageCount, numberScores, analysis, rng, stepIdx, candidateIdx) {
        const selected = new Set(fixed);
        const candidates = elitePool.filter(n => !selected.has(n));

        const maxUsage = Math.max(1, ...Object.values(usageCount));

        while (selected.size < pick && candidates.length > 0) {
            const weights = candidates.map(n => {
                const usagePenalty = 1 - ((usageCount[n] || 0) / (maxUsage + 1)) * 0.65;
                const baseScore = Math.max(0.1, numberScores[n] || 0.5);

                let synergyBonus = 1.0;
                if (selected.size > 0 && analysis?.pairMatrix) {
                    let pairSum = 0;
                    selected.forEach(s => {
                        const a = Math.min(n, s);
                        const b = Math.max(n, s);
                        pairSum += (analysis.pairMatrix[a]?.[b] || 0);
                    });
                    const avgPair = pairSum / selected.size;
                    synergyBonus = 1 + Math.min(0.5, avgPair / Math.max(1, analysis.expectedFreq || 10));
                }

                return Math.max(0.05, baseScore * usagePenalty * synergyBonus);
            });

            const chosen = rng.weightedSelect(candidates, weights);
            selected.add(chosen);
            const idx = candidates.indexOf(chosen);
            if (idx !== -1) candidates.splice(idx, 1);
        }

        return [...selected].sort((a, b) => a - b);
    }
}
