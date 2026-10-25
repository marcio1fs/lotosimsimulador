/**
 * StatisticalAnalyzer - Motor Avançado de Análise Estatística para Loterias
 * Analisa séries temporais, distribuições empíricas, atrasos, repetições, co-ocorrência,
 * ciclo das dezenas, geometria matricial (linhas/colunas/moldura/miolo), Fibonacci,
 * Cadeias de Markov de 1ª Ordem (Transição Temporal t-1 -> t) e padrões combinatórios.
 */

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
        const topTransitions = [];

        // Suavização Dirichlet-Laplace (prior alpha = 1)
        const priorAlpha = 1.0;
        const priorDenom = total * (priorAlpha / Math.max(1, drawn));

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
                    // P(j in t | prevNum in t-1) com suavização Bayesiana
                    const smoothedProb = (transCount + priorAlpha * baselineProb) / (countPrev + priorAlpha);
                    conditionalProbSum += smoothedProb;
                    validTriggers++;

                    if (countPrev >= 3 && transCount >= 2) {
                        const lift = smoothedProb / Math.max(1e-6, baselineProb);
                        if (lift > 1.15) {
                            topTransitions.push({
                                from: prevNum,
                                to: j,
                                count: transCount,
                                probability: Number(smoothedProb.toFixed(4)),
                                lift: Number(lift.toFixed(3))
                            });
                        }
                    }
                }
            });

            const avgCondProb = validTriggers > 0 ? conditionalProbSum / validTriggers : baselineProb;
            nextDrawProbabilities[j] = Number(avgCondProb.toFixed(4));
            markovLiftByNumber[j] = Number((avgCondProb / Math.max(1e-6, baselineProb)).toFixed(4));
        }

        topTransitions.sort((a, b) => b.lift - a.lift || b.count - a.count);

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
            topTransitions: topTransitions.slice(0, 15)
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

        // Processa em ordem cronológica (do mais antigo para o mais recente)
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

        // Calcula urgência de ciclo para cada dezena (dezenas ausentes no ciclo atual ganham impulso proporcional ao avanço do ciclo)
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
     * @param {Array} history - Array de concursos (ordenados do mais recente para o mais antigo, ou vice-versa)
     * @param {number|string} windowSize - Tamanho da janela (ex: 20, 50, 100, 200, 500, 'full')
     */
    static getWindow(history, windowSize = 'full') {
        if (!history || !Array.isArray(history) || history.length === 0) return [];
        if (windowSize === 'full' || typeof windowSize !== 'number') return history;
        return history.slice(0, windowSize);
    }

    /**
     * Executa análise estatística completa sobre a janela de concursos fornecida
     * @param {Array} history - Concursos na janela temporal
     * @param {Object} config - Configuração da loteria (total, pick, drawn)
     */
    static analyze(history, config) {
        const total = config.total;
        const drawCount = history.length;
        const drawn = config.drawn || config.pick;

        // 1. Inicialização das estruturas de dados
        const freqAbsolute = {};
        const lastSeenIndex = {}; // 0 = último concurso
        const delayDistribution = {};
        
        for (let i = 1; i <= total; i++) {
            freqAbsolute[i] = 0;
            lastSeenIndex[i] = -1;
            delayDistribution[i] = [];
        }

        // Matriz de Co-ocorrência (Pares)
        const pairMatrix = {};
        for (let i = 1; i <= total; i++) {
            pairMatrix[i] = {};
            for (let j = i + 1; j <= total; j++) {
                pairMatrix[i][j] = 0;
            }
        }

        // Histórico de somas, pares, ímpares, primos, fibonacci, moldura, repetições e assinaturas históricas
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

        let prevNumbersSet = null;

        history.forEach((draw, idx) => {
            const rawNumbers = Array.isArray(draw.dezenas) ? draw.dezenas.map(Number) : [];
            const numbers = [...new Set(rawNumbers)].sort((a, b) => a - b);
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

                    if (lastSeenIndex[n] === -1) {
                        lastSeenIndex[n] = idx;
                    } else {
                        const interval = idx - lastSeenIndex[n];
                        delayDistribution[n].push(interval);
                    }

                    const rangeIdx = Math.min(Math.floor((n - 1) / rangeSize), 4);
                    rangeDistributions[rangeIdx]++;
                }
            });

            for (let i = 0; i < numbers.length; i++) {
                for (let j = i + 1; j < numbers.length; j++) {
                    const a = Math.min(numbers[i], numbers[j]);
                    const b = Math.max(numbers[i], numbers[j]);
                    if (pairMatrix[a] && pairMatrix[a][b] !== undefined) {
                        pairMatrix[a][b]++;
                    }
                }
            }
        });

        // 2. Cálculos derivados
        const expectedFreq = drawCount * drawn / total;

        const freqRelative = {};
        const freqWeighted = {};
        const expectedDeviation = {};

        const alpha = 0.05;

        for (let i = 1; i <= total; i++) {
            const f = freqAbsolute[i];
            freqRelative[i] = drawCount > 0 ? f / drawCount : 0;
            expectedDeviation[i] = expectedFreq > 0 ? (f - expectedFreq) / expectedFreq : 0;

            let wSum = 0;
            let wTotal = 0;
            history.forEach((draw, idx) => {
                const weight = Math.exp(-alpha * idx);
                const numbers = Array.isArray(draw.dezenas) ? draw.dezenas.map(Number) : [];
                if (numbers.includes(i)) {
                    wSum += weight;
                }
                wTotal += weight;
            });
            freqWeighted[i] = wTotal > 0 ? wSum / wTotal : 0;
        }

        const currentDelay = {};
        const avgDelay = {};
        const maxDelay = {};

        for (let i = 1; i <= total; i++) {
            currentDelay[i] = lastSeenIndex[i] === -1 ? drawCount : lastSeenIndex[i];
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
        const recentHistory = history.slice(0, halfCount);
        const olderHistory = history.slice(halfCount);

        const topPairs = [];
        for (let i = 1; i <= total; i++) {
            for (let j = i + 1; j <= total; j++) {
                const count = pairMatrix[i][j];
                const expectedPairCount = drawCount * ((drawn * (drawn - 1)) / (total * (total - 1)));
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

        const topPairsSliced = topPairs.slice(0, 30);
        topPairsSliced.forEach(p => {
            const freqA = (freqAbsolute[p.pair[0]] || 0) / (drawCount || 1);
            const freqB = (freqAbsolute[p.pair[1]] || 0) / (drawCount || 1);
            const pairFreq = p.count / (drawCount || 1);
            p.lift = (freqA > 0 && freqB > 0) ? Number((pairFreq / (freqA * freqB)).toFixed(4)) : 1;

            let recentCount = 0;
            let olderCount = 0;
            recentHistory.forEach(d => {
                const nums = (d.dezenas || []).map(Number);
                if (nums.includes(p.pair[0]) && nums.includes(p.pair[1])) recentCount++;
            });
            olderHistory.forEach(d => {
                const nums = (d.dezenas || []).map(Number);
                if (nums.includes(p.pair[0]) && nums.includes(p.pair[1])) olderCount++;
            });
            const rRate = recentHistory.length > 0 ? recentCount / recentHistory.length : 0;
            const oRate = olderHistory.length > 0 ? olderCount / olderHistory.length : 0;
            const maxRate = Math.max(rRate, oRate);
            p.stability = maxRate > 0 ? Number((1 - Math.abs(rRate - oRate) / maxRate).toFixed(4)) : 1;
        });

        const tripleCounts = {};
        const expectedTripleCount = drawCount * ((drawn * (drawn - 1) * (drawn - 2)) / (total * (total - 1) * (total - 2)));
        
        for (const draw of history) {
            const nums = Array.isArray(draw.dezenas) ? draw.dezenas.map(Number).sort((a, b) => a - b) : [];
            for (let i = 0; i < nums.length; i++) {
                for (let j = i + 1; j < nums.length; j++) {
                    for (let k = j + 1; k < nums.length; k++) {
                        const key = `${nums[i]}-${nums[j]}-${nums[k]}`;
                        tripleCounts[key] = (tripleCounts[key] || 0) + 1;
                    }
                }
            }
        }
        const topTriples = Object.entries(tripleCounts)
            .map(([key, count]) => {
                const numbers = key.split('-').map(Number);
                const freqA = (freqAbsolute[numbers[0]] || 0) / (drawCount || 1);
                const freqB = (freqAbsolute[numbers[1]] || 0) / (drawCount || 1);
                const freqC = (freqAbsolute[numbers[2]] || 0) / (drawCount || 1);
                const tripleFreq = count / (drawCount || 1);
                const lift = (freqA > 0 && freqB > 0 && freqC > 0) ? Number((tripleFreq / (freqA * freqB * freqC)).toFixed(4)) : 1;
                
                return { 
                    numbers, 
                    count,
                    expected: Number(expectedTripleCount.toFixed(2)),
                    support: Number((count / (drawCount || 1)).toFixed(4)),
                    lift
                };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 20);

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
     * Teste Chi-Quadrado de uniformidade para frequências
     */
    static chiSquareUniformity(freqAbsolute, total, drawCount, drawn) {
        const expected = (drawCount * drawn) / total;
        let chiSq = 0;
        for (let n = 1; n <= total; n++) {
            const observed = freqAbsolute[n] || 0;
            chiSq += expected > 0 ? Math.pow(observed - expected, 2) / expected : 0;
        }
        const df = total - 1;
        const z = Math.pow(chiSq / df, 1/3) - (1 - 2 / (9 * df));
        const se = Math.sqrt(2 / (9 * df));
        const zScore = z / se;
        const pValue = 1 - 0.5 * (1 + Math.tanh(zScore * 0.7978845608));
        return {
            chiSquare: Number(chiSq.toFixed(4)),
            degreesOfFreedom: df,
            pValue: Number(Math.max(0, Math.min(1, pValue)).toFixed(6)),
            isUniform: pValue > 0.05
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
