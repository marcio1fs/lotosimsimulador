/**
 * GameGenerator - Algoritmo Avançado de Geração, Diversificação e Otimização de Jogos
 */

import { StatisticalAnalyzer } from './statisticalAnalyzer.js';
import { ScoringEngine, DEFAULT_WEIGHTS } from './scoringEngine.js';
import { BacktestEngine } from './backtestEngine.js';
import { BaselineEngine } from './baselineEngine.js';
import { SeededRandom } from './prng.js';

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
    static generateBatch(type, analysis, strategy, fixed = [], excluded = [], count = 10, config, customWeights = null, backtestSummary = null) {
        const rng = new SeededRandom();
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

        // Ordena por score do modelo (do maior para o menor)
        candidatesPool.sort((a, b) => b.scoreObj.modelScore - a.scoreObj.modelScore);

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
                    // Modelo Estatístico Adaptativo: equilibra alta frequência, recência e retorno de atrasos moderados
                    const fNorm = (f - minFreq) / rangeFreq;
                    const dNorm = d / (maxDelay || 1);
                    weight = (fNorm * 0.45) + (dNorm * 0.35) + ((rng ? rng.next() : Math.random()) * 0.20);
                    break;
            }

            pool.push({ num: i, weight });
        }

        // Ordena a piscina por peso
        pool.sort((a, b) => b.weight - a.weight);

        // Seleciona dezenas combinando peso e aleatoriedade controlada
        const selected = new Set(fixed);
        let attempts = 0;

        while (selected.size < pick && pool.length > 0 && attempts < 100) {
            attempts++;
            const topSliceSize = Math.min(6, pool.length);
            const randomIndex = Math.floor((rng ? rng.next() : Math.random()) * topSliceSize);
            const chosen = pool[randomIndex];

            if (chosen && !selected.has(chosen.num)) {
                selected.add(chosen.num);
                pool.splice(randomIndex, 1);
            } else if (chosen) {
                pool.splice(randomIndex, 1); // Remove already-selected number from pool
            }
        }

        // Se faltar dezenas por limites de exclusão, completa com números aleatórios válidos
        while (selected.size < pick) {
            const randNum = Math.floor((rng ? rng.next() : Math.random()) * total) + 1;
            if (!excluded.includes(randNum)) {
                selected.add(randNum);
            }
        }

        return [...selected].sort((a, b) => a - b);
    }

    /**
     * Executa o Modo "MELHOR JOGO" (BEST_GAME)
     * Testa todas as janelas temporais e seleciona a janela e configuração de maior desempenho no backtest
     */
    static runBestGameMode(fullHistory, config, fixed = [], excluded = [], count = 10) {
        const windows = [20, 50, 100, 200, 500, 'full'];
        let bestWindow = 100;
        let bestBacktest = null;
        let highestDiff = -999;

        // Avalia qual janela temporal performou melhor em backtests cegos
        windows.forEach(w => {
            const subHistory = StatisticalAnalyzer.getWindow(fullHistory, w);
            if (subHistory.length >= 15) {
                const generatorFn = (past, cfg) => {
                    const subAnalysis = StatisticalAnalyzer.analyze(past, cfg);
                    return this.generateSingleCandidate(cfg.apiName, subAnalysis, 'adaptive', [], [], cfg);
                };
                const bt = BacktestEngine.runBacktest(subHistory, config, generatorFn, { windowSize: 30 });
                if (bt.diffMean > highestDiff) {
                    highestDiff = bt.diffMean;
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
            bestBacktest
        );
    }

    /**
     * Executa o Modo "MÁXIMA PRECISÃO" (MAXIMUM_PRECISION)
     * Prioriza estabilidade, histórico recente, validação walk-forward e rejeição de overfitting
     */
    static runMaximumPrecisionMode(fullHistory, config, fixed = [], excluded = [], count = 10) {
        // Usa janela de recência calibrada (ex: últimos 100 concursos)
        const recentHistory = StatisticalAnalyzer.getWindow(fullHistory, 100);
        const analysis = StatisticalAnalyzer.analyze(recentHistory, config);

        const generatorFn = (past, cfg) => {
            const subAnalysis = StatisticalAnalyzer.analyze(past, cfg);
            return this.generateSingleCandidate(cfg.apiName, subAnalysis, 'adaptive', [], [], cfg);
        };

        const backtestResult = BacktestEngine.runBacktest(recentHistory, config, generatorFn, { windowSize: 40 });

        // Ajusta pesos se houver indicativo de overfitting na validação walk-forward
        const precisionWeights = { ...DEFAULT_WEIGHTS };
        if (backtestResult.walkForward && backtestResult.walkForward.isOverfitting) {
            // Suaviza o peso da frequência histórica para evitar overfitting passado
            precisionWeights.frequency = 0.10;
            precisionWeights.recency = 0.25; // Prioriza recência
            precisionWeights.parity = 0.15;
            precisionWeights.sum = 0.15;
        }

        return this.generateBatch(
            config.apiName, 
            analysis, 
            'maximum_precision', 
            fixed, 
            excluded, 
            count, 
            config, 
            precisionWeights, 
            backtestResult
        );
    }
}
