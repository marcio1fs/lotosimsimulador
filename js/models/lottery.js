import { StatisticalAnalyzer, PRIMES } from '../engine/statisticalAnalyzer.js';
import { ScoringEngine, DEFAULT_WEIGHTS } from '../engine/scoringEngine.js';
import { GameGenerator } from '../engine/gameGenerator.js';
import { BacktestEngine } from '../engine/backtestEngine.js';
import { MonteCarloEngine } from '../engine/monteCarloEngine.js';
import { ForecastPolicy } from '../engine/forecastPolicy.js';
import { ProbabilityEngine } from '../engine/probabilityEngine.js';

/**
 * Model: Lottery - Configurações, Regras de Negócio e Pontuação Estatística
 */
export class LotteryModel {
    static CONFIG = {
        lotofacil: { name: 'Lotofácil', total: 25, pick: 15, drawn: 15, color: 'lotofacil', icon: '🟣', apiName: 'lotofacil', minPar: 6, maxPar: 9, minSum: 160, maxSum: 220 },
        mega: { name: 'Mega Sena', total: 60, pick: 6, drawn: 6, color: 'mega', icon: '🟢', apiName: 'megasena', minPar: 2, maxPar: 4, minSum: 150, maxSum: 220 },
        lotomania: { name: 'Lotomania', total: 100, pick: 50, drawn: 20, color: 'lotomania', icon: '🔴', apiName: 'lotomania', minPar: 22, maxPar: 28, minSum: 2400, maxSum: 2600 },
        quina: { name: 'Quina', total: 80, pick: 5, drawn: 5, color: 'quina', icon: '🔵', apiName: 'quina', minPar: 2, maxPar: 3, minSum: 150, maxSum: 250 }
    };

    static PRIMES = PRIMES;

    /**
     * Executa a análise estatística sobre o histórico de resultados da loteria
     * @param {Array} results - Lista de concursos
     * @param {string} type - Tipo de loteria
     * @param {number|string} timeWindow - Janela temporal (20, 50, 100, 200, 500, 'full')
     */
    static analyzeFrequencies(results, type, timeWindow = 'full') {
        const cfg = this.CONFIG[type];
        if (!cfg) return { freq: {}, atraso: {}, analysis: null };

        const windowData = StatisticalAnalyzer.getWindow(results, timeWindow);
        const fullAnalysis = StatisticalAnalyzer.analyze(windowData, cfg);
        fullAnalysis.lastDrawNumbers = results[0]?.dezenas?.map(Number) || [];

        return {
            freq: fullAnalysis.freqAbsolute,
            atraso: fullAnalysis.currentDelay,
            fullAnalysis,
            timeWindow
        };
    }

    /**
     * Valida estatisticamente um jogo candidato
     */
    static validateGame(numbers, type) {
        const cfg = this.CONFIG[type];
        const evens = numbers.filter(n => n % 2 === 0).length;
        const odds = numbers.length - evens;
        const sum = numbers.reduce((a, b) => a + b, 0);
        const primes = numbers.filter(n => this.PRIMES.includes(n)).length;

        const parOK = evens >= cfg.minPar && evens <= cfg.maxPar;
        const sumOK = sum >= (cfg.minSum || 0) && sum <= (cfg.maxSum || 9999);

        return {
            valid: parOK && sumOK,
            stats: { evens, odds, sum, primes }
        };
    }

    /**
     * Gera jogos inteligentes via GameGenerator com semente determinística
     */
    static generateSmartGames(type, fullHistory, strategy = 'weighted', fixed = [], excluded = [], count = 10, timeWindow = 'full', seed = 123456) {
        const cfg = this.CONFIG[type];
        if (!cfg) return [];

        if (strategy === 'best_game') {
            const games = GameGenerator.runBestGameMode(fullHistory, cfg, fixed, excluded, count, seed);
            return this.attachForecastPolicy(games, fullHistory, strategy, cfg);
        }

        if (strategy === 'maximum_precision') {
            const games = GameGenerator.runMaximumPrecisionMode(fullHistory, cfg, fixed, excluded, count, seed);
            return this.attachForecastPolicy(games, fullHistory, strategy, cfg);
        }

        const windowData = StatisticalAnalyzer.getWindow(fullHistory, timeWindow);
        const analysis = StatisticalAnalyzer.analyze(windowData, cfg);
        analysis.lastDrawNumbers = fullHistory[0]?.dezenas?.map(Number) || [];

        // Executa um backtest cego com semente determinística
        const generatorFn = (past, c) => {
            const pastAnalysis = StatisticalAnalyzer.analyze(past, c);
            return GameGenerator.generateSingleCandidate(c.apiName, pastAnalysis, strategy, [], [], c, null);
        };
        const backtestSummary = BacktestEngine.runBacktest(windowData, cfg, generatorFn, { windowSize: 30, seed });

        const games = GameGenerator.generateBatch(type, analysis, strategy, fixed, excluded, count, cfg, DEFAULT_WEIGHTS, backtestSummary, seed);

        // Monte Carlo determinístico para o melhor jogo
        const topGame = games[0];
        if (topGame) {
            const mcResult = MonteCarloEngine.simulateCandidate(topGame.numbers, cfg, 10000, { seed, history: windowData });
            topGame.monteCarlo = mcResult;
        }

        return this.attachForecastPolicy(games, fullHistory, strategy, cfg, backtestSummary);
    }

    static attachForecastPolicy(games, fullHistory, strategy, config, backtest = null) {
        const policy = ForecastPolicy.evaluate({
            historySize: fullHistory?.length || 0,
            backtest: backtest || games.modelPipeline?.backtestResult || null,
            strategy,
            config
        });
        games.forEach(game => {
            const theoretical = ProbabilityEngine.hypergeometric(config, game.numbers?.length || config.pick);
            game.forecastPolicy = policy;
            game.futureProjection = {
                method: theoretical.method,
                expectedHits: theoretical.expectedHits,
                predictionInterval: theoretical.predictionInterval,
                fullHitOdds: theoretical.fullHitOdds,
                cumulativeProbabilities: theoretical.cumulativeProbabilities,
                historicalValidation: backtest || games.modelPipeline?.backtestResult || null,
                disclaimer: 'Projecao estatistica do proximo sorteio, nao previsao de dezenas nem garantia de premio.'
            };
        });
        games.forecastPolicy = policy;
        if (games.modelPipeline) games.modelPipeline.forecastPolicy = policy;
        return games;
    }
}
