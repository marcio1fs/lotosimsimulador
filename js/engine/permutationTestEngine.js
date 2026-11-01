/**
 * PermutationTestEngine — o pipeline é melhor que sorteio? Teste por aleatorização
 *
 * O PROBLEMA COM O P-VALOR DO BACKTEST
 * ------------------------------------
 * O backtest compara o modelo com apostas aleatórias por concurso e devolve um
 * p-valor. Mas esse teste responde a uma pergunta fraca: "o modelo acerta mais
 * do que um bilhete sorteado ao acaso?". Como todo bilhete tem a mesma chance,
 * a resposta correta é sempre "não", e o p-valor grande não é informativo —
 * ele não distingue "o modelo não explora nada" de "o teste não tinha poder".
 *
 * A PERGUNTA CERTA
 * ----------------
 * Se o pipeline usa a ordem temporal do histórico para escolher dezenas, então
 * **destruir a ordem deve piorar o desempenho**. Isso é testável sem nenhuma
 * suposição distribucional: embaralhamos a ordem dos concursos N vezes,
 * rodamos o pipeline inteiro em cada uma e comparamos com o resultado na ordem
 * real.
 *
 *     H0: a ordem temporal não carrega informação útil
 *     estatística observada: média de acertos do pipeline na ordem real
 *     nulo: mesma estatística em históricos com ordem aleatorizada
 *     p = (1 + #{nulo ≥ observado}) / (N + 1)
 *
 * Se o observado cai no meio da distribuição nula, o pipeline **não extrai
 * nada** da ordem temporal — e isso é uma afirmação forte, verificável e fácil
 * de comunicar. Se cai na cauda alta, há evidência de estrutura que merece
 * investigação.
 *
 * POR QUE ISSO É MELHOR QUE O P-VALOR DO BACKTEST
 * -----------------------------------------------
 * O nulo é construído a partir do próprio pipeline, não de uma fórmula. Ele
 * absorve automaticamente os vícios do gerador (viés de paridade, restrições de
 * soma, janelas deslizantes) — coisas que um nulo analítico ignora e que podem
 * criar "vantagem" aparente sem nenhum sinal real.
 *
 * HONESTIDADE SOBRE O CUSTO
 * -------------------------
 * Cada iteração roda o pipeline completo sobre um histórico embaralhado. É
 * caro (segundos), por isso roda no worker e sob demanda — nunca a cada
 * geração de jogos.
 */

import { BacktestEngine } from './backtestEngine.js';
import { StatisticalAnalyzer } from './statisticalAnalyzer.js';
import { GameGenerator } from './gameGenerator.js';
import { SeededRandom } from './prng.js';

export const PERMUTATION_DISCLAIMER =
    'O teste mostra se o pipeline extrai informação da ordem temporal. ' +
    'Ele não prevê dezenas: em sorteio idôneo o resultado esperado é o observado ' +
    'cair no meio da distribuição nula.';

export class PermutationTestEngine {
    /** Valor padrão de permutações (p tem resolução de 1/(runs+1)). */
    static DEFAULT_RUNS = 99;

    /** Concursos avaliados em cada estatística. */
    static DEFAULT_WINDOW = 30;

    /**
     * Estatística padrão: média de acertos do pipeline nos últimos `windowSize`
     * concursos. Para cada concurso alvo, a análise usa **somente** o passado
     * (history.slice(i + 1)) — a mesma garantia de ausência de vazamento usada
     * pelo BacktestEngine.
     *
     * @param {Array} history - histórico ordenado do mais recente para o mais antigo
     * @param {object} config
     * @param {object} options
     * @returns {number} média de acertos
     */
    static defaultStatistic(history, config, options = {}) {
        const windowSize = Math.min(
            options.windowSize ?? this.DEFAULT_WINDOW,
            Math.max(0, history.length - 12)
        );
        if (windowSize <= 0) return 0;

        const strategy = options.strategy || 'adaptive';
        const weights = options.weights || null;
        const seed = options.seed ?? 123456;
        const pick = config.pick;

        let totalHits = 0;
        let evaluated = 0;

        for (let i = 0; i < windowSize; i++) {
            const past = history.slice(i + 1);
            const actual = history[i]?.dezenas;
            if (!Array.isArray(actual) || past.length < 12) continue;

            const pastAnalysis = StatisticalAnalyzer.analyzeFast(past, config);
            pastAnalysis.lastDrawNumbers = past[0]?.dezenas?.map(Number) || [];

            const candidate = GameGenerator.generateSingleCandidate(
                config.apiName,
                pastAnalysis,
                strategy,
                [],
                [],
                config,
                weights,
                new SeededRandom(seed + i)
            );
            const numbers = Array.isArray(candidate) ? candidate : candidate?.numbers;
            if (!Array.isArray(numbers)) continue;

            const actualSet = new Set(actual.map(Number));
            totalHits += numbers.filter(n => actualSet.has(n)).length;
            evaluated++;
        }

        return evaluated > 0 ? totalHits / evaluated : 0;
    }

    /**
     * Versão que usa o BacktestEngine completo (inclui baseline e testes),
     * mais lenta. Disponível para auditoria.
     * @param {Array} history
     * @param {object} config
     * @param {object} options
     * @returns {number}
     */
    static backtestStatistic(history, config, options = {}) {
        const generatorFn = (past, c) => {
            const pastAnalysis = StatisticalAnalyzer.analyzeFast(past, c);
            return GameGenerator.generateSingleCandidate(
                c.apiName, pastAnalysis, options.strategy || 'adaptive',
                [], [], c, options.weights || null
            );
        };
        const bt = BacktestEngine.runBacktest(history, config, generatorFn, {
            windowSize: Math.min(options.windowSize ?? this.DEFAULT_WINDOW, Math.max(0, history.length - 12)),
            seed: options.seed ?? 123456
        });
        return bt.meanHits;
    }

    /**
     * Embaralha a ordem dos concursos preservando o conteúdo de cada um.
     * @param {Array} history
     * @param {SeededRandom} rng
     * @returns {Array}
     */
    static permuteHistory(history, rng) {
        const copy = [...history];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = rng.nextInt(0, i);
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    /**
     * Quantil empírico (interpolação linear) de um vetor ordenado.
     * @param {number[]} sorted
     * @param {number} q
     * @returns {number}
     */
    static quantile(sorted, q) {
        if (!sorted.length) return 0;
        const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
        const lo = Math.floor(pos);
        const hi = Math.ceil(pos);
        if (lo === hi) return sorted[lo];
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    }

    /**
     * Executa o teste de permutação.
     *
     * @param {object} params
     * @param {Array} params.history - histórico (mais recente primeiro)
     * @param {object} params.config
     * @param {number} [params.runs=99]
     * @param {number} [params.windowSize=30]
     * @param {number} [params.seed]
     * @param {string} [params.strategy='adaptive']
     * @param {object|null} [params.weights]
     * @param {Function} [params.statisticFn] - injetável (usado nos testes)
     * @param {Function} [params.useBacktestEngine=false]
     * @returns {object} resultado completo
     */
    static run(params = {}) {
        const history = Array.isArray(params.history) ? params.history : [];
        const config = params.config;
        const runs = Math.max(9, Math.floor(params.runs ?? this.DEFAULT_RUNS));
        const windowSize = Math.max(5, Math.floor(params.windowSize ?? this.DEFAULT_WINDOW));
        const seed = params.seed ?? 123456;
        const alpha = params.alpha ?? 0.05;

        if (!config || !Number.isInteger(config.total) || !Number.isInteger(config.drawn)) {
            throw new TypeError('config inválida: total e drawn são obrigatórios');
        }
        if (history.length < 20) {
            return {
                available: false,
                reason: `Histórico insuficiente (${history.length} concursos; mínimo 20).`,
                disclaimer: PERMUTATION_DISCLAIMER
            };
        }

        const statisticFn = params.statisticFn
            || (params.useBacktestEngine ? this.backtestStatistic.bind(this) : this.defaultStatistic.bind(this));
        const statOptions = {
            windowSize,
            strategy: params.strategy || 'adaptive',
            weights: params.weights || null,
            seed
        };

        const observed = statisticFn(history, config, statOptions);

        const nullDistribution = new Array(runs);
        const rng = new SeededRandom(seed);
        for (let r = 0; r < runs; r++) {
            const permuted = this.permuteHistory(history, rng);
            nullDistribution[r] = statisticFn(permuted, config, statOptions);
        }

        // Duas caudas explícitas. A pergunta que o teste responde é "o modelo
        // aproveita a ordem?" — logo, a cauda relevante é a superior. Mas uma
        // estatística significativamente ABAIXO do nulo também é informação:
        // significa que a ordem real prejudica o modelo. Com um teste puramente
        // unilateral, esse caso seria inalcançável e o texto prometeria algo
        // impossível de acontecer.
        // Com R permutações o menor p alcançável é 1/(R+1). Se isso não for
        // menor que α, o teste é incapaz de rejeitar — independentemente dos
        // dados. Melhor avisar do que devolver um "não significativo" que na
        // verdade significa "faltou permutação".
        // 1/(R+1) < α  ⇒  R > 1/α − 1  ⇒  R ≥ ⌊1/α⌋ (20 para α = 0,05).
        const minAchievableP = 1 / (runs + 1);
        const runsNeededForAlpha = Math.floor(1 / alpha);
        const underpowered = minAchievableP >= alpha;

        const atLeastAsExtreme = nullDistribution.filter(v => v >= observed).length;
        const atMostAsExtreme = nullDistribution.filter(v => v <= observed).length;
        const pValue = (1 + atLeastAsExtreme) / (runs + 1);
        const pValueLower = (1 + atMostAsExtreme) / (runs + 1);

        const sorted = [...nullDistribution].sort((a, b) => a - b);
        const nullMean = nullDistribution.reduce((s, v) => s + v, 0) / runs;
        const nullVariance = runs > 1
            ? nullDistribution.reduce((s, v) => s + (v - nullMean) ** 2, 0) / (runs - 1)
            : 0;
        const nullSd = Math.sqrt(Math.max(0, nullVariance));
        const z = nullSd > 1e-12 ? (observed - nullMean) / nullSd : 0;

        const significant = pValue < alpha;
        const significantLower = pValueLower < alpha && observed < nullMean;
        const direction = significant && observed > nullMean
            ? 'higher'
            : (significantLower ? 'lower' : 'same');

        let verdict;
        if (underpowered) {
            verdict = `Amostra de permutações insuficiente: com ${runs} iterações o menor p alcançável é ` +
                `${minAchievableP.toFixed(3)}. O resultado não permite conclusão — use ao menos ${runsNeededForAlpha} permutações.`;
        } else if (direction === 'same') {
            verdict = `O desempenho observado (${observed.toFixed(3)} acertos) está dentro da distribuição nula ` +
                `(média ${nullMean.toFixed(3)}, p = ${pValue.toFixed(3)}). ` +
                'O pipeline NÃO extrai informação da ordem temporal do histórico — resultado esperado em sorteio idôneo.';
        } else if (direction === 'higher') {
            verdict = `O desempenho observado (${observed.toFixed(3)}) supera a distribuição nula ` +
                `(média ${nullMean.toFixed(3)}, p = ${pValue.toFixed(3)}). ` +
                'Há evidência de estrutura temporal que merece investigação — e, antes de qualquer conclusão, replicação em outra janela.';
        } else {
            verdict = `O desempenho observado (${observed.toFixed(3)}) está ABAIXO da distribuição nula ` +
                `(média ${nullMean.toFixed(3)}, p = ${pValueLower.toFixed(3)}). ` +
                'Isso indica que a ordenação real prejudica o modelo: sinal de que ele se ajusta a algo que não se repete.';
        }

        return {
            available: true,
            method: 'Teste de permutação (aleatorização da ordem temporal)',
            config: { total: config.total, drawn: config.drawn },
            runs,
            windowSize,
            seed,
            strategy: params.strategy || 'adaptive',
            alpha,
            observed: Number(observed.toFixed(6)),
            nullMean: Number(nullMean.toFixed(6)),
            nullSd: Number(nullSd.toFixed(6)),
            z: Number(z.toFixed(4)),
            pValue: Number(pValue.toFixed(6)),
            pValueLower: Number(pValueLower.toFixed(6)),
            minAchievableP: Number(minAchievableP.toFixed(6)),
            runsNeededForAlpha,
            underpowered,
            warning: underpowered
                ? `Com ${runs} permutações o menor p possível é ${minAchievableP.toFixed(3)}, que não é menor que α = ${alpha}. Use ao menos ${runsNeededForAlpha} permutações.`
                : null,
            isSignificant: significant,
            isSignificantLower: significantLower,
            direction,
            quantiles: {
                p2_5: Number(this.quantile(sorted, 0.025).toFixed(6)),
                p50: Number(this.quantile(sorted, 0.5).toFixed(6)),
                p97_5: Number(this.quantile(sorted, 0.975).toFixed(6))
            },
            nullDistribution: nullDistribution.map(v => Number(v.toFixed(6))),
            verdict,
            disclaimer: PERMUTATION_DISCLAIMER
        };
    }

    /**
     * Resumo compacto para a interface.
     * @param {object} result
     * @returns {object|null}
     */
    static summarize(result) {
        if (!result) return null;
        if (!result.available) {
            return { available: false, reason: result.reason || 'indisponível' };
        }
        return {
            available: true,
            observed: result.observed,
            nullMean: result.nullMean,
            nullSd: result.nullSd,
            pValue: result.pValue,
            pValueLower: result.pValueLower,
            isSignificant: result.isSignificant,
            direction: result.direction,
            underpowered: result.underpowered === true,
            warning: result.warning || null,
            minAchievableP: result.minAchievableP,
            runs: result.runs,
            windowSize: result.windowSize,
            quantiles: result.quantiles,
            verdict: result.verdict
        };
    }
}
