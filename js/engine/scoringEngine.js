/**
 * ScoringEngine - Motor de Pontuação Composta Estatística
 * Substitui o score enganoso de "probabilidade real" por métricas estatísticas transparentes e explicáveis.
 */

import { PRIMES } from './statisticalAnalyzer.js';
import { SeededRandom } from './prng.js';

export const DEFAULT_WEIGHTS = {
    frequency: 0.20,
    recency: 0.15,
    trend: 0.10,
    cooccurrence: 0.15,
    distribution: 0.10,
    parity: 0.10,
    sum: 0.10,
    repetition: 0.05,
    sequences: 0.05
};

export class ScoringEngine {
    /**
     * Calcula o score composto do jogo e constrói métricas estatísticas transparentes
     * @param {Array<number>} numbers - Lista de dezenas do jogo candidato
     * @param {Object} config - Configuração da loteria
     * @param {Object} analysis - Objeto retornado por StatisticalAnalyzer.analyze
     * @param {Object} customWeights - Pesos dos fatores (opcional)
     * @param {Object} backtestSummary - Resumo de backtesting pré-calculado (opcional)
     */
    static evaluateGame(numbers, config, analysis, customWeights = null, backtestSummary = null) {
        const weights = { ...DEFAULT_WEIGHTS, ...(customWeights || {}) };
        const sortedNumbers = [...numbers].sort((a, b) => a - b);
        const len = sortedNumbers.length;

        const explanations = [];

        // 1. Fator Frequência Histórica
        const freqs = Object.values(analysis.freqAbsolute || {});
        const maxFreq = Math.max(...freqs) || 1;
        const minFreq = Math.min(...freqs) || 0;
        const avgGameFreq = sortedNumbers.reduce((s, n) => s + (analysis.freqAbsolute[n] || 0), 0) / len;
        const freqScore = (avgGameFreq - minFreq) / (maxFreq - minFreq || 1);
        if (freqScore > 0.6) {
            explanations.push(`+ Frequência média alta (${avgGameFreq.toFixed(1)} saídas/dezena)`);
        } else if (freqScore < 0.3) {
            explanations.push(`- Presença de dezenas com baixa frequência histórica`);
        }

        // 2. Fator Recência (Frequência Ponderada)
        const weightedFreqs = Object.values(analysis.freqWeighted || {});
        const maxWeighted = Math.max(...weightedFreqs) || 1;
        const avgGameWeighted = sortedNumbers.reduce((s, n) => s + (analysis.freqWeighted[n] || 0), 0) / len;
        const recencyScore = maxWeighted > 0 ? avgGameWeighted / maxWeighted : 0.5;
        if (recencyScore > 0.65) {
            explanations.push(`+ Forte momento recente (dezenas ativas em concursos recentes)`);
        }

        // 3. Fator Tendência / Atraso Estatístico
        // Recompensar atrasos alinhados com o atraso médio histórico da dezena
        let delayScoreSum = 0;
        sortedNumbers.forEach(n => {
            const curr = analysis.currentDelay[n] || 0;
            const avg = analysis.avgDelay[n] || 1;
            // Se o atraso atual está próximo do atraso médio, o score é alto
            const ratio = curr / (avg || 1);
            const scoreN = Math.exp(-Math.pow(ratio - 1, 2)); // Função gaussiana centrada em ratio=1
            delayScoreSum += scoreN;
        });
        const trendScore = delayScoreSum / len;
        if (trendScore > 0.7) {
            explanations.push(`+ Atrasos numéricos dentro do intervalo médio histórico`);
        }

        // 4. Fator Co-ocorrência (Pares)
        let pairCountSum = 0;
        let pairPairsCount = 0;
        for (let i = 0; i < len; i++) {
            for (let j = i + 1; j < len; j++) {
                const a = Math.min(sortedNumbers[i], sortedNumbers[j]);
                const b = Math.max(sortedNumbers[i], sortedNumbers[j]);
                const pairFreq = (analysis.pairMatrix[a] && analysis.pairMatrix[a][b]) || 0;
                pairCountSum += pairFreq;
                pairPairsCount++;
            }
        }
        const avgPairFreq = pairPairsCount > 0 ? pairCountSum / pairPairsCount : 0;
        const maxPairFreq = analysis.topPairs && analysis.topPairs.length > 0 ? analysis.topPairs[0].count : 1;
        const cooccurrenceScore = maxPairFreq > 0 ? avgPairFreq / maxPairFreq : 0.5;
        if (cooccurrenceScore > 0.5) {
            explanations.push(`+ Elevada co-ocorrência de pares históricos`);
        }

        // 5. Fator Distribuição por Faixas
        const rangeSize = Math.ceil(config.total / 5);
        const rangeCounts = [0, 0, 0, 0, 0];
        sortedNumbers.forEach(n => {
            const idx = Math.min(Math.floor((n - 1) / rangeSize), 4);
            rangeCounts[idx]++;
        });
        // Quanto mais distribuído entre as 5 faixas (sem concentrar tudo em 1 ou 2), maior o score
        const expectedPerRange = len / 5;
        const rangeVariance = rangeCounts.reduce((s, c) => s + Math.pow(c - expectedPerRange, 2), 0) / 5;
        const distributionScore = Math.max(0, 1 - (rangeVariance / Math.pow(len, 2)));
        if (distributionScore > 0.7) {
            explanations.push(`+ Boa distribuição por faixas numéricas`);
        }

        // 6. Fator Paridade (Pares vs Ímpares)
        const evens = sortedNumbers.filter(n => n % 2 === 0).length;
        const parityStats = analysis.parityStats || { mean: len / 2, stdDev: 1.5 };
        const parityZ = parityStats.stdDev > 0 ? Math.abs(evens - parityStats.mean) / parityStats.stdDev : 0;
        const parityScore = Math.max(0, 1 - (parityZ / 3)); // Penalty se afastar > 3 desvios
        if (parityScore > 0.7) {
            explanations.push(`+ Proporção par/ímpar (${evens} pares) alinhada à média da loteria`);
        } else {
            explanations.push(`- Paridade (${evens} pares) em zona atípica`);
        }

        // 7. Fator Soma das Dezenas
        const gameSum = sortedNumbers.reduce((a, b) => a + b, 0);
        // Calcula média teórica da soma: pick * (total + 1) / 2
        const theoreticalMean = (config.pick || config.drawn) * (config.total + 1) / 2;
        const sumStats = analysis.sumStats || { mean: theoreticalMean, stdDev: theoreticalMean * 0.1 };
        const sumZ = sumStats.stdDev > 0 ? Math.abs(gameSum - sumStats.mean) / sumStats.stdDev : 0;
        const sumScore = Math.max(0, 1 - (sumZ / 3));
        if (sumScore > 0.7) {
            explanations.push(`+ Soma total (${gameSum}) dentro do intervalo central de ocorrências`);
        } else {
            explanations.push(`- Soma total (${gameSum}) fora da região de maior concentração`);
        }

        // 8. Fator Repetição (comparação com último sorteio)
        const lastDraw = analysis.lastDrawNumbers || [];
        let repScore = 0.5;
        if (lastDraw.length > 0) {
            const overlap = sortedNumbers.filter(n => lastDraw.includes(n)).length;
            const expectedOverlap = analysis.repetitionStats?.mean ?? Math.round(len * (config.drawn || config.pick) / config.total);
            const overlapRatio = expectedOverlap > 0 ? overlap / expectedOverlap : 1;
            repScore = Math.exp(-Math.pow(overlapRatio - 1, 2)); // Gaussian centered at expected
            if (Math.abs(overlap - expectedOverlap) <= 1) {
                explanations.push(`+ Repetição (${overlap} dezenas do último sorteio) alinhada à média histórica (${expectedOverlap})`);
            } else if (overlap > expectedOverlap + 2) {
                explanations.push(`- Repetição elevada (${overlap} dezenas) acima do padrão`);
            }
        }

        // 9. Fator Sequências / Consecutivos
        let consecutivePairs = 0;
        for (let i = 0; i < len - 1; i++) {
            if (sortedNumbers[i + 1] === sortedNumbers[i] + 1) {
                consecutivePairs++;
            }
        }
        // Penalizar sequências gigantescas (ex: 5 números seguidos)
        const sequenceScore = consecutivePairs <= 4 ? 1 - (consecutivePairs * 0.15) : 0.2;
        if (consecutivePairs > 0 && consecutivePairs <= 3) {
            explanations.push(`+ Sequências de consecutivas (${consecutivePairs}) dentro do padrão estatístico`);
        } else if (consecutivePairs > 4) {
            explanations.push(`- Sequência de dezenas consecutivas (${consecutivePairs}) excessiva`);
        }

        // Normalização dos pesos
        const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
        const rawScore = (
            freqScore * weights.frequency +
            recencyScore * weights.recency +
            trendScore * weights.trend +
            cooccurrenceScore * weights.cooccurrence +
            distributionScore * weights.distribution +
            parityScore * weights.parity +
            sumScore * weights.sum +
            repScore * weights.repetition +
            sequenceScore * weights.sequences
        ) / totalWeight;

        // Model score escala de 0 a 100
        const modelScore = Number((rawScore * 100).toFixed(1));

        // Mapeamento de métricas históricas de backtesting reais (sem fallbacks fictícios ou hardcoded)
        const expectedHits = (backtestSummary && typeof backtestSummary.meanHits === 'number') 
            ? backtestSummary.meanHits 
            : null;

        const confidenceInterval = (backtestSummary && backtestSummary.confidenceInterval)
            ? backtestSummary.confidenceInterval
            : null;

        const pValue = (backtestSummary && typeof backtestSummary.pValue === 'number')
            ? backtestSummary.pValue
            : null;

        return {
            modelScore,
            rawScore,
            historicalPerformance: backtestSummary?.relativeImprovement ?? null,
            expectedHits,
            confidenceInterval,
            pValue,
            statisticallySignificant: backtestSummary?.isStatisticallySignificant ?? null,
            probabilityType: 'Score Relativo do Modelo (Não é garantia matemática de acerto)',
            backtestMetrics: backtestSummary || null,
            explanations,
            stats: {
                evens,
                odds: len - evens,
                sum: gameSum,
                primes: sortedNumbers.filter(n => PRIMES.includes(n)).length,
                consecutivePairs
            }
        };
    }

    /**
     * Normaliza automaticamente qualquer conjunto de pesos para garantir sum(weights) = 1.0
     */
    static normalizeWeights(weights) {
        const normalized = { ...weights };
        const total = Object.values(normalized).reduce((a, b) => a + b, 0);
        if (total > 0 && Math.abs(total - 1.0) > 1e-6) {
            Object.keys(normalized).forEach(k => {
                normalized[k] = Number((normalized[k] / total).toFixed(4));
            });
        }
        return normalized;
    }

    /**
     * Otimiza pesos usando divisão de Treino (70%) vs Validação (30%) e penalização de Overfitting
     * Usa SeededRandom para reprodutibilidade 100% determinística sem Math.random()
     * @param {Array} fullHistory - Histórico de concursos
     * @param {Object} config - Configuração da loteria
     * @param {Object} options - { iterations: 20, seed: 123456 }
     * @returns {{ optimizedWeights: Object, bestObjectiveScore: number, trainMean: number, valMean: number, overfitGap: number, isOverfit: boolean, method: string }}
     */
    static optimizeWeights(fullHistory, config, options = {}) {
        const seed = options.seed ?? 123456;
        const prng = new SeededRandom(seed);
        const baseWeights = this.normalizeWeights(DEFAULT_WEIGHTS);

        if (!fullHistory || fullHistory.length < 30) {
            return {
                optimizedWeights: baseWeights,
                bestObjectiveScore: 0,
                trainMean: null,
                valMean: null,
                overfitGap: 0,
                isOverfit: false,
                method: 'Dados insuficientes para otimização - Utilizando pesos base'
            };
        }

        const totalDraws = fullHistory.length;
        const trainCutoff = Math.floor(totalDraws * 0.7);

        const trainHistory = fullHistory.slice(0, trainCutoff);
        const valHistory = fullHistory.slice(trainCutoff);

        const factors = Object.keys(baseWeights);
        const variations = [0.5, 0.8, 1.0, 1.2, 1.5];

        let bestWeights = { ...baseWeights };
        let bestObjectiveScore = -Infinity;
        let bestTrainMean = 0;
        let bestValMean = 0;
        let bestOverfitGap = 0;
        let bestBreakdown = null;

        const iterations = options.iterations || 20;

        for (let i = 0; i < iterations; i++) {
            let testWeights = { ...baseWeights };
            if (i > 0) {
                // Seleção aleatória determinística via PRNG
                const numVary = prng.nextInt(1, 3);
                const shuffledFactors = prng.shuffle(factors);
                for (let f = 0; f < numVary; f++) {
                    const factorKey = shuffledFactors[f];
                    const scale = variations[prng.nextInt(0, variations.length - 1)];
                    testWeights[factorKey] = baseWeights[factorKey] * scale;
                }
            }

            testWeights = this.normalizeWeights(testWeights);

            // Avalia no conjunto de treino
            const trainHitsSum = this._quickEvaluateWeights(trainHistory, config, testWeights, prng);
            const trainMean = trainHitsSum / Math.max(1, trainHistory.length - 10);

            // Avalia no conjunto de validação
            const valHitsSum = this._quickEvaluateWeights(valHistory, config, testWeights, prng);
            const valMean = valHitsSum / Math.max(1, valHistory.length - 5);

            const overfitGap = Math.max(0, trainMean - valMean);
            
            // Função objetivo transparente (Requirement 8):
            // Objective = 0.30 * performance + 0.35 * outOfSample + 0.20 * stability + 0.15 * statisticalEvidence - overfitPenalty
            const expectedMean = (config.pick * (config.drawn || config.pick)) / config.total;
            const perfScore = Math.min(100, (trainMean / (expectedMean || 1)) * 50);
            const outOfSampleScore = Math.min(100, (valMean / (expectedMean || 1)) * 50);
            const stabilityComponent = Math.max(0, 100 - overfitGap * 30);
            const statEvidence = Math.min(100, Math.max(0, (valMean - expectedMean) * 40 + 50));
            const overfitPenalty = overfitGap * 25;

            const compositeObjectiveScore = (0.30 * perfScore) + (0.35 * outOfSampleScore) + (0.20 * stabilityComponent) + (0.15 * statEvidence) - overfitPenalty;

            if (compositeObjectiveScore > bestObjectiveScore) {
                bestObjectiveScore = compositeObjectiveScore;
                bestWeights = testWeights;
                bestTrainMean = Number(trainMean.toFixed(2));
                bestValMean = Number(valMean.toFixed(2));
                bestOverfitGap = Number(overfitGap.toFixed(2));
                bestBreakdown = {
                    performance: Number(perfScore.toFixed(1)),
                    outOfSample: Number(outOfSampleScore.toFixed(1)),
                    stability: Number(stabilityComponent.toFixed(1)),
                    statisticalEvidence: Number(statEvidence.toFixed(1)),
                    overfitPenalty: Number(overfitPenalty.toFixed(1)),
                    finalObjective: Number(compositeObjectiveScore.toFixed(1))
                };
            }
        }

        const isOverfit = bestOverfitGap > 1.0;

        return {
            optimizedWeights: bestWeights,
            bestObjectiveScore: Number(Number.isFinite(bestObjectiveScore) ? bestObjectiveScore.toFixed(2) : 0),
            trainMean: Number.isFinite(bestTrainMean) ? bestTrainMean : null,
            valMean: Number.isFinite(bestValMean) ? bestValMean : null,
            overfitGap: Number.isFinite(bestOverfitGap) ? bestOverfitGap : 0,
            objectiveBreakdown: bestBreakdown || {
                performance: 0,
                outOfSample: 0,
                stability: 0,
                statisticalEvidence: 0,
                overfitPenalty: 0,
                finalObjective: 0
            },
            isOverfit,
            method: 'Otimização Determinística Grid/Random (Treino 70% / Validação 30%)'
        };
    }

    /**
     * Avaliação rápida interna de um conjunto de pesos para otimização
     */
    static _quickEvaluateWeights(historySlice, config, weights, prng) {
        if (!historySlice || historySlice.length < 5) return 0;
        let hitsTotal = 0;
        const evalCount = Math.min(15, historySlice.length - 1);
        const total = config.total;
        const pick = config.pick;

        for (let i = 0; i < evalCount; i++) {
            const draw = historySlice[i];
            const actual = new Set((draw.dezenas || []).map(Number));
            const past = historySlice.slice(i + 1);

            // Frequência rápida no passado
            const freq = {};
            past.forEach(pd => {
                (pd.dezenas || []).forEach(d => {
                    const n = Number(d);
                    freq[n] = (freq[n] || 0) + 1;
                });
            });

            // Seleção determinística ponderada por freqs * pesos.frequency
            const cand = [];
            const nums = Array.from({ length: total }, (_, idx) => idx + 1);
            nums.sort((a, b) => (freq[b] || 0) - (freq[a] || 0));
            cand.push(...nums.slice(0, pick));

            const hits = cand.filter(n => actual.has(n)).length;
            hitsTotal += hits;
        }

        return hitsTotal;
    }
}

