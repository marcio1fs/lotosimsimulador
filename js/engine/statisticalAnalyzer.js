/**
 * StatisticalAnalyzer - Motor Avançado de Análise Estatística para Loterias
 * Analisa séries temporais, distribuições empíricas, atrasos, repetições, co-ocorrência e padrões combinatórios.
 */

export const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];

export class StatisticalAnalyzer {
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

        // Histórico de somas, pares, ímpares, primos, repetições
        const sumList = [];
        const evenList = [];
        const primeList = [];
        const repetitionList = []; // Repetição em relação ao concurso anterior (história normalizada)
        const rangeDistributions = [0, 0, 0, 0, 0]; // 5 faixas iguais
        const rangeSize = Math.ceil(total / 5);

        // Processa do concurso mais recente (índice 0) ao mais antigo
        let prevNumbersSet = null;

        history.forEach((draw, idx) => {
            const rawNumbers = Array.isArray(draw.dezenas) ? draw.dezenas.map(Number) : [];
            const numbers = [...new Set(rawNumbers)].sort((a, b) => a - b);
            const currentSet = new Set(numbers);

            // Contagem de repetição em relação ao concurso anterior
            if (prevNumbersSet !== null) {
                let repCount = 0;
                numbers.forEach(n => {
                    if (prevNumbersSet.has(n)) repCount++;
                });
                repetitionList.push(repCount);
            }
            prevNumbersSet = currentSet;

            // Estatísticas do concurso individual
            const evens = numbers.filter(n => n % 2 === 0).length;
            const primes = numbers.filter(n => PRIMES.includes(n)).length;
            const sum = numbers.reduce((a, b) => a + b, 0);

            evenList.push(evens);
            primeList.push(primes);
            sumList.push(sum);

            // Frequência, Atraso e Faixas
            numbers.forEach(n => {
                if (n >= 1 && n <= total) {
                    freqAbsolute[n]++;

                    if (lastSeenIndex[n] === -1) {
                        lastSeenIndex[n] = idx;
                    } else {
                        // Registra intervalo entre saídas
                        const interval = idx - lastSeenIndex[n];
                        delayDistribution[n].push(interval);
                    }

                    // Distribuição por Faixas
                    const rangeIdx = Math.min(Math.floor((n - 1) / rangeSize), 4);
                    rangeDistributions[rangeIdx]++;
                }
            });

            // Co-ocorrência de Pares
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
        const expectedFreq = drawCount * (config.drawn || config.pick) / total;

        // Frequência relativa, ponderada e tendência
        const freqRelative = {};
        const freqWeighted = {};
        const expectedDeviation = {};

        // Recência com decaimento exponencial (alpha = 0.05)
        const alpha = 0.05;

        for (let i = 1; i <= total; i++) {
            const f = freqAbsolute[i];
            freqRelative[i] = drawCount > 0 ? f / drawCount : 0;
            expectedDeviation[i] = expectedFreq > 0 ? (f - expectedFreq) / expectedFreq : 0;

            // Cálculo de Frequência Ponderada por Recência
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

        // Análise de Atrasos
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

        // Estatísticas de Soma (Média, Mediana, Desvio Padrão, Percentis)
        const sumStats = this.calculateDistributionStats(sumList);
        const parityStats = this.calculateDistributionStats(evenList);
        const primeStats = this.calculateDistributionStats(primeList);
        const repetitionStats = this.calculateDistributionStats(repetitionList);

        // Top Pares mais frequentes
        const topPairs = [];
        for (let i = 1; i <= total; i++) {
            for (let j = i + 1; j <= total; j++) {
                const count = pairMatrix[i][j];
                const expectedPairCount = drawCount * ((config.drawn * (config.drawn - 1)) / (total * (total - 1)));
                topPairs.push({
                    pair: [i, j],
                    count,
                    expected: expectedPairCount,
                    ratio: expectedPairCount > 0 ? count / expectedPairCount : 1
                });
            }
        }
        topPairs.sort((a, b) => b.count - a.count);

        return {
            drawCount,
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
            repetitionStats,
            rangeDistributions,
            topPairs: topPairs.slice(0, 30), // Top 30 pares
            pairMatrix
        };
    }

    /**
     * Calcula métricas estatísticas descritivas (média, mediana, desvio padrão, min, max, P10, P90)
     */
    static calculateDistributionStats(list) {
        if (!list || list.length === 0) {
            return { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p90: 0, distribution: {} };
        }

        const sorted = [...list].sort((a, b) => a - b);
        const len = sorted.length;
        const sum = sorted.reduce((a, b) => a + b, 0);
        const mean = sum / len;

        const variance = sorted.reduce((s, val) => s + Math.pow(val - mean, 2), 0) / len;
        const stdDev = Math.sqrt(variance);

        const median = len % 2 === 0 ? (sorted[len / 2 - 1] + sorted[len / 2]) / 2 : sorted[Math.floor(len / 2)];
        const p10 = sorted[Math.floor(len * 0.10)] || sorted[0];
        const p90 = sorted[Math.floor(len * 0.90)] || sorted[len - 1];

        const distribution = {};
        sorted.forEach(val => {
            distribution[val] = (distribution[val] || 0) + 1;
        });

        return {
            mean: Number(mean.toFixed(2)),
            median,
            stdDev: Number(stdDev.toFixed(2)),
            min: sorted[0],
            max: sorted[len - 1],
            p10,
            p90,
            distribution
        };
    }
}
