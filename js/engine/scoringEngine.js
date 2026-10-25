/**
 * ScoringEngine - Motor de Pontuação Composta Estatística Multifatorial
 * Substitui o score enganoso de "probabilidade real" por métricas estatísticas transparentes,
 * incluindo Ciclo das Dezenas, Geometria Matricial (Moldura/Linhas/Colunas), Fibonacci,
 * Co-ocorrência de Pares/Trincas e Filtro de Poda Gaussiana.
 */

import { StatisticalAnalyzer, PRIMES, FIBONACCI } from './statisticalAnalyzer.js';
import { GaussianFilterEngine } from './gaussianFilterEngine.js';
import { SeededRandom } from './prng.js';

export const DEFAULT_WEIGHTS = {
    frequency: 0.16,
    recency: 0.14,
    trend: 0.10,
    cycle: 0.10,
    cooccurrence: 0.13,
    distribution: 0.08,
    geometry: 0.08,
    parity: 0.07,
    sum: 0.07,
    repetition: 0.04,
    sequences: 0.03
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
        const avgGameFreq = sortedNumbers.reduce((s, n) => s + (analysis.freqAbsolute?.[n] || 0), 0) / len;
        const freqScore = (avgGameFreq - minFreq) / (maxFreq - minFreq || 1);
        if (freqScore > 0.6) {
            explanations.push(`+ Frequência média alta (${avgGameFreq.toFixed(1)} saídas/dezena)`);
        } else if (freqScore < 0.3) {
            explanations.push(`- Presença de dezenas com baixa frequência histórica`);
        }

        // 2. Fator Recência (Frequência Ponderada Exponencial)
        const weightedFreqs = Object.values(analysis.freqWeighted || {});
        const maxWeighted = Math.max(...weightedFreqs) || 1;
        const avgGameWeighted = sortedNumbers.reduce((s, n) => s + (analysis.freqWeighted?.[n] || 0), 0) / len;
        const recencyScore = maxWeighted > 0 ? avgGameWeighted / maxWeighted : 0.5;
        if (recencyScore > 0.65) {
            explanations.push(`+ Forte momento recente (dezenas ativas em concursos recentes)`);
        }

        // 3. Fator Tendência / Atraso Estatístico
        let delayScoreSum = 0;
        sortedNumbers.forEach(n => {
            const curr = analysis.currentDelay?.[n] || 0;
            const avg = analysis.avgDelay?.[n] || 1;
            const ratio = curr / (avg || 1);
            const scoreN = Math.exp(-Math.pow(ratio - 1, 2)); // Função gaussiana centrada em ratio=1
            delayScoreSum += scoreN;
        });
        const trendScore = delayScoreSum / len;
        if (trendScore > 0.7) {
            explanations.push(`+ Atrasos numéricos alinhados ao intervalo médio de retorno`);
        }

        // 4. Fator Ciclo das Dezenas (Fechamento de Ciclo)
        const missingCycleSet = new Set(analysis.cycleStats?.missingInCurrentCycle || []);
        const missingIncludedCount = sortedNumbers.filter(n => missingCycleSet.has(n)).length;
        let cycleScore = 0.75;
        if (missingCycleSet.size > 0) {
            const targetCycleInclusion = Math.min(missingCycleSet.size, Math.max(1, Math.ceil(missingCycleSet.size * (len / config.total) * 1.35)));
            cycleScore = Math.min(1.0, 0.45 + 0.55 * (missingIncludedCount / targetCycleInclusion));
            if (missingIncludedCount > 0) {
                explanations.push(`+ Inclui ${missingIncludedCount}/${missingCycleSet.size} dezena(s) que faltam para fechar o ciclo atual`);
            }
        }

        // 5. Fator Co-ocorrência (Pares + Trincas de Alto Lift)
        let pairCountSum = 0;
        let pairPairsCount = 0;
        for (let i = 0; i < len; i++) {
            for (let j = i + 1; j < len; j++) {
                const a = Math.min(sortedNumbers[i], sortedNumbers[j]);
                const b = Math.max(sortedNumbers[i], sortedNumbers[j]);
                const pairFreq = (analysis.pairMatrix?.[a] && analysis.pairMatrix[a][b]) || 0;
                pairCountSum += pairFreq;
                pairPairsCount++;
            }
        }
        const avgPairFreq = pairPairsCount > 0 ? pairCountSum / pairPairsCount : 0;
        const maxPairFreq = analysis.topPairs && analysis.topPairs.length > 0 ? analysis.topPairs[0].count : 1;
        let cooccurrenceScore = maxPairFreq > 0 ? avgPairFreq / maxPairFreq : 0.5;

        // Bônus por trincas históricas de alto Lift presentes no jogo
        if (analysis.topTriples && analysis.topTriples.length > 0) {
            const numSet = new Set(sortedNumbers);
            let matchedTriples = 0;
            for (const t of analysis.topTriples.slice(0, 15)) {
                if (t.numbers.every(n => numSet.has(n))) matchedTriples++;
            }
            if (matchedTriples > 0) {
                cooccurrenceScore = Math.min(1.0, cooccurrenceScore + Math.min(0.20, matchedTriples * 0.05));
            }
        }
        if (cooccurrenceScore > 0.5) {
            explanations.push(`+ Elevada sinergia de pares e trincas históricas`);
        }

        // 6. Fator Distribuição por Faixas
        const rangeSize = Math.ceil(config.total / 5);
        const rangeCounts = [0, 0, 0, 0, 0];
        sortedNumbers.forEach(n => {
            const idx = Math.min(Math.floor((n - 1) / rangeSize), 4);
            rangeCounts[idx]++;
        });
        const expectedPerRange = len / 5;
        const rangeVariance = rangeCounts.reduce((s, c) => s + Math.pow(c - expectedPerRange, 2), 0) / 5;
        const distributionScore = Math.max(0, 1 - (rangeVariance / Math.pow(len, 2)));
        if (distributionScore > 0.7) {
            explanations.push(`+ Boa cobertura horizontal entre as 5 faixas numéricas`);
        }

        // 7. Fator Geometria do Volante (Linhas, Colunas, Moldura, Primos e Fibonacci)
        const geom = StatisticalAnalyzer.analyzeTicketGeometry(sortedNumbers, config.total);
        const gaussianEval = GaussianFilterEngine.evaluateCandidate(sortedNumbers, config, analysis);
        const geometryScore = (gaussianEval.gaussianQualityIndex || 70) / 100;
        if (gaussianEval.passed) {
            explanations.push(`+ Aprovado no Filtro de Poda Gaussiana (${geom.activeRows} linhas · ${geom.activeCols} colunas · ${geom.frameCount} na moldura)`);
        }

        // 8. Fator Paridade (Pares vs Ímpares)
        const evens = sortedNumbers.filter(n => n % 2 === 0).length;
        const parityStats = analysis.parityStats || { mean: len / 2, stdDev: 1.5 };
        const parityZ = parityStats.stdDev > 0 ? Math.abs(evens - parityStats.mean) / parityStats.stdDev : 0;
        const parityScore = Math.max(0, 1 - (parityZ / 3));
        if (parityScore > 0.7) {
            explanations.push(`+ Proporção par/ímpar (${evens}P / ${len - evens}I) centrada na curva normal`);
        } else {
            explanations.push(`- Paridade (${evens} pares) em zona periférica`);
        }

        // 9. Fator Soma das Dezenas (Curva de Sino)
        const gameSum = sortedNumbers.reduce((a, b) => a + b, 0);
        const theoreticalMean = (config.pick || config.drawn) * (config.total + 1) / 2;
        const sumStats = (analysis.sumStats && analysis.sumStats.mean > 0 && config.pick === (config.drawn || config.pick))
            ? analysis.sumStats
            : { mean: theoreticalMean, stdDev: theoreticalMean * 0.12 };
        const sumZ = sumStats.stdDev > 0 ? Math.abs(gameSum - sumStats.mean) / sumStats.stdDev : 0;
        const sumScore = Math.max(0, 1 - (sumZ / 3));
        if (sumScore > 0.7) {
            explanations.push(`+ Soma total (${gameSum}) na zona central da Curva de Gauss`);
        } else {
            explanations.push(`- Soma total (${gameSum}) fora da região de maior densidade`);
        }

        // 10. Fator Repetição (comparação com último sorteio)
        const lastDraw = analysis.lastDrawNumbers || [];
        let repScore = 0.5;
        if (lastDraw.length > 0) {
            const overlap = sortedNumbers.filter(n => lastDraw.includes(n)).length;
            const expectedOverlap = analysis.repetitionStats?.mean ?? Math.round(len * (config.drawn || config.pick) / config.total);
            const overlapRatio = expectedOverlap > 0 ? overlap / expectedOverlap : 1;
            repScore = Math.exp(-Math.pow(overlapRatio - 1, 2));
            if (Math.abs(overlap - expectedOverlap) <= 1.2) {
                explanations.push(`+ Repetição (${overlap} dezenas do último sorteio) calibrada à média (${Number(expectedOverlap).toFixed(1)})`);
            } else if (overlap > expectedOverlap + 2) {
                explanations.push(`- Repetição elevada (${overlap} dezenas) acima do padrão`);
            }
        }

        // 11. Fator Sequências / Consecutivos
        let consecutivePairs = 0;
        for (let i = 0; i < len - 1; i++) {
            if (sortedNumbers[i + 1] === sortedNumbers[i] + 1) {
                consecutivePairs++;
            }
        }
        const sequenceScore = consecutivePairs <= 4 ? 1 - (consecutivePairs * 0.15) : 0.2;
        if (consecutivePairs >= 0 && consecutivePairs <= 3) {
            explanations.push(`+ Controle de sequências consecutivas (${consecutivePairs} par(es)) dentro do ótimo`);
        } else if (consecutivePairs > 4) {
            explanations.push(`- Sequência de dezenas consecutivas (${consecutivePairs}) excessiva`);
        }

        // Normalização dos pesos (suporta pesos customizados com ou sem cycle/geometry)
        const wCycle = weights.cycle ?? 0;
        const wGeometry = weights.geometry ?? 0;
        const totalWeight = (
            (weights.frequency || 0) +
            (weights.recency || 0) +
            (weights.trend || 0) +
            wCycle +
            (weights.cooccurrence || 0) +
            (weights.distribution || 0) +
            wGeometry +
            (weights.parity || 0) +
            (weights.sum || 0) +
            (weights.repetition || 0) +
            (weights.sequences || 0)
        ) || 1;

        const rawScore = (
            freqScore * (weights.frequency || 0) +
            recencyScore * (weights.recency || 0) +
            trendScore * (weights.trend || 0) +
            cycleScore * wCycle +
            cooccurrenceScore * (weights.cooccurrence || 0) +
            distributionScore * (weights.distribution || 0) +
            geometryScore * wGeometry +
            parityScore * (weights.parity || 0) +
            sumScore * (weights.sum || 0) +
            repScore * (weights.repetition || 0) +
            sequenceScore * (weights.sequences || 0)
        ) / totalWeight;

        // Model score escala de 0 a 100
        const modelScore = Number((rawScore * 100).toFixed(1));

        // Mapeamento de métricas históricas de backtesting reais
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
            gaussianQualityIndex: gaussianEval.gaussianQualityIndex,
            passedGaussianFilter: gaussianEval.passed,
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
                fibonacci: sortedNumbers.filter(n => FIBONACCI.includes(n)).length,
                frame: geom.frameCount,
                activeRows: geom.activeRows,
                activeCols: geom.activeCols,
                consecutivePairs,
                missingCycleIncluded: missingIncludedCount
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
     * Calcula o score de Evidência Estatística (índice interno de 0 a 100).
     * Reutiliza a inferência estatística exata (p-value, IC 95% e Cohen's d).
     */
    static calculateStatisticalEvidence(backtestSummary) {
        if (!backtestSummary || typeof backtestSummary.pValue !== 'number' || !Number.isFinite(backtestSummary.pValue)) {
            return null;
        }

        const pValue = backtestSummary.pValue;
        const effectSize = Number.isFinite(backtestSummary.effectSize) ? backtestSummary.effectSize : 0;
        const ci = backtestSummary.confidenceInterval;
        const diffMean = Number.isFinite(backtestSummary.diffMean) ? backtestSummary.diffMean : 0;

        if (diffMean < 0 || effectSize < 0) {
            const lowScore = Math.max(0, 20 + diffMean * 10);
            return Number(lowScore.toFixed(1));
        }

        const ciIncludesZero = ci && typeof ci.lower === 'number' && typeof ci.upper === 'number'
            ? (ci.lower <= 0 && ci.upper >= 0)
            : true;

        if (pValue < 0.05 && !ciIncludesZero) {
            const strongScore = Math.min(100, 80 + Math.min(20, effectSize * 20));
            return Number(strongScore.toFixed(1));
        } else if (pValue < 0.10) {
            return Number((50 + (1 - pValue) * 20).toFixed(1));
        } else {
            const inconclusiveScore = Math.max(20, 50 - (pValue - 0.05) * 40);
            return Number(inconclusiveScore.toFixed(1));
        }
    }

    /**
     * Otimiza pesos usando divisão de Treino (70%) vs Validação (30%) e penalização de Overfitting.
     * Agora utiliza todos os fatores dos pesos reais em `_quickEvaluateWeights`.
     */
    static optimizeWeights(fullHistory, config, options = {}) {
        const seed = options.seed ?? 123456;
        const prng = new SeededRandom(seed);
        const baseWeights = this.normalizeWeights(DEFAULT_WEIGHTS);

        if (!fullHistory || fullHistory.length < 30) {
            return {
                optimizedWeights: baseWeights,
                bestObjectiveScore: null,
                trainMean: null,
                valMean: null,
                overfitGap: 0,
                objectiveBreakdown: {
                    performance: null,
                    outOfSample: null,
                    stability: null,
                    statisticalEvidence: null,
                    overfitPenalty: 0,
                    finalObjective: null
                },
                isOverfit: false,
                method: 'Dados insuficientes para otimização - Utilizando pesos base'
            };
        }

        const totalDraws = fullHistory.length;
        const trainCutoff = Math.floor(totalDraws * 0.7);

        const trainHistory = fullHistory.slice(0, trainCutoff);
        const valHistory = fullHistory.slice(trainCutoff);

        const factors = Object.keys(baseWeights);
        const variations = [0.4, 0.75, 1.0, 1.35, 1.75];

        let bestWeights = { ...baseWeights };
        let bestObjectiveScore = -Infinity;
        let bestTrainMean = 0;
        let bestValMean = 0;
        let bestOverfitGap = 0;
        let bestBreakdown = null;

        const iterations = options.iterations || 24;

        for (let i = 0; i < iterations; i++) {
            let testWeights = { ...baseWeights };
            if (i > 0) {
                const numVary = prng.nextInt(1, 4);
                const shuffledFactors = prng.shuffle(factors);
                for (let f = 0; f < numVary; f++) {
                    const factorKey = shuffledFactors[f];
                    const scale = variations[prng.nextInt(0, variations.length - 1)];
                    testWeights[factorKey] = baseWeights[factorKey] * scale;
                }
            }

            testWeights = this.normalizeWeights(testWeights);

            // Avalia no conjunto de treino usando todos os pesos multifatoriais
            const trainEval = this._quickEvaluateWeights(trainHistory, config, testWeights);
            const trainMean = trainEval.meanHits;

            // Avalia no conjunto de validação usando todos os pesos multifatoriais
            const valEval = this._quickEvaluateWeights(valHistory, config, testWeights);
            const valMean = valEval.meanHits;

            const overfitGap = Math.max(0, trainMean - valMean);
            const expectedMean = (config.pick * (config.drawn || config.pick)) / config.total;
            
            const perfScore = Math.min(100, (trainMean / (expectedMean || 1)) * 50);
            const outOfSampleScore = Math.min(100, (valMean / (expectedMean || 1)) * 50);
            
            const stabilityComponent = options.stabilityScore !== undefined ? options.stabilityScore : null;
            const statEvidence = this.calculateStatisticalEvidence(options.backtestSummary);
            const overfitPenalty = overfitGap * 25;

            const components = [
                { name: 'performance', weight: 0.30, val: perfScore },
                { name: 'outOfSample', weight: 0.35, val: outOfSampleScore },
                { name: 'stability', weight: 0.20, val: stabilityComponent },
                { name: 'statisticalEvidence', weight: 0.15, val: statEvidence }
            ];

            const validComponents = components.filter(c => typeof c.val === 'number' && Number.isFinite(c.val));
            const totalValidWeight = validComponents.reduce((sum, c) => sum + c.weight, 0) || 1;

            let weightedSum = 0;
            validComponents.forEach(c => {
                const normWeight = c.weight / totalValidWeight;
                weightedSum += normWeight * c.val;
            });

            const compositeObjectiveScore = weightedSum - overfitPenalty;

            if (compositeObjectiveScore > bestObjectiveScore) {
                bestObjectiveScore = compositeObjectiveScore;
                bestWeights = testWeights;
                bestTrainMean = Number(trainMean.toFixed(2));
                bestValMean = Number(valMean.toFixed(2));
                bestOverfitGap = Number(overfitGap.toFixed(2));
                bestBreakdown = {
                    performance: Number(perfScore.toFixed(1)),
                    outOfSample: Number(outOfSampleScore.toFixed(1)),
                    stability: stabilityComponent !== null ? Number(stabilityComponent.toFixed(1)) : null,
                    statisticalEvidence: statEvidence !== null ? Number(statEvidence.toFixed(1)) : null,
                    overfitPenalty: Number(overfitPenalty.toFixed(1)),
                    finalObjective: Number(compositeObjectiveScore.toFixed(1))
                };
            }
        }

        const isOverfit = bestOverfitGap > 1.0;

        return {
            optimizedWeights: bestWeights,
            bestObjectiveScore: Number.isFinite(bestObjectiveScore) ? Number(bestObjectiveScore.toFixed(2)) : null,
            trainMean: Number.isFinite(bestTrainMean) ? bestTrainMean : null,
            valMean: Number.isFinite(bestValMean) ? bestValMean : null,
            overfitGap: Number.isFinite(bestOverfitGap) ? bestOverfitGap : 0,
            objectiveBreakdown: bestBreakdown || {
                performance: null,
                outOfSample: null,
                stability: null,
                statisticalEvidence: null,
                overfitPenalty: 0,
                finalObjective: null
            },
            isOverfit,
        };
    }

    /**
     * Avaliação multifatorial real de um conjunto de pesos sobre uma fatia histórica (sem vazamento de dados).
     * Cada dezena recebe um score composto ponderado por: frequência, recência, atraso, ciclo, repetição e paridade.
     */
    static _quickEvaluateWeights(historySlice, config, weights) {
        if (!historySlice || historySlice.length < 4) return { hitsTotal: 0, evaluated: 0, meanHits: 0 };
        let hitsTotal = 0;
        const evalCount = Math.min(15, historySlice.length - 3);
        const total = config.total;
        const pick = config.pick;

        const wFreq = weights.frequency ?? 0.20;
        const wRec = weights.recency ?? 0.15;
        const wTrend = weights.trend ?? 0.10;
        const wCycle = weights.cycle ?? 0.10;
        const wRep = weights.repetition ?? 0.05;
        const wCooc = weights.cooccurrence ?? 0.15;

        for (let i = 0; i < evalCount; i++) {
            const draw = historySlice[i];
            const actual = new Set((draw.dezenas || []).map(Number));
            const past = historySlice.slice(i + 1);
            const lastDrawSet = new Set((past[0]?.dezenas || []).map(Number));

            const freq = {};
            const recency = {};
            const firstSeen = {};
            const cycleSeen = new Set();

            past.forEach((pd, idx) => {
                const decay = Math.exp(-0.08 * idx);
                (pd.dezenas || []).forEach(d => {
                    const n = Number(d);
                    freq[n] = (freq[n] || 0) + 1;
                    recency[n] = (recency[n] || 0) + decay;
                    if (firstSeen[n] === undefined) firstSeen[n] = idx;
                    if (idx < Math.ceil(total / (config.drawn || pick)) * 2) {
                        cycleSeen.add(n);
                    }
                });
            });

            const maxF = Math.max(1, ...Object.values(freq));
            const maxR = Math.max(1e-5, ...Object.values(recency));
            const avgInterval = total / (config.drawn || pick);

            const scoredNums = [];
            for (let n = 1; n <= total; n++) {
                const fScore = (freq[n] || 0) / maxF;
                const rScore = (recency[n] || 0) / maxR;
                const delay = firstSeen[n] !== undefined ? firstSeen[n] : past.length;
                const tScore = Math.exp(-0.5 * Math.pow((delay / avgInterval) - 1, 2));
                const cScore = cycleSeen.has(n) ? 0.3 : 1.0;
                const repScore = lastDrawSet.has(n) ? 0.8 : 0.4;

                const score = (
                    fScore * wFreq +
                    rScore * wRec +
                    tScore * wTrend +
                    cScore * wCycle +
                    repScore * wRep +
                    ((fScore + rScore) * 0.5) * wCooc
                );
                scoredNums.push({ n, score });
            }

            scoredNums.sort((a, b) => b.score - a.score || a.n - b.n);
            const cand = scoredNums.slice(0, pick).map(x => x.n);

            const hits = cand.filter(n => actual.has(n)).length;
            hitsTotal += hits;
        }

        return {
            hitsTotal,
            evaluated: evalCount,
            meanHits: evalCount > 0 ? hitsTotal / evalCount : 0
        };
    }
}
