/**
 * StatisticalAnalyzer - Motor Avançado de Análise Estatística para Loterias
 * Analisa séries temporais, distribuições empíricas, atrasos, repetições, co-ocorrência,
 * ciclo das dezenas, geometria matricial (linhas/colunas/moldura/miolo), Fibonacci,
 * Cadeias de Markov de 1ª Ordem (Transição Temporal t-1 -> t) e padrões combinatórios.
 */

import { StatisticalInference } from './statisticalInference.js';

export const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
export const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

export class StatisticalAnalyzer {
    /**
     * Retorna dimensões da matriz do volante oficial para cada modalidade
     */
    static getGridDimensions(total) {
        if (total === 25) return { rows: 5, cols: 5 };
        if (total === 60) return { rows: 6, cols: 10 };
        if (total === 80) return { rows: 8, cols: 10 };
        if (total === 100) return { rows: 10, cols: 10 };
        const cols = Math.ceil(Math.sqrt(total));
        const rows = Math.ceil(total / cols);
        return { rows, cols };
    }

    /**
     * Verifica se uma dezena pertence à Moldura (borda externa) do volante
     */
    static isFrameNumber(num, total) {
        const { rows, cols } = this.getGridDimensions(total);
        const zeroIdx = num - 1;
        const r = Math.floor(zeroIdx / cols);
        const c = zeroIdx % cols;
        return r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
    }

    /**
     * Calcula estatísticas geométricas de um conjunto de dezenas (linhas, colunas, moldura, fibonacci, primos)
     */
    static analyzeTicketGeometry(numbers, total) {
        const { rows, cols } = this.getGridDimensions(total);
        const rowCounts = new Array(rows).fill(0);
        const colCounts = new Array(cols).fill(0);
        let frameCount = 0;
        let fibonacciCount = 0;
        let primeCount = 0;

        numbers.forEach(n => {
            if (n >= 1 && n <= total) {
                const zeroIdx = n - 1;
                const r = Math.min(rows - 1, Math.floor(zeroIdx / cols));
                const c = zeroIdx % cols;
                rowCounts[r]++;
                colCounts[c]++;
                if (this.isFrameNumber(n, total)) frameCount++;
                if (FIBONACCI.includes(n)) fibonacciCount++;
                if (PRIMES.includes(n)) primeCount++;
            }
        });

        const activeRows = rowCounts.filter(c => c > 0).length;
        const activeCols = colCounts.filter(c => c > 0).length;
        const maxInSingleRow = Math.max(0, ...rowCounts);
        const maxInSingleCol = Math.max(0, ...colCounts);

        return {
            rows,
            cols,
            rowCounts,
            colCounts,
            activeRows,
            activeCols,
            maxInSingleRow,
            maxInSingleCol,
            frameCount,
            coreCount: numbers.length - frameCount,
            fibonacciCount,
            primeCount
        };
    }

    /**
     * Constrói uma Matriz de Transição Estocástica de Cadeia de Markov de 1ª Ordem (t-1 -> t)
     * Mede P(X_t = j | X_{t-1} = i): quando a dezena `i` sai em um sorteio, qual a probabilidade
     * empírica de a dezena `j` ser "puxada" no sorteio imediatamente seguinte?
     * Aplica suavização Bayesiana de Laplace-Dirichlet para evitar probabilidades zero em amostras curtas.
     */
    static analyzeMarkovTransitions(history, total, drawn) {
        const nextDrawGivenPrev = {};
        const prevOccurrences = {};

        for (let i = 1; i <= total; i++) {
            prevOccurrences[i] = 0;
            nextDrawGivenPrev[i] = {};
            for (let j = 1; j <= total; j++) {
                nextDrawGivenPrev[i][j] = 0;
            }
        }

        if (!history || history.length < 2) {
            const uniformProb = drawn / Math.max(1, total);
            const nextDrawProbabilities = {};
            for (let j = 1; j <= total; j++) nextDrawProbabilities[j] = Number(uniformProb.toFixed(4));
            return {
                nextDrawProbabilities,
                topTriggeredNumbers: [],
                topTransitions: [],
                markovLiftByNumber: nextDrawProbabilities
            };
        }

        // history[0] é o mais recente, history[idx + 1] é o concurso imediatamente anterior (t-1)
        for (let idx = 0; idx < history.length - 1; idx++) {
            const currentDraw = Array.isArray(history[idx]?.dezenas) ? history[idx].dezenas.map(Number) : [];
            const prevDraw = Array.isArray(history[idx + 1]?.dezenas) ? history[idx + 1].dezenas.map(Number) : [];

            prevDraw.forEach(prevNum => {
                if (prevNum >= 1 && prevNum <= total) {
                    prevOccurrences[prevNum]++;
                    currentDraw.forEach(currNum => {
                        if (currNum >= 1 && currNum <= total) {
                            nextDrawGivenPrev[prevNum][currNum]++;
                        }
                    });
                }
            });
        }

        // Condiciona ao ÚLTIMO sorteio real (history[0]) para projetar o próximo concurso (t+1)
        const lastDraw = Array.isArray(history[0]?.dezenas) ? history[0].dezenas.map(Number) : [];
        const baselineProb = drawn / Math.max(1, total);
        const nextDrawProbabilities = {};
        const markovLiftByNumber = {};
        const transitionCandidates = [];
        let testedTransitionPairs = 0;

        // Suavização Dirichlet-Laplace (prior alpha = 1)
        const priorAlpha = 1.0;

        for (let j = 1; j <= total; j++) {
            if (lastDraw.length === 0) {
                nextDrawProbabilities[j] = Number(baselineProb.toFixed(4));
                markovLiftByNumber[j] = 1.0;
                continue;
            }

            let conditionalProbSum = 0;
            let validTriggers = 0;

            lastDraw.forEach(prevNum => {
                if (prevNum >= 1 && prevNum <= total) {
                    const countPrev = prevOccurrences[prevNum] || 0;
                    const transCount = nextDrawGivenPrev[prevNum]?.[j] || 0;
                    const smoothedProb = (transCount + priorAlpha * baselineProb) / (countPrev + priorAlpha);
                    conditionalProbSum += smoothedProb;
                    validTriggers++;

                    if (countPrev >= 5) testedTransitionPairs++;
                    if (countPrev >= 5 && transCount >= 3) {
                        const lift = smoothedProb / Math.max(1e-6, baselineProb);
                        if (lift > 1.15) {
                            // Teste binomial EXATO: sob H0 (sorteio justo e independente),
                            // transCount ~ Binomial(countPrev, drawn/total). Sem este teste,
                            // "lift > 1.15" é apenas ruído amostral elevado ao status de padrão.
                            transitionCandidates.push({
                                from: prevNum,
                                to: j,
                                count: transCount,
                                trials: countPrev,
                                expectedCount: Number((countPrev * baselineProb).toFixed(3)),
                                probability: Number(smoothedProb.toFixed(4)),
                                lift: Number(lift.toFixed(3)),
                                rawPValue: StatisticalInference.binomialUpperTail(transCount, countPrev, baselineProb)
                            });
                        }
                    }
                }
            });

            const avgCondProb = validTriggers > 0 ? conditionalProbSum / validTriggers : baselineProb;
            nextDrawProbabilities[j] = Number(avgCondProb.toFixed(4));
            markovLiftByNumber[j] = Number((avgCondProb / Math.max(1e-6, baselineProb)).toFixed(4));
        }

        // Correção de Benjamini-Hochberg (FDR 5%) sobre todas as transições testadas.
        const fdr = StatisticalInference.benjaminiHochberg(
            transitionCandidates.map(c => c.rawPValue), 0.05, testedTransitionPairs);
        transitionCandidates.forEach((c, i) => {
            c.pValue = Number(Math.max(1e-16, Math.min(1, c.rawPValue)).toFixed(10));
            c.qValue = fdr.qValues[i];
            c.significant = fdr.rejected[i] === true;
            delete c.rawPValue;
        });

        // Ordena primeiro por significância estatística, depois por lift.
        transitionCandidates.sort((a, b) => {
            if (a.significant !== b.significant) return a.significant ? -1 : 1;
            return b.lift - a.lift || b.count - a.count;
        });
        const topTransitions = transitionCandidates.slice(0, 15);
        const significantTransitions = transitionCandidates.filter(c => c.significant).length;

        const topTriggeredNumbers = Object.entries(nextDrawProbabilities)
            .map(([num, prob]) => ({
                num: Number(num),
                probability: prob,
                lift: markovLiftByNumber[num]
            }))
            .sort((a, b) => b.probability - a.probability || a.num - b.num)
            .slice(0, 10);

        return {
            nextDrawProbabilities,
            markovLiftByNumber,
            topTriggeredNumbers,
            topTransitions,
            significantTransitions,
            testedTransitions: testedTransitionPairs,
            reportedTransitions: transitionCandidates.length,
            fdrThreshold: fdr.threshold,
            method: 'Teste binomial exato + Benjamini-Hochberg (FDR 5%)',
            // Aviso embutido no dado: com histórico curto, NENHUMA transição sobrevive
            // ao controle de FDR — o que significa que não há sinal de Markov detectável.
            hasStatisticallySignificantSignal: significantTransitions > 0
        };
    }

    /**
     * Analisa os Ciclos das Dezenas (quantos sorteios leva para todas as dezenas do universo saírem ao menos 1 vez)
     * e identifica quais dezenas faltam sair para fechar o ciclo atual.
     */
    static analyzeCycles(history, total) {
        if (!history || history.length === 0) {
            return {
                completedCycles: 0,
                avgCycleLength: 0,
                currentCycleLength: 0,
                missingInCurrentCycle: [],
                seenInCurrentCycle: [],
                cycleUrgencyScore: {}
            };
        }

        const chronological = [...history].reverse();
        const cycleLengths = [];
        let seenSet = new Set();
        let currentStartIdx = 0;

        chronological.forEach((draw, idx) => {
            const nums = Array.isArray(draw.dezenas) ? draw.dezenas.map(Number) : [];
            nums.forEach(n => {
                if (n >= 1 && n <= total) seenSet.add(n);
            });

            if (seenSet.size === total) {
                cycleLengths.push(idx - currentStartIdx + 1);
                seenSet = new Set();
                currentStartIdx = idx + 1;
            }
        });

        const currentCycleLength = chronological.length - currentStartIdx;
        const missingInCurrentCycle = [];
        const seenInCurrentCycle = [];

        for (let n = 1; n <= total; n++) {
            if (seenSet.has(n)) {
                seenInCurrentCycle.push(n);
            } else {
                missingInCurrentCycle.push(n);
            }
        }

        const avgCycleLength = cycleLengths.length > 0
            ? Number((cycleLengths.reduce((a, b) => a + b, 0) / cycleLengths.length).toFixed(2))
            : Math.ceil(total / 5);

        const cycleProgress = avgCycleLength > 0 ? Math.min(1.5, currentCycleLength / avgCycleLength) : 0.5;
        const cycleUrgencyScore = {};
        for (let n = 1; n <= total; n++) {
            if (!seenSet.has(n)) {
                const scarcityFactor = 1 - (missingInCurrentCycle.length / total);
                cycleUrgencyScore[n] = Number(Math.min(1, 0.55 + 0.45 * Math.max(cycleProgress / 1.5, scarcityFactor)).toFixed(4));
            } else {
                cycleUrgencyScore[n] = 0.25;
            }
        }

        return {
            completedCycles: cycleLengths.length,
            avgCycleLength,
            currentCycleLength,
            missingInCurrentCycle,
            seenInCurrentCycle,
            cycleUrgencyScore
        };
    }

    /**
     * Filtra o histórico para a janela temporal desejada
     */
    static getWindow(history, windowSize = 'full') {
        if (!history || !Array.isArray(history) || history.length === 0) return [];
        if (windowSize === 'full' || typeof windowSize !== 'number') return history;
        return history.slice(0, windowSize);
    }

    /**
     * Análise leve O(draws * drawn) para uso interno em loops de Backtest / Walk-Forward.
     * Calcula exatamente os campos consumidos por GameGenerator.generateSingleCandidate
     * (freqAbsolute, freqWeighted, currentDelay, avgDelay, expectedFreq, lastDrawNumbers,
     * pairMatrix, cycleStats e markovStats), pulando topTriples/topPairs/chiSquare.
     */
    static analyzeFast(history, config) {
        const total = config.total;
        const drawCount = history.length;
        const drawn = config.drawn || config.pick;

        const freqAbsolute = {};
        const lastSeenIndex = {};
        const mostRecentIndex = {};
        const delaySum = new Float64Array(total + 1);
        const delayCount = new Int32Array(total + 1);
        const weightedAcc = new Float64Array(total + 1);
        const pairMatrix = {};

        for (let i = 1; i <= total; i++) {
            freqAbsolute[i] = 0;
            lastSeenIndex[i] = -1;
            mostRecentIndex[i] = -1;
            pairMatrix[i] = {};
            for (let j = i + 1; j <= total; j++) {
                pairMatrix[i][j] = 0;
            }
        }

        const alpha = 0.05;
        let wTotal = 0;

        for (let idx = 0; idx < drawCount; idx++) {
            const draw = history[idx];
            const weight = Math.exp(-alpha * idx);
            wTotal += weight;

            const rawNumbers = Array.isArray(draw.dezenas) ? draw.dezenas.map(Number) : [];
            const numbers = [...new Set(rawNumbers)].sort((a, b) => a - b);

            for (let k = 0; k < numbers.length; k++) {
                const n = numbers[k];
                if (n >= 1 && n <= total) {
                    freqAbsolute[n]++;
                    weightedAcc[n] += weight;
                    if (lastSeenIndex[n] === -1) mostRecentIndex[n] = idx;
                    if (lastSeenIndex[n] !== -1) {
                        delaySum[n] += (idx - lastSeenIndex[n]);
                        delayCount[n]++;
                    }
                    lastSeenIndex[n] = idx;
                }
            }

            for (let i = 0; i < numbers.length; i++) {
                const a = numbers[i];
                if (a < 1 || a > total) continue;
                const row = pairMatrix[a];
                for (let j = i + 1; j < numbers.length; j++) {
                    const b = numbers[j];
                    if (b >= 1 && b <= total && row[b] !== undefined) {
                        row[b]++;
                    }
                }
            }
        }

        const expectedFreq = drawCount * drawn / total;
        const freqRelative = {};
        const freqWeighted = {};
        const expectedDeviation = {};
        const currentDelay = {};
        const avgDelay = {};

        for (let i = 1; i <= total; i++) {
            const f = freqAbsolute[i];
            freqRelative[i] = drawCount > 0 ? f / drawCount : 0;
            expectedDeviation[i] = expectedFreq > 0 ? (f - expectedFreq) / expectedFreq : 0;
            freqWeighted[i] = wTotal > 0 ? weightedAcc[i] / wTotal : 0;
            const cd = mostRecentIndex[i] === -1 ? drawCount : mostRecentIndex[i];
            currentDelay[i] = cd;
            avgDelay[i] = delayCount[i] > 0 ? delaySum[i] / delayCount[i] : cd;
        }

        return {
            drawCount,
            lastDrawNumbers: Array.isArray(history[0]?.dezenas) ? history[0].dezenas.map(Number) : [],
            freqAbsolute,
            freqRelative,
            freqWeighted,
            expectedFreq,
            expectedDeviation,
            currentDelay,
            avgDelay,
            pairMatrix,
            cycleStats: this.analyzeCycles(history, total),
            markovStats: this.analyzeMarkovTransitions(history, total, drawn)
        };
    }

    /**
     * Executa análise estatística completa sobre a janela de concursos fornecida
     */
    static analyze(history, config) {
        const total = config.total;
        const drawCount = history.length;
        const drawn = config.drawn || config.pick;

        const freqAbsolute = {};
        const lastSeenIndex = {};      // ocorrência ANTERIOR (para medir o gap)
        const mostRecentIndex = {};    // ocorrência mais recente (para o atraso atual)
        const delayDistribution = {};
        const weightedAcc = new Float64Array(total + 1);

        for (let i = 1; i <= total; i++) {
            freqAbsolute[i] = 0;
            lastSeenIndex[i] = -1;
            mostRecentIndex[i] = -1;
            delayDistribution[i] = [];
        }

        const pairMatrix = {};
        for (let i = 1; i <= total; i++) {
            pairMatrix[i] = {};
            for (let j = i + 1; j <= total; j++) {
                pairMatrix[i][j] = 0;
            }
        }

        const sumList = [];
        const evenList = [];
        const primeList = [];
        const fibonacciList = [];
        const frameList = [];
        const activeRowsList = [];
        const activeColsList = [];
        const repetitionList = [];
        const rangeDistributions = [0, 0, 0, 0, 0];
        const rangeSize = Math.ceil(total / 5);
        const historicalDrawSignatures = new Set();
        const parsedDraws = new Array(drawCount);

        const alpha = 0.05;
        let wTotal = 0;
        let prevNumbersSet = null;

        history.forEach((draw, idx) => {
            const weight = Math.exp(-alpha * idx);
            wTotal += weight;

            const rawNumbers = Array.isArray(draw.dezenas) ? draw.dezenas.map(Number) : [];
            const numbers = [...new Set(rawNumbers)].sort((a, b) => a - b);
            parsedDraws[idx] = numbers;
            const currentSet = new Set(numbers);

            if (numbers.length > 0) {
                historicalDrawSignatures.add(numbers.join(','));
            }

            if (prevNumbersSet !== null) {
                let repCount = 0;
                numbers.forEach(n => {
                    if (prevNumbersSet.has(n)) repCount++;
                });
                repetitionList.push(repCount);
            }
            prevNumbersSet = currentSet;

            const evens = numbers.filter(n => n % 2 === 0).length;
            const primes = numbers.filter(n => PRIMES.includes(n)).length;
            const sum = numbers.reduce((a, b) => a + b, 0);
            const geom = this.analyzeTicketGeometry(numbers, total);

            evenList.push(evens);
            primeList.push(primes);
            sumList.push(sum);
            fibonacciList.push(geom.fibonacciCount);
            frameList.push(geom.frameCount);
            activeRowsList.push(geom.activeRows);
            activeColsList.push(geom.activeCols);

            numbers.forEach(n => {
                if (n >= 1 && n <= total) {
                    freqAbsolute[n]++;
                    weightedAcc[n] += weight;

                    if (lastSeenIndex[n] === -1) mostRecentIndex[n] = idx;
                    if (lastSeenIndex[n] !== -1) {
                        // Intervalo REAL entre ocorrências consecutivas (gap).
                        // Sem esta atualização o intervalo era sempre medido a partir
                        // da PRIMEIRA ocorrência, inflando avgDelay/maxDelay.
                        const interval = idx - lastSeenIndex[n];
                        delayDistribution[n].push(interval);
                    }
                    lastSeenIndex[n] = idx;

                    const rangeIdx = Math.min(Math.floor((n - 1) / rangeSize), 4);
                    rangeDistributions[rangeIdx]++;
                }
            });

            for (let i = 0; i < numbers.length; i++) {
                for (let j = i + 1; j < numbers.length; j++) {
                    const a = numbers[i];
                    const b = numbers[j];
                    if (pairMatrix[a] && pairMatrix[a][b] !== undefined) {
                        pairMatrix[a][b]++;
                    }
                }
            }
        });

        const expectedFreq = drawCount * drawn / total;
        const freqRelative = {};
        const freqWeighted = {};
        const expectedDeviation = {};

        for (let i = 1; i <= total; i++) {
            const f = freqAbsolute[i];
            freqRelative[i] = drawCount > 0 ? f / drawCount : 0;
            expectedDeviation[i] = expectedFreq > 0 ? (f - expectedFreq) / expectedFreq : 0;
            freqWeighted[i] = wTotal > 0 ? weightedAcc[i] / wTotal : 0;
        }

        const currentDelay = {};
        const avgDelay = {};
        const maxDelay = {};

        for (let i = 1; i <= total; i++) {
            currentDelay[i] = mostRecentIndex[i] === -1 ? drawCount : mostRecentIndex[i];
            const delays = delayDistribution[i];
            if (delays.length > 0) {
                avgDelay[i] = delays.reduce((a, b) => a + b, 0) / delays.length;
                maxDelay[i] = Math.max(...delays, currentDelay[i]);
            } else {
                avgDelay[i] = currentDelay[i];
                maxDelay[i] = currentDelay[i];
            }
        }

        const sumStats = this.calculateDistributionStats(sumList);
        const parityStats = this.calculateDistributionStats(evenList);
        const primeStats = this.calculateDistributionStats(primeList);
        const fibonacciStats = this.calculateDistributionStats(fibonacciList);
        const frameStats = this.calculateDistributionStats(frameList);
        const activeRowsStats = this.calculateDistributionStats(activeRowsList);
        const activeColsStats = this.calculateDistributionStats(activeColsList);
        const repetitionStats = this.calculateDistributionStats(repetitionList);
        const cycleStats = this.analyzeCycles(history, total);
        const markovStats = this.analyzeMarkovTransitions(history, total, drawn);

        const halfCount = Math.floor(history.length / 2);
        const recentSets = parsedDraws.slice(0, halfCount).map(arr => new Set(arr));
        const olderSets = parsedDraws.slice(halfCount).map(arr => new Set(arr));

        const topPairs = [];
        const pairNullProbability = (drawn * (drawn - 1)) / (total * (total - 1));
        for (let i = 1; i <= total; i++) {
            for (let j = i + 1; j <= total; j++) {
                const count = pairMatrix[i][j];
                const expectedPairCount = drawCount * pairNullProbability;
                topPairs.push({
                    pair: [i, j],
                    count,
                    expected: Number(expectedPairCount.toFixed(2)),
                    support: Number((count / (drawCount || 1)).toFixed(4)),
                    ratio: expectedPairCount > 0 ? Number((count / expectedPairCount).toFixed(4)) : 1
                });
            }
        }
        topPairs.sort((a, b) => b.count - a.count);
        const totalPairsExamined = topPairs.length;

        const topPairsSliced = topPairs.slice(0, 30);
        topPairsSliced.forEach(p => {
            const freqA = (freqAbsolute[p.pair[0]] || 0) / (drawCount || 1);
            const freqB = (freqAbsolute[p.pair[1]] || 0) / (drawCount || 1);
            const pairFreq = p.count / (drawCount || 1);
            p.lift = (freqA > 0 && freqB > 0) ? Number((pairFreq / (freqA * freqB)).toFixed(4)) : 1;

            let recentCount = 0;
            let olderCount = 0;
            for (const s of recentSets) {
                if (s.has(p.pair[0]) && s.has(p.pair[1])) recentCount++;
            }
            for (const s of olderSets) {
                if (s.has(p.pair[0]) && s.has(p.pair[1])) olderCount++;
            }
            const rRate = recentSets.length > 0 ? recentCount / recentSets.length : 0;
            const oRate = olderSets.length > 0 ? olderCount / olderSets.length : 0;
            const maxRate = Math.max(rRate, oRate);
            p.stability = maxRate > 0 ? Number((1 - Math.abs(rRate - oRate) / maxRate).toFixed(4)) : 1;

            // Teste binomial exato de co-ocorrência acima do esperado.
            p.rawPValue = StatisticalInference.binomialUpperTail(
                p.count, drawCount, pairNullProbability);
        });

        // FDR de Benjamini-Hochberg com a família COMPLETA de pares examinados
        // (conservador): os "pares quentes" só são reportados como padrão real
        // quando sobrevivem à multiplicidade de C(total,2) comparações.
        const pairFdr = StatisticalInference.benjaminiHochberg(
            topPairsSliced.map(p => p.rawPValue), 0.05, totalPairsExamined);
        topPairsSliced.forEach((p, i) => {
            p.pValue = Number(Math.max(1e-16, Math.min(1, p.rawPValue)).toFixed(10));
            p.qValue = pairFdr.qValues[i];
            p.significant = pairFdr.rejected[i] === true;
            delete p.rawPValue;
        });

        const tripleMap = new Map();
        const expectedTripleCount = drawCount * ((drawn * (drawn - 1) * (drawn - 2)) / (total * (total - 1) * (total - 2)));

        for (let dIdx = 0; dIdx < drawCount; dIdx++) {
            const nums = parsedDraws[dIdx];
            const nLen = nums.length;
            for (let i = 0; i < nLen - 2; i++) {
                const aShift = nums[i] << 16;
                for (let j = i + 1; j < nLen - 1; j++) {
                    const abShift = aShift | (nums[j] << 8);
                    for (let k = j + 1; k < nLen; k++) {
                        const key = abShift | nums[k];
                        tripleMap.set(key, (tripleMap.get(key) || 0) + 1);
                    }
                }
            }
        }

        const topTriplesRaw = [];
        for (const [key, count] of tripleMap.entries()) {
            topTriplesRaw.push({ key, count });
        }
        topTriplesRaw.sort((a, b) => b.count - a.count);

        const topTriples = topTriplesRaw.slice(0, 20).map(({ key, count }) => {
            const n0 = (key >>> 16) & 0xff;
            const n1 = (key >>> 8) & 0xff;
            const n2 = key & 0xff;
            const numbers = [n0, n1, n2];
            const freqA = (freqAbsolute[n0] || 0) / (drawCount || 1);
            const freqB = (freqAbsolute[n1] || 0) / (drawCount || 1);
            const freqC = (freqAbsolute[n2] || 0) / (drawCount || 1);
            const tripleFreq = count / (drawCount || 1);
            const lift = (freqA > 0 && freqB > 0 && freqC > 0) ? Number((tripleFreq / (freqA * freqB * freqC)).toFixed(4)) : 1;
            return {
                numbers,
                count,
                expected: Number(expectedTripleCount.toFixed(2)),
                support: Number((count / (drawCount || 1)).toFixed(4)),
                lift
            };
        });

        const chiSquare = this.chiSquareUniformity(freqAbsolute, total, drawCount, drawn);

        return {
            drawCount,
            lastDrawNumbers: Array.isArray(history[0]?.dezenas) ? history[0].dezenas.map(Number) : [],
            historicalDrawSignatures,
            freqAbsolute,
            freqRelative,
            freqWeighted,
            expectedFreq,
            expectedDeviation,
            currentDelay,
            avgDelay,
            maxDelay,
            sumStats,
            parityStats,
            primeStats,
            fibonacciStats,
            frameStats,
            activeRowsStats,
            activeColsStats,
            repetitionStats,
            cycleStats,
            markovStats,
            rangeDistributions,
            topPairs: topPairsSliced,
            pairMatrix,
            topTriples,
            chiSquare
        };
    }

    /**
     * Extrai um resumo COMPACTO e serializável dos sinais estatísticos de uma análise
     * (para transportar por postMessage até o painel de transparência sem levar as
     * matrizes O(n²) junto).
     */
    static summarizeSignals(analysis) {
        if (!analysis) return null;
        const chi = analysis.chiSquare || null;
        const mkv = analysis.markovStats || {};
        const pairs = Array.isArray(analysis.topPairs)
            ? analysis.topPairs.filter(p => p.significant).map(p => ({
                pair: p.pair, count: p.count, expected: p.expected,
                lift: p.lift, pValue: p.pValue, qValue: p.qValue
            }))
            : [];
        return {
            chiSquare: chi ? {
                chiSquare: chi.chiSquare,
                degreesOfFreedom: chi.degreesOfFreedom,
                pValue: chi.pValue,
                cramersV: chi.cramersV,
                effectDescriptor: chi.effectDescriptor,
                isUniform: chi.isUniform,
                method: chi.method,
                topDeviations: (chi.topDeviations || []).slice(0, 5)
            } : null,
            markov: {
                method: mkv.method || null,
                testedTransitions: mkv.testedTransitions ?? 0,
                reportedTransitions: mkv.reportedTransitions ?? 0,
                significantTransitions: mkv.significantTransitions ?? 0,
                fdrThreshold: mkv.fdrThreshold ?? null,
                hasStatisticallySignificantSignal: mkv.hasStatisticallySignificantSignal ?? false,
                top: (mkv.topTransitions || []).slice(0, 5)
            },
            pairs: {
                significantPairs: pairs.length,
                top: pairs.slice(0, 5)
            },
            drawCount: analysis.drawCount ?? null
        };
    }

    /**
     * Teste Chi-Quadrado de uniformidade para frequências, com p-value EXATO
     * (gama incompleta regularizada) — substitui a aproximação tanh/Wilson-Hilferty
     * que introduzia erro sistemático no p-value.
     * Também retorna o tamanho de efeito (V de Cramér) e as dezenas com resíduo
     * padronizado mais extremo, que são as únicas que merecem atenção.
     */
    static chiSquareUniformity(freqAbsolute, total, drawCount, drawn) {
        const expected = (drawCount * drawn) / total;
        let chiSq = 0;
        const residuals = [];
        for (let n = 1; n <= total; n++) {
            const observed = freqAbsolute[n] || 0;
            if (expected > 0) {
                chiSq += Math.pow(observed - expected, 2) / expected;
                // resíduo padronizado de Pearson: (O-E)/sqrt(E * (1 - p))
                const p = drawn / total;
                const sd = Math.sqrt(Math.max(1e-12, expected * (1 - p)));
                residuals.push({ number: n, observed, expected: Number(expected.toFixed(2)), z: Number(((observed - expected) / sd).toFixed(4)) });
            }
        }
        const df = Math.max(1, total - 1);
        const pValue = StatisticalInference.chiSquareSurvival(chiSq, df);
        // V de Cramér para tabela 1 x k (k = total)
        const cramersV = drawCount > 0 ? Math.sqrt(chiSq / (drawCount * drawn * Math.max(1, df))) : 0;

        residuals.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));

        return {
            chiSquare: Number(chiSq.toFixed(4)),
            degreesOfFreedom: df,
            pValue: Number((Number.isFinite(pValue) ? pValue : 1).toFixed(10)),
            cramersV: Number(cramersV.toFixed(4)),
            effectDescriptor: cramersV < 0.1 ? 'Desprezível' : (cramersV < 0.3 ? 'Pequeno' : (cramersV < 0.5 ? 'Médio' : 'Grande')),
            isUniform: Number.isFinite(pValue) ? pValue > 0.05 : true,
            // Com tantos testes simultâneos, |z| > 3 é o corte honesto para "desvio real"
            topDeviations: residuals.filter(r => Math.abs(r.z) >= 3).slice(0, 10),
            maxAbsZ: residuals.length > 0 ? Math.abs(residuals[0].z) : 0,
            method: 'Chi-Quadrado exato (gama incompleta regularizada)'
        };
    }

    /**
     * Calcula métricas estatísticas descritivas (média, mediana, desvio padrão, min, max, P10, P90)
     */
    static calculateDistributionStats(list) {
        if (!list || list.length <= 1) {
            const val = list && list.length === 1 ? list[0] : 0;
            return { mean: val, median: val, variance: 0, stdDev: 0, min: val, max: val, p10: val, p90: val, distribution: {} };
        }

        const sorted = [...list].sort((a, b) => a - b);
        const len = sorted.length;
        const sum = sorted.reduce((a, b) => a + b, 0);
        const mean = sum / len;

        const variance = sorted.reduce((s, val) => s + Math.pow(val - mean, 2), 0) / (len - 1);
        const stdDev = Math.sqrt(variance);

        const median = len % 2 === 0 ? (sorted[len / 2 - 1] + sorted[len / 2]) / 2 : sorted[Math.floor(len / 2)];
        const p10Idx = (len - 1) * 0.10;
        const p10 = sorted[Math.floor(p10Idx)] + (p10Idx % 1) * ((sorted[Math.ceil(p10Idx)] || sorted[Math.floor(p10Idx)]) - sorted[Math.floor(p10Idx)]);
        const p90Idx = (len - 1) * 0.90;
        const p90 = sorted[Math.floor(p90Idx)] + (p90Idx % 1) * ((sorted[Math.ceil(p90Idx)] || sorted[Math.floor(p90Idx)]) - sorted[Math.floor(p90Idx)]);

        const distribution = {};
        sorted.forEach(val => {
            distribution[val] = (distribution[val] || 0) + 1;
        });

        return {
            mean: Number(mean.toFixed(2)),
            median,
            variance: Number(variance.toFixed(2)),
            stdDev: Number(stdDev.toFixed(2)),
            min: sorted[0],
            max: sorted[len - 1],
            p10: Number(p10.toFixed(2)),
            p90: Number(p90.toFixed(2)),
            distribution
        };
    }
}
