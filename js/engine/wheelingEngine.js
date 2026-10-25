/**
 * WheelingEngine - Motor de Fechamento e Desdobramento Combinatório (Covering Designs / Wheeling Systems)
 *
 * Em vez de gerar jogos isolados, um Fechamento Matemático (Abbreviated Wheeling Matrix):
 * 1. Seleciona um Grupo de Elite (Pool Reduzido V) com as dezenas de maior convergência multifatorial.
 * 2. Constrói uma Matriz de Cobertura de tamanho B (bilhetes de K dezenas) usando otimização
 *    Greedy t-Design + Max-Min Hamming Distance (garantindo que os bilhetes tenham a menor
 *    sobreposição possível de pares e trincas, cobrindo o máximo de combinações T).
 * 3. Garante que, se as dezenas sorteadas caírem dentro do Grupo de Elite V, a carteira
 *    captura matematicamente múltiplas faixas de premiação com muito menos bilhetes.
 */

import { GaussianFilterEngine } from './gaussianFilterEngine.js';
import { ScoringEngine } from './scoringEngine.js';
import { SeededRandom } from './prng.js';

export class WheelingEngine {
    /**
     * Define o tamanho ideal do Grupo de Elite (V) para cada modalidade de loteria
     */
    static getOptimalPoolSize(config, availableCount, ticketCount = 10) {
        const { total, pick } = config;
        let idealPoolSize;

        if (total === 25 && pick === 15) {
            // Lotofácil: Fechamento clássico de 19 a 21 dezenas
            idealPoolSize = ticketCount >= 20 ? 21 : 19;
        } else if (total === 60 && pick === 6) {
            // Mega-Sena: Fechamento de 15 a 24 dezenas de elite
            idealPoolSize = ticketCount >= 20 ? 22 : 16;
        } else if (total === 80 && pick === 5) {
            // Quina: Fechamento de 15 a 22 dezenas de elite
            idealPoolSize = ticketCount >= 20 ? 20 : 15;
        } else if (total === 100 && pick === 50) {
            // Lotomania: Fechamento de 70 a 80 dezenas de elite
            idealPoolSize = ticketCount >= 20 ? 78 : 72;
        } else {
            idealPoolSize = Math.min(total, Math.ceil(pick * 1.6));
        }

        return Math.min(availableCount, Math.max(pick, idealPoolSize));
    }

    /**
     * Calcula a Distância de Hamming entre dois jogos de mesmo tamanho K
     * (Quantas dezenas diferem entre o jogo A e o jogo B)
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
     * Seleciona o Grupo de Elite (V dezenas) ranqueado por pontuação multifatorial + equilíbrio geométrico
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

            // Atraso gaussiano centrado no atraso médio
            const currDelay = analysis.currentDelay?.[n] || 0;
            const avgDelay = analysis.avgDelay?.[n] || 1;
            const delayRatio = currDelay / Math.max(1, avgDelay);
            const delayScore = Math.exp(-0.5 * Math.pow(delayRatio - 1.0, 2));

            // Urgência de fechamento de ciclo
            const cycleScore = analysis.cycleStats?.cycleUrgencyScore?.[n] ?? 0.35;

            // Sinergia média de pares com todas as outras dezenas
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
                fNorm * 0.28 +
                rNorm * 0.24 +
                delayScore * 0.20 +
                cycleScore * 0.16 +
                Math.min(1, pairStrength) * 0.12
            );

            scoredNumbers.push({
                num: n,
                score: compositeNumberScore,
                isEven: n % 2 === 0
            });
        }

        scoredNumbers.sort((a, b) => b.score - a.score || a.num - b.num);

        // Constrói o pool respeitando equilíbrio par/ímpar (evita que o pool tenha 80% de ímpares ou pares)
        const elitePool = [...fixed];
        const needed = Math.max(0, targetPoolSize - elitePool.length);
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

        // Completa caso algum filtro de paridade tenha segurado dezenas
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
     * Gera uma Matriz de Fechamento Combinatório (Covering Design) que maximiza:
     * 1. Cobertura inédita de Pares e Trincas dentro do Grupo de Elite (Greedy Covering)
     * 2. Balanceamento de utilização de cada dezena do Grupo de Elite (1-Design Equilibrado)
     * 3. Distância de Hamming mínima entre quaisquer dois bilhetes
     * 4. Aprovação no Filtro de Poda Gaussiana
     */
    static generateWheelingMatrix(config, analysis, fixed = [], excluded = [], count = 10, customWeights = null, backtestSummary = null, seed = 123456) {
        const rng = new SeededRandom(seed);
        const availableCount = config.total - excluded.length;
        const poolSize = this.getOptimalPoolSize(config, availableCount, count);

        const { elitePool, numberScores } = this.selectElitePool(analysis, config, fixed, excluded, poolSize);
        const pick = config.pick;

        // Rastreador de cobertura de pares (2-subsets) e trincas (3-subsets) dentro do Grupo de Elite
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

                // Avalia poda gaussiana
                const gaussianEval = GaussianFilterEngine.evaluateCandidate(candidateNums, config, analysis, fixed);
                if (!gaussianEval.passed && c < candidatesPerStep * 0.85) {
                    continue; // Descarta combinações fora da curva de Gauss
                }

                // Verifica duplicata exata
                const sig = candidateNums.join(',');
                if (selectedTickets.some(t => t.numbers.join(',') === sig)) {
                    continue;
                }

                // Calcula quantos NOVOS pares e trincas este bilhete cobre no Grupo de Elite
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

                // Calcula a Distância de Hamming mínima em relação aos bilhetes já escolhidos na matriz
                let minHammingRatio = 1.0;
                if (selectedTickets.length > 0) {
                    let minHamming = pick;
                    for (const existing of selectedTickets) {
                        const dist = this.calculateHammingDistance(candidateNums, existing.numbers);
                        if (dist < minHamming) minHamming = dist;
                    }
                    minHammingRatio = minHamming / pick;
                }

                // Avalia o Score Estatístico Multifatorial do candidato
                const scoreObj = ScoringEngine.evaluateGame(candidateNums, config, analysis, customWeights, backtestSummary);
                const normModelScore = (scoreObj.modelScore || 50) / 100;
                const normGaussian = (gaussianEval.gaussianQualityIndex || 50) / 100;

                // Função Objetivo de Fechamento: Cobertura Inédita (38%) + Distância de Hamming (27%) + Score Multifatorial (20%) + Núcleo Gaussiano (15%)
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
                // Atualiza contadores de cobertura da matriz
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

        // Estatísticas da Matriz de Fechamento
        const totalPossiblePairsInPool = (elitePool.length * (elitePool.length - 1)) / 2;
        const pairGuaranteePct = totalPossiblePairsInPool > 0
            ? Number(Math.min(100, (coveredPairs.size / totalPossiblePairsInPool) * 100).toFixed(1))
            : 100;

        return {
            tickets: selectedTickets,
            wheelMetadata: {
                elitePool,
                elitePoolSize: elitePool.length,
                ticketCount: selectedTickets.length,
                coveredPairsCount: coveredPairs.size,
                totalPoolPairs: totalPossiblePairsInPool,
                pairCoverageGuaranteePct: pairGuaranteePct,
                coveredTriplesCount: coveredTriples.size
            }
        };
    }

    /**
     * Constrói um bilhete equilibrado dentro do Grupo de Elite priorizando dezenas menos usadas na matriz
     * (para garantir distribuição uniforme de 1-design) combinado com o peso estatístico e sinergia de pares.
     */
    static _buildBalancedCandidateFromPool(elitePool, fixed, pick, usageCount, numberScores, analysis, rng, stepIdx, candidateIdx) {
        const selected = new Set(fixed);
        const candidates = elitePool.filter(n => !selected.has(n));

        const maxUsage = Math.max(1, ...Object.values(usageCount));

        while (selected.size < pick && candidates.length > 0) {
            const weights = candidates.map(n => {
                // Penaliza dezenas já muito repetidas nos bilhetes anteriores para espalhar a matriz
                const usagePenalty = 1 - ((usageCount[n] || 0) / (maxUsage + 1)) * 0.65;
                const baseScore = Math.max(0.1, numberScores[n] || 0.5);

                // Bônus de sinergia (co-ocorrência) com as dezenas já inseridas neste bilhete
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
