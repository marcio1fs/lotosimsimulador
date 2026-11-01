/**
 * BayesFrequencyEngine — Estimativa bayesiana da frequência de cada dezena
 *
 * O PROBLEMA QUE ESTE MÓDULO RESOLVE
 * ----------------------------------
 * Uma dezena que saiu 6 vezes em 25 concursos tem frequência bruta de 24%.
 * Outra que saiu 40 vezes em 200 concursos tem 20%. O painel exibia as duas
 * como "frequência", sugerindo que a primeira é mais quente. Mas 6 de 25 é
 * ruído: o erro-padrão da proporção em 25 concursos é de ~8 pontos percentuais.
 * Comparar frequências brutas de amostras de tamanhos diferentes — e tratá-las
 * como se fossem a taxa verdadeira de cada dezena — é o erro de interpretação
 * que faz um sorteio justo parecer previsível.
 *
 * A SOLUÇÃO
 * ---------
 * Modelo Beta-Binomial. Cada dezena tem uma taxa latente θ (probabilidade de
 * aparecer em um concurso). A priori é Beta(α₀, β₀) centrada na taxa esperada
 * p = drawn/total. A posteriori, após k aparições em N concursos, é
 * Beta(α₀ + k, β₀ + N − k).
 *
 * A estimativa pontual é a média a posteriori:
 *
 *     θ̂ = (α₀ + k) / (α₀ + β₀ + N)
 *
 * que é um encolhimento (shrinkage) da frequência bruta em direção a p. Quanto
 * menor o histórico, mais forte o encolhimento — que é exatamente o
 * comportamento desejado: com pouca amostra, não se deve acreditar na
 * frequência bruta.
 *
 * A FORÇA DA PRIORI NÃO É INVENTADA
 * ---------------------------------
 * α₀ + β₀ = κ é estimado dos próprios dados pelo método dos momentos
 * (empirical Bayes). A variância observada entre as taxas das dezenas tem dois
 * componentes:
 *
 *     Var(observada) = Var(real entre dezenas) + Var(amostral)
 *     s²             = τ²                     + p(1−p)/N
 *
 * Se τ² ≈ 0, as dezenas são indistinguíveis e κ é levado ao máximo (a
 * estimativa colapsa em p). Se há heterogeneidade real, τ² > 0 e
 * κ = p(1−p)/τ² − 1. Nenhuma constante mágica.
 *
 * HONESTIDADE ESTATÍSTICA
 * -----------------------
 * Cada dezena recebe um intervalo de credibilidade de 95% (marginal) e um
 * intervalo corrigido para múltiplas comparações (Bonferroni: 1 − 0,05/total).
 * A pergunta "esta dezena é realmente mais quente?" só tem resposta "sim" se o
 * intervalo simultâneo excluir a taxa base. Com 60 dezenas testadas a 95%,
 * espera-se ~3 "desvios" por puro azar — o resumo reporta essa expectativa para
 * que ninguém confunda coincidência com padrão.
 *
 * Estes números NÃO preveem o próximo sorteio. Eles dizem apenas o quanto a
 * frequência observada deve ser levada a sério.
 */

import { StatisticalInference } from './statisticalInference.js';

export const BAYES_DISCLAIMER =
    'Estimativas bayesianas da frequência de cada dezena. Elas corrigem a ' +
    'leitura de amostras pequenas — não preveem o próximo sorteio.';

export class BayesFrequencyEngine {
    /** Força máxima da prior (α₀ + β₀) quando não há heterogeneidade detectável. */
    static DEFAULT_MAX_STRENGTH = 2000;

    /** Força mínima: garante que a posteriori nunca degenera na frequência bruta. */
    static DEFAULT_MIN_STRENGTH = 1;

    /**
     * Função de distribuição acumulada da Beta(a, b) em x.
     * @param {number} x
     * @param {number} a - parâmetro de forma α > 0
     * @param {number} b - parâmetro de forma β > 0
     * @returns {number} P(X ≤ x)
     */
    static betaCDF(x, a, b) {
        if (!(x > 0)) return 0;
        if (x >= 1) return 1;
        if (!(a > 0) || !(b > 0)) throw new RangeError('Beta exige a > 0 e b > 0');
        const v = StatisticalInference.regIncompleteBeta(x, a, b);
        if (!Number.isFinite(v)) return x >= 0.5 ? 1 : 0;
        return Math.min(1, Math.max(0, v));
    }

    /**
     * Quantil (inversa da CDF) da Beta(a, b): devolve x tal que P(X ≤ x) = q.
     * Bissecção sobre [0, 1] — a CDF é monótona, então a convergência é
     * garantida (não depende de derivada nem de chute inicial no suporte).
     * @param {number} q - probabilidade em (0, 1)
     * @param {number} a
     * @param {number} b
     * @returns {number}
     */
    static betaQuantile(q, a, b) {
        if (!(q > 0)) return 0;
        if (q >= 1) return 1;
        if (!(a > 0) || !(b > 0)) throw new RangeError('Beta exige a > 0 e b > 0');

        let lo = 0;
        let hi = 1;
        let mid = a / (a + b); // média como chute inicial, só para acelerar

        for (let i = 0; i < 120; i++) {
            const cdf = this.betaCDF(mid, a, b);
            if (cdf < q) lo = mid;
            else hi = mid;
            const next = 0.5 * (lo + hi);
            if (next === mid || hi - lo < 1e-15) break;
            mid = next;
        }
        return mid;
    }

    /**
     * Variância amostral (divisor n − 1).
     * @param {number[]} values
     * @returns {number}
     */
    static sampleVariance(values) {
        if (!Array.isArray(values) || values.length < 2) return 0;
        const n = values.length;
        const mean = values.reduce((s, v) => s + v, 0) / n;
        const ss = values.reduce((s, v) => s + (v - mean) ** 2, 0);
        return ss / (n - 1);
    }

    /**
     * Estimativa empírica da força da prior κ = α₀ + β₀ (método dos momentos).
     *
     * A variância das taxas observadas é decomposta em heterogeneidade real (τ²)
     * e ruído amostral binomial. τ² estimado define κ via
     * κ = p(1−p)/τ² − 1.
     *
     * @param {number[]} rates - taxas observadas (k/N) de cada dezena
     * @param {number} baselineRate - p = drawn/total
     * @param {number} drawCount - N
     * @param {object} [options]
     * @returns {{strength: number, observedVariance: number, samplingVariance: number, tau2: number, source: string}}
     */
    static estimatePriorStrength(rates, baselineRate, drawCount, options = {}) {
        const maxStrength = options.maxStrength ?? this.DEFAULT_MAX_STRENGTH;
        const minStrength = options.minStrength ?? this.DEFAULT_MIN_STRENGTH;

        const observedVariance = this.sampleVariance(rates);
        const samplingVariance = drawCount > 0 ? (baselineRate * (1 - baselineRate)) / drawCount : 0;
        const tau2 = observedVariance - samplingVariance;

        // Sem heterogeneidade detectável: as dezenas são estatisticamente
        // indistinguíveis, então a prior deve dominar (encolhimento máximo).
        const floor = 1e-12;
        if (!(tau2 > floor) || !(baselineRate > 0) || !(baselineRate < 1)) {
            return {
                strength: maxStrength,
                observedVariance,
                samplingVariance,
                tau2: Math.max(0, tau2),
                source: 'indistinguível — prior dominante'
            };
        }

        const raw = (baselineRate * (1 - baselineRate)) / tau2 - 1;
        const strength = Math.min(maxStrength, Math.max(minStrength, raw));

        return {
            strength,
            observedVariance,
            samplingVariance,
            tau2,
            source: 'empírico (método dos momentos)'
        };
    }

    /**
     * Intervalo de Wilson para uma proporção (usado só como referência bruta).
     * @param {number} k
     * @param {number} n
     * @param {number} z
     * @returns {{lower: number, upper: number}}
     */
    static wilsonInterval(k, n, z = 1.959963984540054) {
        if (!(n > 0)) return { lower: 0, upper: 1 };
        const phat = k / n;
        const z2 = z * z;
        const denom = 1 + z2 / n;
        const center = (phat + z2 / (2 * n)) / denom;
        const half = (z / denom) * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n));
        return { lower: Math.max(0, center - half), upper: Math.min(1, center + half) };
    }

    /**
     * Aplica o encolhimento bayesiano às frequências absolutas.
     *
     * @param {Object<number, number>|number[]} freqAbsolute - contagem por dezena
     * @param {object} config
     * @param {number} config.total - dezenas do volante
     * @param {number} config.drawn - dezenas sorteadas por concurso
     * @param {number} config.drawCount - número de concursos analisados
     * @param {number} [config.confidence=0.95] - nível do intervalo marginal
     * @param {number|null} [config.priorStrength=null] - força fixa de κ (null = empírica)
     * @param {number} [config.maxStrength]
     * @param {number} [config.minStrength]
     * @returns {object} resultado completo com dezenas, intervalos e veredicto
     */
    static shrink(freqAbsolute, config = {}) {
        const total = config.total;
        const drawn = config.drawn;
        const drawCount = config.drawCount ?? 0;
        const confidence = config.confidence ?? 0.95;

        if (!Number.isInteger(total) || total <= 0) {
            throw new RangeError('total deve ser um inteiro positivo');
        }
        if (!Number.isInteger(drawn) || drawn < 0 || drawn > total) {
            throw new RangeError('drawn deve estar entre 0 e total');
        }
        if (!(confidence > 0 && confidence < 1)) {
            throw new RangeError('confidence deve estar em (0, 1)');
        }

        const baselineRate = total > 0 ? drawn / total : 0;
        const N = Math.max(0, drawCount);

        // Contagens normalizadas: aceita objeto {1: k, 2: k...} ou array
        const counts = new Array(total);
        for (let n = 1; n <= total; n++) {
            const raw = Array.isArray(freqAbsolute) ? freqAbsolute[n - 1] : freqAbsolute?.[n];
            const k = N > 0 ? Math.min(N, Math.max(0, Number(raw) || 0)) : 0;
            counts[n - 1] = drawCount > 0 ? k : 0;
        }

        // κ: fixo se pedido, senão estimado dos dados
        let priorInfo;
        if (Number.isFinite(config.priorStrength)) {
            const strength = Math.max(config.minStrength ?? this.DEFAULT_MIN_STRENGTH, config.priorStrength);
            priorInfo = {
                strength,
                observedVariance: this.sampleVariance(counts.map(k => k / Math.max(1, N))),
                samplingVariance: N > 0 ? (baselineRate * (1 - baselineRate)) / N : 0,
                tau2: null,
                source: 'fixo (informado pelo chamador)'
            };
        } else {
            const rates = counts.map(k => (N > 0 ? k / N : baselineRate));
            priorInfo = this.estimatePriorStrength(rates, baselineRate, N, {
                maxStrength: config.maxStrength,
                minStrength: config.minStrength
            });
        }

        const kappa = priorInfo.strength;
        const alpha0 = kappa * baselineRate;
        const beta0 = kappa * (1 - baselineRate);
        const alpha = (1 - confidence) / 2;
        const zMarginal = StatisticalInference.normalQuantile(1 - alpha);
        const zSimultaneous = StatisticalInference.normalQuantile(1 - alpha / total);

        const numbers = new Array(total);
        for (let n = 1; n <= total; n++) {
            const k = counts[n - 1];
            const aPost = alpha0 + k;
            const bPost = beta0 + (N - k);

            const shrunkRate = aPost / (aPost + bPost);
            const credibleLower = this.betaQuantile(alpha, aPost, bPost);
            const credibleUpper = this.betaQuantile(1 - alpha, aPost, bPost);
            const credibleSimLower = this.betaQuantile(alpha / total, aPost, bPost);
            const credibleSimUpper = this.betaQuantile(1 - alpha / total, aPost, bPost);

            const rawRate = N > 0 ? k / N : 0;
            const rawInterval = this.wilsonInterval(k, Math.max(1, N), zMarginal);
            const rawSimInterval = this.wilsonInterval(k, Math.max(1, N), zSimultaneous);

            // O intervalo exibido é a UNIÃO do credível com o de Wilson.
            //
            // Motivo: quando τ̂² ≤ 0 a prior domina e o intervalo credível fica
            // estreito — mas estreito *condicionado* à hipótese de que todas as
            // dezenas têm a mesma taxa, que é justamente a hipótese em teste.
            // O intervalo de Wilson não faz essa suposição. Tomar a união
            // garante que o painel nunca exiba uma precisão que o histórico não
            // tem. Com N = 0 não há intervalo de Wilson a considerar (a
            // estimativa é a própria prior).
            const lower = N > 0 ? Math.min(credibleLower, rawInterval.lower) : credibleLower;
            const upper = N > 0 ? Math.max(credibleUpper, rawInterval.upper) : credibleUpper;
            const simLower = N > 0 ? Math.min(credibleSimLower, rawSimInterval.lower) : credibleSimLower;
            const simUpper = N > 0 ? Math.min(1, Math.max(credibleSimUpper, rawSimInterval.upper)) : credibleSimUpper;

            const probAboveBaseline = 1 - this.betaCDF(baselineRate, aPost, bPost);

            numbers[n - 1] = {
                number: n,
                count: k,
                rawRate,
                shrunkRate,
                // quanto o encolhimento moveu a estimativa (pontos percentuais)
                shrinkageApplied: rawRate - shrunkRate,
                lower,
                upper,
                simultaneousLower: simLower,
                simultaneousUpper: simUpper,
                // intervalos originais, para quem quiser auditar a união
                credibleLower,
                credibleUpper,
                rawLower: rawInterval.lower,
                rawUpper: rawInterval.upper,
                probAboveBaseline,
                // "distinguível" = intervalo exclui a taxa base
                distinguishable: lower > baselineRate || upper < baselineRate,
                distinguishableSimultaneous: simLower > baselineRate || simUpper < baselineRate
            };
        }

        const byShrunk = [...numbers].sort((x, y) => y.shrunkRate - x.shrunkRate || x.number - y.number);
        const distinguishable = numbers.filter(x => x.distinguishable);
        const distinguishableSimultaneous = numbers.filter(x => x.distinguishableSimultaneous);
        const expectedByChance = total * (1 - confidence);

        let verdict;
        if (distinguishableSimultaneous.length === 0) {
            verdict =
                distinguishable.length === 0
                    ? 'Nenhuma dezena se distingue da taxa base: as frequências observadas são compatíveis com sorteio justo.'
                    : `Nenhuma dezena sobrevive à correção para múltiplas comparações. As ${distinguishable.length} que parecem desviar-se à primeira vista (esperado ~${expectedByChance.toFixed(1)} por azar) não se sustentam.`;
        } else {
            verdict = `${distinguishableSimultaneous.length} dezena(s) com intervalo simultâneo fora da base. Atenção: com ${total} dezenas testadas a ${(confidence * 100).toFixed(0)}%, espera-se ~${expectedByChance.toFixed(1)} desvio(s) só por acaso.`;
        }

        return {
            method: 'Beta-Binomial com prior empírica (método dos momentos)',
            intervalMethod: 'união do intervalo credível com o de Wilson',
            baselineRate,
            drawCount: N,
            total,
            drawn,
            confidence,
            prior: {
                strength: kappa,
                alpha: alpha0,
                beta: beta0,
                mean: baselineRate,
                source: priorInfo.source
            },
            heterogeneity: {
                observedVariance: priorInfo.observedVariance,
                samplingVariance: priorInfo.samplingVariance,
                tau2: priorInfo.tau2
            },
            numbers,
            hot: byShrunk.slice(0, 5),
            cold: byShrunk.slice(-5).reverse(),
            summary: {
                distinguishable: distinguishable.length,
                distinguishableSimultaneous: distinguishableSimultaneous.length,
                expectedByChance,
                maxShrinkage: numbers.reduce((m, x) => Math.max(m, Math.abs(x.shrinkageApplied)), 0),
                verdict
            },
            disclaimer: BAYES_DISCLAIMER
        };
    }

    /**
     * Formata uma taxa como porcentagem pt-BR.
     * @param {number} value - fração em [0, 1]
     * @param {number} [digits=1]
     * @returns {string}
     */
    static formatPct(value, digits = 1) {
        const v = Number.isFinite(value) ? value : 0;
        return `${(v * 100).toLocaleString('pt-BR', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        })}%`;
    }
}
