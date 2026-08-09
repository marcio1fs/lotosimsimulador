/**
 * GameGenerator - Algoritmo Avançado de Geração, Diversificação e Otimização de Jogos
 */

import { StatisticalAnalyzer } from './statisticalAnalyzer.js';
import { ScoringEngine, DEFAULT_WEIGHTS } from './scoringEngine.js';
import { BacktestEngine } from './backtestEngine.js';
import { BaselineEngine } from './baselineEngine.js';
import { SeededRandom } from './prng.js';
import { MonteCarloEngine } from './monteCarloEngine.js';

export class GameGenerator {
    /**
     * Calcula o Índice de Similaridade de Jaccard entre dois jogos
     * (0 = totalmente diferentes, 1 = idênticos)
     */
    static calculateJaccardSimilarity(gameA, gameB) {
        const setA = new Set(gameA);
        const setB = new Set(gameB);
        let intersection = 0;
        setA.forEach(n => { if (setB.has(n)) intersection++; });
        const union = new Set([...gameA, ...gameB]).size;
        return union > 0 ? intersection / union : 0;
    }

    /**
     * Gera um lote de jogos diversificados e válidos
     * @param {string} type - Modalidade da loteria ('lotofacil', 'mega', 'quina', 'lotomania')
     * @param {Object} analysis - Objeto de análise estatística
     * @param {string} strategy - Estratégia ('weighted', 'hot', 'cold', 'adaptive', 'best_game', 'maximum_precision')
     * @param {Array<number>} fixed - Dezenas obrigatórias
     * @param {Array<number>} excluded - Dezenas bloqueadas
     * @param {number} count - Quantidade de jogos a gerar (padrão: 10)
     * @param {Object} config - Configuração da loteria
     * @param {Object} customWeights - Pesos customizados (opcional)
     * @param {Object} backtestSummary - Resumo de backtesting (opcional)
     */
    static generateBatch(type, analysis, strategy, fixed = [], excluded = [], count = 10, config, customWeights = null, backtestSummary = null, seed = 123456) {
        const rng = new SeededRandom(seed);
        const candidatesPool = [];
        const poolSize = Math.max(count * 8, 100);

        // Gera piscina de candidatos
        for (let i = 0; i < poolSize; i++) {
            const game = this.generateSingleCandidate(type, analysis, strategy, fixed, excluded, config, customWeights, rng);
            if (game && game.length === config.pick) {
                // Garante que é estritamente único internamente
                const unique = [...new Set(game)].sort((a, b) => a - b);
                if (unique.length === config.pick) {
                    const scoreObj = ScoringEngine.evaluateGame(unique, config, analysis, customWeights, backtestSummary);
                    candidatesPool.push({ numbers: unique, scoreObj });
                }
            }
        }

        // Ordena por score do modelo (do maior para o menor com desempate determinístico)
        candidatesPool.sort((a, b) => {
            const diff = b.scoreObj.modelScore - a.scoreObj.modelScore;
            if (Math.abs(diff) > 1e-5) return diff;
            const rawDiff = (b.scoreObj.rawScore || 0) - (a.scoreObj.rawScore || 0);
            if (Math.abs(rawDiff) > 1e-5) return rawDiff;
            return a.numbers.join(',').localeCompare(b.numbers.join(','));
        });

        // Seleciona jogos aplicando algoritmo de DIVERSIFICAÇÃO (Limite de similaridade de Jaccard < 0.80)
        const selectedGames = [];
        const maxSimilarityThreshold = config.pick > 15 ? 0.90 : 0.75; // Permite maior sobreposição se a aposta for grande (ex: Lotomania)

        for (const candidate of candidatesPool) {
            if (selectedGames.length >= count) break;

            // Verifica se o candidato é excessivamente similar a algum jogo já selecionado
            const isTooSimilar = selectedGames.some(existing => {
                const sim = this.calculateJaccardSimilarity(candidate.numbers, existing.numbers);
                return sim >= maxSimilarityThreshold;
            });

            if (!isTooSimilar) {
                selectedGames.push(candidate);
            }
        }

        // Se a regra de similaridade for muito estrita e faltar jogos, completa com os melhores candidatos restantes sem duplicação exata
        if (selectedGames.length < count) {
            for (const candidate of candidatesPool) {
                if (selectedGames.length >= count) break;
                const isExactDuplicate = selectedGames.some(existing => 
                    existing.numbers.join(',') === candidate.numbers.join(',')
                );
                if (!isExactDuplicate && !selectedGames.includes(candidate)) {
                    selectedGames.push(candidate);
                }
            }
        }

        // Se ainda assim faltar (cenário raro), gera jogos aleatórios únicos complementares
        while (selectedGames.length < count) {
            const randomGame = BaselineEngine.generateRandomGame(config);
            const scoreObj = ScoringEngine.evaluateGame(randomGame, config, analysis, customWeights, backtestSummary);
            selectedGames.push({ numbers: randomGame, scoreObj });
        }

        // Calcula coverage do portfólio
        const allNumbers = new Set();
        selectedGames.forEach(g => g.numbers.forEach(n => allNumbers.add(n)));
        const portfolioCoverage = Number((allNumbers.size / config.total * 100).toFixed(1));

        return selectedGames.map((g, idx) => ({
            id: Date.now() + idx,
            numbers: g.numbers,
            modelScore: g.scoreObj.modelScore,
            historicalPerformance: g.scoreObj.historicalPerformance,
            expectedHits: g.scoreObj.expectedHits,
            confidenceLevel: g.scoreObj.confidenceLevel,
            probabilityType: g.scoreObj.probabilityType,
            explanations: g.scoreObj.explanations,
            stats: g.scoreObj.stats,
            portfolioCoverage,
            seed: rng.seed
        }));
    }

    /**
     * Gera uma única combinação candidata baseada na estratégia
     */
    static generateSingleCandidate(type, analysis, strategy, fixed = [], excluded = [], config, customWeights = null, rng = null) {
        const total = config.total;
        const pick = config.pick;
        const { freqAbsolute, currentDelay } = analysis;

        const freqs = Object.values(freqAbsolute || {});
        const maxFreq = Math.max(...freqs) || 1;
        const minFreq = Math.min(...freqs) || 0;
        const rangeFreq = maxFreq - minFreq || 1;

        const maxDelay = Math.max(...Object.values(currentDelay || {})) || 1;

        const pool = [];
        for (let i = 1; i <= total; i++) {
            if (excluded.includes(i)) continue;
            if (fixed.includes(i)) continue;

            const f = freqAbsolute[i] || 0;
            const d = currentDelay[i] || 0;

            let weight = 1;
            switch (strategy) {
                case 'weighted':
                    weight = (f - minFreq + 1) / (rangeFreq + 1);
                    break;

                case 'hot':
                    weight = Math.pow((f - minFreq + 1) / (rangeFreq + 1), 2.5);
                    break;

                case 'cold':
                    weight = 1 - (f - minFreq) / (rangeFreq + 1);
                    break;

                case 'adaptive':
                case 'best_game':
                case 'maximum_precision':
                default:
                    // Modelo Estatístico Adaptativo Determinístico (sem aleatoriedade na pontuação base - Req 9)
                    const fNorm = rangeFreq > 0 ? (f - minFreq) / rangeFreq : 0.5;
                    const dNorm = (maxDelay || 1) > 0 ? d / (maxDelay || 1) : 0;
                    weight = (fNorm * 0.55) + (dNorm * 0.45);
                    break;
            }

            pool.push({ num: i, weight });
        }

        // Ordena a piscina por peso (determinístico)
        pool.sort((a, b) => b.weight - a.weight);

        // Seleciona dezenas combinando peso e amostragem determinística
        const selected = new Set(fixed);
        let attempts = 0;
        const activeRng = rng || new SeededRandom(123456);

        while (selected.size < pick && pool.length > 0 && attempts < 100) {
            attempts++;
            const topSliceSize = Math.min(6, pool.length);
            const randomIndex = activeRng.nextInt(0, topSliceSize - 1);
            const chosen = pool[randomIndex];

            if (chosen && !selected.has(chosen.num)) {
                selected.add(chosen.num);
                pool.splice(randomIndex, 1);
            } else if (chosen) {
                pool.splice(randomIndex, 1); // Remove dezena já selecionada
            }
        }

        // Se faltar dezenas por limites de exclusão, completa com números aleatórios determinísticos válidos
        while (selected.size < pick) {
            const randNum = activeRng.nextInt(1, total);
            if (!excluded.includes(randNum)) {
                selected.add(randNum);
            }
        }

        return [...selected].sort((a, b) => a - b);
    }

    /**
     * Distância de Similaridade Jaccard entre dois jogos
     * J(A, B) = |A ∩ B| / |A ∪ B|
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
     * Executa o Modo "MELHOR JOGO" (BEST_GAME)
     * Testa todas as janelas temporais e seleciona a janela e configuração de maior objectiveScore
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
                
                // Função objetivo: valor em validação penalizado pelo descompasso e p-value
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

        return this.generateBatch(
            config.apiName, 
            optimalAnalysis, 
            'best_game', 
            fixed, 
            excluded, 
            count, 
            config, 
            DEFAULT_WEIGHTS, 
            bestBacktest,
            seed
        );
    }

    /**
     * Executa o Modo "MÁXIMA PRECISÃO" (MAXIMUM_PRECISION)
     * Executa o pipeline completo de 15 etapas:
     * 1. Validar dados 2. Janelas 3. Backtest 4. Walk-Forward 5. Comparar Baseline 6. Inferência (p-value, Cohen d)
     * 7. Otimizar Pesos (Treino/Val/Teste) 8. Overfitting 9. Stability 10. Monte Carlo 11. Candidatos 12. Score 13. Diversificação Jaccard 14. Coverage 15. Status
     */
    static runMaximumPrecisionMode(fullHistory, config, fixed = [], excluded = [], count = 10, seed = 123456) {
        const prng = new SeededRandom(seed);

        // 1. Validação de suficiência de dados
        if (!fullHistory || fullHistory.length < 15) {
            const emptyAnalysis = StatisticalAnalyzer.analyze([], config);
            const emptyBatch = this.generateBatch(config.apiName, emptyAnalysis, 'weighted', fixed, excluded, count, config, DEFAULT_WEIGHTS, null, seed);
            emptyBatch.modelPipeline = {
                status: 'INSUFFICIENT_DATA',
                message: 'Dados estatísticos insuficientes para validação do modelo (mínimo: 15 concursos).'
            };
            return emptyBatch;
        }

        // 2 & 3 & 4. Janelas, Backtest e Walk-Forward
        const recentHistory = StatisticalAnalyzer.getWindow(fullHistory, 100);
        const analysis = StatisticalAnalyzer.analyze(recentHistory, config);

        const generatorFn = (past, cfg) => {
            const subAnalysis = StatisticalAnalyzer.analyze(past, cfg);
            const stepRng = new SeededRandom(seed + past.length);
            return this.generateSingleCandidate(cfg.apiName, subAnalysis, 'adaptive', [], [], cfg, null, stepRng);
        };

        const backtestResult = BacktestEngine.runBacktest(recentHistory, config, generatorFn, { windowSize: 30, seed });

        // 7. Otimização Determinística de Pesos (Treino 70% / Validação 30%)
        const optWeightsResult = ScoringEngine.optimizeWeights(recentHistory, config, { seed });
        const finalWeights = optWeightsResult.optimizedWeights;

        // 10. Monte Carlo (10.000 iterações determinísticas)
        const topCandidate = this.generateSingleCandidate(config.apiName, analysis, 'adaptive', fixed, excluded, config, finalWeights, prng);
        const monteCarloResult = MonteCarloEngine.simulateCandidate(topCandidate, config, 10000, { seed, history: recentHistory });

        // 11, 12, 13. Gera batch com diversificação via Similaridade Jaccard (distância <= 0.7)
        const rawBatch = this.generateBatch(config.apiName, analysis, 'maximum_precision', fixed, excluded, count * 2, config, finalWeights, backtestResult, seed);

        const diversifiedBatch = [];
        for (const candidate of rawBatch) {
            if (diversifiedBatch.length === 0) {
                diversifiedBatch.push(candidate);
            } else {
                const isTooSimilar = diversifiedBatch.some(existing => 
                    this.calculateJaccardSimilarity(existing.numbers, candidate.numbers) > 0.7
                );
                if (!isTooSimilar) {
                    diversifiedBatch.push(candidate);
                }
            }
            if (diversifiedBatch.length >= count) break;
        }

        // Se faltar por filtro de similaridade, completa com candidatos restantes
        while (diversifiedBatch.length < count && rawBatch.length > diversifiedBatch.length) {
            const remaining = rawBatch.find(r => !diversifiedBatch.includes(r));
            if (remaining) diversifiedBatch.push(remaining);
            else break;
        }

        // 14. Cobertura do Portfólio
        const portfolioCoverage = MonteCarloEngine.calculatePortfolioCoverage(diversifiedBatch, config);

        // 15. Atribuição do Status do Modelo
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

        // Anexa metadados do pipeline completo no resultado do portfólio
        diversifiedBatch.forEach((game, idx) => {
            game.portfolioCoverage = portfolioCoverage;
            if (idx === 0) game.monteCarlo = monteCarloResult;
        });

        diversifiedBatch.modelPipeline = {
            status,
            backtestResult,
            optWeightsResult,
            monteCarloResult,
            portfolioCoverage,
            seed
        };

        return diversifiedBatch;
    }
}
