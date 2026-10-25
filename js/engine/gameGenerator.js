/**
 * GameGenerator - Algoritmo Avançado de Geração, Poda Gaussiana, Fechamento Combinatório,
 * Cadeias de Markov (t-1 -> t), Teoria dos Jogos (Anti-Crowd / Prêmio Sozinho) e Otimização de Portfólio
 */

import { StatisticalAnalyzer } from './statisticalAnalyzer.js';
import { ScoringEngine, DEFAULT_WEIGHTS } from './scoringEngine.js';
import { BacktestEngine } from './backtestEngine.js';
import { BaselineEngine } from './baselineEngine.js';
import { SeededRandom } from './prng.js';
import { MonteCarloEngine } from './monteCarloEngine.js';
import { GaussianFilterEngine } from './gaussianFilterEngine.js';
import { WheelingEngine } from './wheelingEngine.js';
import { AntiCrowdEngine } from './antiCrowdEngine.js';

export class GameGenerator {
    /**
     * Distância de Similaridade Jaccard entre dois jogos
     * J(A, B) = |A ∩ B| / |A ∪ B| (0 = totalmente diferentes, 1 = idênticos)
     */
    static calculateJaccardSimilarity(gameA, gameB) {
        const setA = new Set(gameA);
        const setB = new Set(gameB);
        let intersection = 0;
        setA.forEach(n => { if (setB.has(n)) intersection++; });
        const union = setA.size + setB.size - intersection;
        return union > 0 ? intersection / union : 0;
    }

    /**
     * Gera um lote de jogos diversificados, podados por Curva de Gauss e otimizados
     */
    static generateBatch(type, analysis, strategy, fixed = [], excluded = [], count = 10, config, customWeights = null, backtestSummary = null, seed = 123456) {
        const rng = new SeededRandom(seed);
        let selectedGames = [];
        let wheelMetadata = null;

        if (strategy === 'wheeling') {
            const wheelResult = WheelingEngine.generateWheelingMatrix(
                config,
                analysis,
                fixed,
                excluded,
                count,
                customWeights,
                backtestSummary,
                seed
            );
            selectedGames = wheelResult.tickets;
            wheelMetadata = wheelResult.wheelMetadata;
        } else {
            const candidatesPool = [];
            const gaussianPassedPool = [];
            const poolSize = Math.max(count * 14, 140);

            for (let i = 0; i < poolSize; i++) {
                const game = this.generateSingleCandidate(type, analysis, strategy, fixed, excluded, config, customWeights, rng);
                if (game && game.length === config.pick) {
                    const unique = [...new Set(game)].sort((a, b) => a - b);
                    if (unique.length === config.pick) {
                        const gaussianEval = GaussianFilterEngine.evaluateCandidate(unique, config, analysis, fixed);
                        const scoreObj = ScoringEngine.evaluateGame(unique, config, analysis, customWeights, backtestSummary);
                        const antiCrowdBonus = strategy === 'anti_crowd' ? (scoreObj.antiCrowdScore || 70) * 0.35 : 0;
                        const candidateObj = {
                            numbers: unique,
                            scoreObj,
                            gaussianEval,
                            compositeRankScore: scoreObj.modelScore * 0.70 + gaussianEval.gaussianQualityIndex * 0.30 + antiCrowdBonus
                        };
                        candidatesPool.push(candidateObj);
                        if (gaussianEval.passed) {
                            gaussianPassedPool.push(candidateObj);
                        }
                    }
                }
            }

            const activePool = gaussianPassedPool.length >= count ? gaussianPassedPool : candidatesPool;

            activePool.sort((a, b) => {
                const diff = b.compositeRankScore - a.compositeRankScore;
                if (Math.abs(diff) > 1e-5) return diff;
                const mDiff = b.scoreObj.modelScore - a.scoreObj.modelScore;
                if (Math.abs(mDiff) > 1e-5) return mDiff;
                return a.numbers.join(',').localeCompare(b.numbers.join(','));
            });

            const maxSimilarityThreshold = config.pick > 15 ? 0.85 : (config.pick === 15 ? 0.72 : 0.50);

            for (const candidate of activePool) {
                if (selectedGames.length >= count) break;

                const isTooSimilar = selectedGames.some(existing => {
                    const sim = this.calculateJaccardSimilarity(candidate.numbers, existing.numbers);
                    return sim >= maxSimilarityThreshold;
                });

                if (!isTooSimilar) {
                    selectedGames.push(candidate);
                }
            }

            while (selectedGames.length < count) {
                let bestRemaining = null;
                let bestMinDistance = -1;

                for (const candidate of candidatesPool) {
                    const sig = candidate.numbers.join(',');
                    if (selectedGames.some(existing => existing.numbers.join(',') === sig)) continue;

                    let minDist = config.pick;
                    for (const existing of selectedGames) {
                        const dist = WheelingEngine.calculateHammingDistance(candidate.numbers, existing.numbers);
                        if (dist < minDist) minDist = dist;
                    }

                    const combinedMetric = minDist + (candidate.scoreObj.modelScore / 100);
                    if (combinedMetric > bestMinDistance) {
                        bestMinDistance = combinedMetric;
                        bestRemaining = candidate;
                    }
                }

                if (bestRemaining) {
                    selectedGames.push(bestRemaining);
                } else {
                    break;
                }
            }
        }

        while (selectedGames.length < count) {
            const randomGame = BaselineEngine.generateRandomGame(config, rng);
            const scoreObj = ScoringEngine.evaluateGame(randomGame, config, analysis, customWeights, backtestSummary);
            selectedGames.push({ numbers: randomGame, scoreObj });
        }

        const coverageScore = MonteCarloEngine.calculateCoverageScore(selectedGames, config);
        const diversificationScore = MonteCarloEngine.calculateDiversificationScore(selectedGames, config);
        const spaceReduction = GaussianFilterEngine.estimateSpaceReduction(config);

        const mappedGames = selectedGames.map((g, idx) => ({
            id: (seed || 123456) + idx,
            numbers: g.numbers,
            modelScore: g.scoreObj.modelScore,
            rawScore: g.scoreObj.rawScore,
            gaussianQualityIndex: g.scoreObj.gaussianQualityIndex ?? g.gaussianEval?.gaussianQualityIndex ?? 80,
            passedGaussianFilter: g.scoreObj.passedGaussianFilter ?? g.gaussianEval?.passed ?? true,
            antiCrowdScore: g.scoreObj.antiCrowdScore ?? 75,
            expectedValueMultiplier: g.scoreObj.expectedValueMultiplier ?? 1.1,
            crowdRiskLevel: g.scoreObj.crowdRiskLevel ?? 'BAIXO',
            historicalPerformance: g.scoreObj.historicalPerformance,
            expectedHits: g.scoreObj.expectedHits,
            confidenceInterval: g.scoreObj.confidenceInterval,
            pValue: g.scoreObj.pValue,
            statisticallySignificant: g.scoreObj.statisticallySignificant,
            confidenceLevel: g.scoreObj.confidenceLevel,
            probabilityType: g.scoreObj.probabilityType,
            explanations: g.scoreObj.explanations,
            stats: g.scoreObj.stats,
            coverageScore,
            diversificationScore,
            portfolioCoverage: coverageScore,
            spacePrunedPercentage: spaceReduction.prunedPercentage,
            wheelMetadata,
            seed: rng.seed
        }));

        if (wheelMetadata) {
            mappedGames.wheelMetadata = wheelMetadata;
        }
        return mappedGames;
    }

    /**
     * Gera uma única combinação candidata baseada na estratégia, customWeights, Ciclo, Markov, Anti-Crowd, Sinergia de Pares e Geometria
     */
    static generateSingleCandidate(type, analysis, strategy, fixed = [], excluded = [], config, customWeights = null, rng = null) {
        const total = config.total;
        const pick = config.pick;
        const { freqAbsolute = {}, freqWeighted = {}, currentDelay = {}, avgDelay = {}, cycleStats = {}, markovStats = {} } = analysis || {};
        const weights = { ...DEFAULT_WEIGHTS, ...(customWeights || {}) };

        const freqs = Object.values(freqAbsolute);
        const maxFreq = Math.max(1, ...freqs);
        const minFreq = Math.min(0, ...freqs);
        const rangeFreq = Math.max(1, maxFreq - minFreq);

        const weightedList = Object.values(freqWeighted);
        const maxWeighted = Math.max(1e-6, ...weightedList);

        const maxDelay = Math.max(1, ...Object.values(currentDelay));
        const lastDrawSet = new Set(analysis?.lastDrawNumbers || []);

        const pool = [];
        for (let i = 1; i <= total; i++) {
            if (excluded.includes(i)) continue;
            if (fixed.includes(i)) continue;

            const f = freqAbsolute[i] || 0;
            const d = currentDelay[i] || 0;
            const avgD = avgDelay[i] || (total / (config.drawn || pick));
            const fNorm = rangeFreq > 0 ? (f - minFreq) / rangeFreq : 0.5;
            const rNorm = maxWeighted > 0 ? (freqWeighted[i] || 0) / maxWeighted : 0.5;
            const dNorm = maxDelay > 0 ? d / maxDelay : 0;

            const delayRatio = d / Math.max(1, avgD);
            const trendScore = Math.exp(-0.5 * Math.pow(delayRatio - 1.0, 2));

            const cycleScore = cycleStats?.cycleUrgencyScore?.[i] ?? 0.35;
            const markovLift = markovStats?.markovLiftByNumber?.[i] ?? 1.0;
            const markovNorm = Math.max(0.1, Math.min(1.0, (markovLift - 0.5) / 0.8));
            const antiCrowdWeight = AntiCrowdEngine.getNumberAntiCrowdWeight(i, total);

            let weight = 1;
            switch (strategy) {
                case 'weighted':
                    weight = 0.15 + 0.85 * ((f - minFreq + 1) / (rangeFreq + 1));
                    break;

                case 'hot':
                    weight = 0.10 + 0.90 * Math.pow((f - minFreq + 1) / (rangeFreq + 1), 2.2) * (0.6 + 0.4 * rNorm);
                    break;

                case 'cold':
                    weight = 0.15 + 0.85 * ((1 - (f - minFreq) / (rangeFreq + 1)) * 0.55 + dNorm * 0.45);
                    break;

                case 'anti_crowd':
                    // Modo Prêmio Sozinho: Maximiza Valor Esperado (EV) fugindo dos números favoritos da multidão + Markov + Gauss
                    weight = (
                        antiCrowdWeight * 0.45 +
                        markovNorm * 0.20 +
                        cycleScore * 0.15 +
                        fNorm * 0.10 +
                        trendScore * 0.10
                    );
                    break;

                case 'markov':
                    // Modo Cadeia de Markov Pura + Ciclo
                    weight = (
                        markovNorm * 0.50 +
                        cycleScore * 0.20 +
                        rNorm * 0.15 +
                        fNorm * 0.15
                    );
                    break;

                case 'wheeling':
                case 'adaptive':
                case 'best_game':
                case 'maximum_precision':
                default: {
                    const wFreq = weights.frequency ?? 0.16;
                    const wRec = weights.recency ?? 0.14;
                    const wTrend = weights.trend ?? 0.10;
                    const wCycle = weights.cycle ?? 0.10;
                    const wMarkov = weights.markov ?? 0.10;
                    const wAntiCrowd = weights.antiCrowd ?? 0.07;
                    const wRep = weights.repetition ?? 0.04;
                    const repBonus = lastDrawSet.has(i) ? 0.65 : 0.45;
                    const denom = (wFreq + wRec + wTrend + wCycle + wMarkov + wAntiCrowd + wRep) || 1;

                    weight = (
                        fNorm * wFreq +
                        rNorm * wRec +
                        trendScore * wTrend +
                        cycleScore * wCycle +
                        markovNorm * wMarkov +
                        antiCrowdWeight * wAntiCrowd +
                        repBonus * wRep
                    ) / denom;
                    break;
                }
            }

            pool.push({ num: i, weight: Math.max(0.05, weight) });
        }

        pool.sort((a, b) => b.weight - a.weight || a.num - b.num);

        const selected = new Set(fixed);
        const activeRng = rng || new SeededRandom(123456);
        const { cols } = StatisticalAnalyzer.getGridDimensions(total);

        const maxAllowedEvens = config.maxPar ?? Math.ceil(pick * 0.65);
        const maxAllowedOdds = pick - (config.minPar ?? Math.floor(pick * 0.35));
        let currentEvens = [...selected].filter(n => n % 2 === 0).length;
        let currentOdds = selected.size - currentEvens;

        const sliceRatio = strategy === 'hot' ? 0.35 : 0.55;
        let attempts = 0;

        while (selected.size < pick && pool.length > 0 && attempts < 200) {
            attempts++;
            const dynamicWindow = Math.max(8, Math.min(pool.length, Math.ceil(pool.length * sliceRatio)));
            const candidateSlice = pool.slice(0, dynamicWindow);

            const adjustedWeights = candidateSlice.map(item => {
                let w = item.weight;
                const isEven = item.num % 2 === 0;

                if (isEven && currentEvens >= maxAllowedEvens) w *= 0.08;
                if (!isEven && currentOdds >= maxAllowedOdds) w *= 0.08;

                if (selected.size > 0 && analysis?.pairMatrix) {
                    let pairAcc = 0;
                    selected.forEach(s => {
                        const a = Math.min(item.num, s);
                        const b = Math.max(item.num, s);
                        pairAcc += (analysis.pairMatrix[a]?.[b] || 0);
                    });
                    const avgCooc = pairAcc / selected.size;
                    const expectedCooc = Math.max(1, (analysis.expectedFreq || 1) * ((config.drawn || pick) / total));
                    const coocBoost = Math.min(1.45, Math.max(0.75, avgCooc / expectedCooc));
                    w *= (0.75 + 0.25 * coocBoost);
                }

                if (total >= 60) {
                    if ((selected.has(item.num - 1) && selected.has(item.num - 2)) ||
                        (selected.has(item.num + 1) && selected.has(item.num + 2)) ||
                        (selected.has(item.num - 1) && selected.has(item.num + 1))) {
                        w *= 0.05;
                    }
                }

                const itemRow = Math.floor((item.num - 1) / cols);
                let sameRowCount = 0;
                selected.forEach(s => {
                    if (Math.floor((s - 1) / cols) === itemRow) sameRowCount++;
                });
                const maxPerRow = Math.ceil(pick / 3);
                if (sameRowCount >= maxPerRow) w *= 0.15;

                return Math.max(0.005, w);
            });

            const chosen = activeRng.weightedSelect(candidateSlice, adjustedWeights);
            if (chosen && !selected.has(chosen.num)) {
                selected.add(chosen.num);
                if (chosen.num % 2 === 0) currentEvens++;
                else currentOdds++;
                const idxInPool = pool.findIndex(p => p.num === chosen.num);
                if (idxInPool !== -1) pool.splice(idxInPool, 1);
            }
        }

        while (selected.size < pick) {
            const randNum = activeRng.nextInt(1, total);
            if (!excluded.includes(randNum)) {
                selected.add(randNum);
            }
        }

        return [...selected].sort((a, b) => a - b);
    }

    /**
     * Executa o Modo "MELHOR JOGO" (BEST_GAME)
     */
    static runBestGameMode(fullHistory, config, fixed = [], excluded = [], count = 10, seed = 123456) {
        const windows = [20, 50, 100, 200, 'full'];
        let bestWindow = 100;
        let bestBacktest = null;
        let highestObjectiveScore = -999;
        const prng = new SeededRandom(seed);

        windows.forEach(w => {
            const subHistory = StatisticalAnalyzer.getWindow(fullHistory, w);
            if (subHistory.length >= 15) {
                const generatorFn = (past, cfg) => {
                    const subAnalysis = StatisticalAnalyzer.analyze(past, cfg);
                    return this.generateSingleCandidate(cfg.apiName, subAnalysis, 'adaptive', [], [], cfg, null, prng);
                };
                const bt = BacktestEngine.runBacktest(subHistory, config, generatorFn, { windowSize: 30, seed });
                
                const overfitGap = bt.walkForward?.degradation || 0;
                const isSig = bt.isStatisticallySignificant ? 1.0 : 0.0;
                const objScore = bt.meanHits + isSig - 1.5 * Math.max(0, overfitGap);

                if (objScore > highestObjectiveScore) {
                    highestObjectiveScore = objScore;
                    bestWindow = w;
                    bestBacktest = bt;
                }
            }
        });

        const optimalHistory = StatisticalAnalyzer.getWindow(fullHistory, bestWindow);
        const optimalAnalysis = StatisticalAnalyzer.analyze(optimalHistory, config);
        const optWeights = ScoringEngine.optimizeWeights(optimalHistory, config, { seed, backtestSummary: bestBacktest });

        return this.generateBatch(
            config.apiName, 
            optimalAnalysis, 
            'best_game', 
            fixed, 
            excluded, 
            count, 
            config, 
            optWeights.optimizedWeights || DEFAULT_WEIGHTS, 
            bestBacktest,
            seed
        );
    }

    /**
     * Executa o Modo "MÁXIMA PRECISÃO" (MAXIMUM_PRECISION)
     */
    static runMaximumPrecisionMode(fullHistory, config, fixed = [], excluded = [], count = 10, seed = 123456) {
        const prng = new SeededRandom(seed);

        if (!fullHistory || fullHistory.length < 15) {
            const emptyAnalysis = StatisticalAnalyzer.analyze([], config);
            const emptyBatch = this.generateBatch(config.apiName, emptyAnalysis, 'weighted', fixed, excluded, count, config, DEFAULT_WEIGHTS, null, seed);
            emptyBatch.modelPipeline = {
                status: 'INSUFFICIENT_DATA',
                message: 'Dados estatísticos insuficientes para validação do modelo (mínimo: 15 concursos).'
            };
            return emptyBatch;
        }

        const recentHistory = StatisticalAnalyzer.getWindow(fullHistory, 100);
        const analysis = StatisticalAnalyzer.analyze(recentHistory, config);

        const optWeightsResult = ScoringEngine.optimizeWeights(recentHistory, config, { seed });
        const finalWeights = optWeightsResult.optimizedWeights;

        const generatorFn = (past, cfg) => {
            const subAnalysis = StatisticalAnalyzer.analyze(past, cfg);
            const stepRng = new SeededRandom(seed + past.length);
            return this.generateSingleCandidate(cfg.apiName, subAnalysis, 'maximum_precision', [], [], cfg, finalWeights, stepRng);
        };

        const backtestResult = BacktestEngine.runBacktest(recentHistory, config, generatorFn, { windowSize: 30, seed });

        const stabilityScore = backtestResult.walkForward ? backtestResult.walkForward.stabilityScore : null;
        const recalibratedOpt = ScoringEngine.optimizeWeights(recentHistory, config, {
            seed,
            stabilityScore,
            backtestSummary: backtestResult
        });

        const topCandidate = this.generateSingleCandidate(config.apiName, analysis, 'maximum_precision', fixed, excluded, config, finalWeights, prng);
        const monteCarloResult = MonteCarloEngine.simulateCandidate(topCandidate, config, 10000, { seed, history: recentHistory });

        const wheelResult = WheelingEngine.generateWheelingMatrix(
            config,
            analysis,
            fixed,
            excluded,
            count,
            finalWeights,
            backtestResult,
            seed
        );
        const rawBatch = this.generateBatch(config.apiName, analysis, 'maximum_precision', fixed, excluded, count * 2, config, finalWeights, backtestResult, seed);

        const combinedCandidates = [
            ...wheelResult.tickets.map((t, idx) => ({
                id: seed + idx,
                numbers: t.numbers,
                modelScore: t.scoreObj.modelScore,
                rawScore: t.scoreObj.rawScore,
                gaussianQualityIndex: t.gaussianEval?.gaussianQualityIndex ?? 85,
                passedGaussianFilter: t.gaussianEval?.passed ?? true,
                antiCrowdScore: t.scoreObj.antiCrowdScore ?? 78,
                expectedValueMultiplier: t.scoreObj.expectedValueMultiplier ?? 1.15,
                crowdRiskLevel: t.scoreObj.crowdRiskLevel ?? 'BAIXO',
                historicalPerformance: t.scoreObj.historicalPerformance,
                expectedHits: t.scoreObj.expectedHits,
                confidenceInterval: t.scoreObj.confidenceInterval,
                pValue: t.scoreObj.pValue,
                statisticallySignificant: t.scoreObj.statisticallySignificant,
                confidenceLevel: t.scoreObj.confidenceLevel,
                probabilityType: t.scoreObj.probabilityType,
                explanations: t.scoreObj.explanations,
                stats: t.scoreObj.stats,
                wheelMetadata: wheelResult.wheelMetadata,
                seed
            })),
            ...rawBatch
        ];

        combinedCandidates.sort((a, b) => (b.modelScore || 0) - (a.modelScore || 0));

        const diversifiedBatch = [];
        for (const candidate of combinedCandidates) {
            if (diversifiedBatch.length === 0) {
                diversifiedBatch.push(candidate);
            } else {
                const isTooSimilar = diversifiedBatch.some(existing => 
                    this.calculateJaccardSimilarity(existing.numbers, candidate.numbers) > 0.70
                );
                if (!isTooSimilar) {
                    diversifiedBatch.push(candidate);
                }
            }
            if (diversifiedBatch.length >= count) break;
        }

        while (diversifiedBatch.length < count && combinedCandidates.length > diversifiedBatch.length) {
            const remaining = combinedCandidates.find(r =>
                !diversifiedBatch.some(d => d.numbers.join(',') === r.numbers.join(','))
            );
            if (remaining) diversifiedBatch.push(remaining);
            else break;
        }

        const coverageScore = MonteCarloEngine.calculateCoverageScore(diversifiedBatch, config);
        const diversificationScore = MonteCarloEngine.calculateDiversificationScore(diversifiedBatch, config);
        const spaceReduction = GaussianFilterEngine.estimateSpaceReduction(config);

        let status = 'NOT_VALIDATED';
        if (backtestResult.diffMean <= 0) {
            status = 'BASELINE_NOT_BEATEN';
        } else if (!backtestResult.isStatisticallySignificant) {
            status = 'NOT_SIGNIFICANT';
        } else if (backtestResult.walkForward && backtestResult.walkForward.isOverfitting) {
            status = 'OVERFIT';
        } else {
            status = 'VALIDATED';
        }

        diversifiedBatch.forEach((game, idx) => {
            game.id = seed + idx;
            game.coverageScore = coverageScore;
            game.diversificationScore = diversificationScore;
            game.portfolioCoverage = coverageScore;
            game.spacePrunedPercentage = spaceReduction.prunedPercentage;
            game.wheelMetadata = wheelResult.wheelMetadata;
            if (idx === 0) game.monteCarlo = monteCarloResult;
        });

        diversifiedBatch.wheelMetadata = wheelResult.wheelMetadata;
        diversifiedBatch.modelPipeline = {
            status,
            backtestResult,
            optWeightsResult: recalibratedOpt,
            monteCarloResult,
            coverageScore,
            diversificationScore,
            portfolioCoverage: coverageScore,
            spaceReduction,
            wheelMetadata: wheelResult.wheelMetadata,
            seed
        };

        return diversifiedBatch;
    }
}
