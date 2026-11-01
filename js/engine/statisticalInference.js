/**
 * StatisticalInference - Módulo de Inferência Estatística Rigorosa
 * Fornece cálculos estatísticos exatos sem aproximações fictícias ou valores hardcoded.
 * Inclui:
 * - Aproximação de Lanczos para log-gama ln(Γ(x))
 * - Função Beta Incompleta Regularizada Ix(a,b) por frações continuadas de Lentz
 * - CDF exata e Quantil da distribuição t de Student e Normal Z
 * - Intervalo de Confiança dinâmico (Student-t para n < 30, Normal Z para n >= 30)
 * - Teste t pareado exato com p-value exato e tamanho de efeito (Cohen's d)
 * - Bootstrap determinístico por reamostragem com SeededRandom
 */

import { SeededRandom } from './prng.js';

export class StatisticalInference {
    /**
     * Logaritmo natural da função Gama ln(Γ(x)) usando aproximação de Lanczos (g=7, n=9)
     */
    static logGamma(x) {
        if (x <= 0) return 0;
        const p = [
            0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
            12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
        ];
        if (x < 0.5) {
            return Math.log(Math.PI / Math.sin(Math.PI * x)) - this.logGamma(1 - x);
        }
        x -= 1;
        let a = p[0];
        const t = x + 7.5;
        for (let i = 1; i < p.length; i++) {
            a += p[i] / (x + i);
        }
        return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
    }

    /**
     * Função Beta Incompleta Regularizada Ix(a, b) usando fração continuada de Lentz
     */
    static regIncompleteBeta(x, a, b) {
        if (x <= 0) return 0;
        if (x >= 1) return 1;

        // Propriedade de simetria para melhor convergência
        if (x > (a + 1) / (a + b + 2)) {
            return 1 - this.regIncompleteBeta(1 - x, b, a);
        }

        const front =
            Math.exp(
                a * Math.log(x) + b * Math.log(1 - x) - (this.logGamma(a) + this.logGamma(b) - this.logGamma(a + b))
            ) / a;

        // Fração continuada de Lentz para 1 / (1 + d1 / (1 + d2 / ...))
        const maxIter = 200;
        const tiny = 1e-30;
        let f = 1.0;
        let c = 1.0;
        let d = 0;

        for (let m = 1; m <= maxIter; m++) {
            let num;
            if (m % 2 === 0) {
                const k = m / 2;
                num = (k * (b - k) * x) / ((a + 2 * k - 1) * (a + 2 * k));
            } else {
                const k = (m - 1) / 2;
                num = -((a + k) * (a + b + k) * x) / ((a + 2 * k) * (a + 2 * k + 1));
            }

            d = 1.0 + num * d;
            if (Math.abs(d) < tiny) d = tiny;
            d = 1.0 / d;

            c = 1.0 + num / c;
            if (Math.abs(c) < tiny) c = tiny;

            const delta = c * d;
            f *= delta;

            if (Math.abs(delta - 1.0) < 1e-12) break;
        }

        return front / f;
    }

    /**
     * CDF da distribuição t de Student F(t; df)
     */
    static studentTCDF(t, df) {
        if (df <= 0) return 0.5;
        const x = df / (df + t * t);
        const ibeta = this.regIncompleteBeta(x, df / 2, 0.5);
        return t >= 0 ? 1 - 0.5 * ibeta : 0.5 * ibeta;
    }

    /**
     * Valor crítico da distribuição t de Student (t_crit) para nível de confiança e graus de liberdade
     */
    static studentTCriticalValue(confidenceLevel, df) {
        if (df >= 1000) return this.normalZCriticalValue(confidenceLevel);
        const alpha = 1 - confidenceLevel;
        const targetCDF = 1 - alpha / 2;

        // Busca por Bissecção + Newton-Raphson
        let low = 0;
        let high = 10.0;
        let t = 2.0;

        for (let i = 0; i < 40; i++) {
            const cdf = this.studentTCDF(t, df);
            const err = cdf - targetCDF;
            if (Math.abs(err) < 1e-8) break;

            if (cdf < targetCDF) low = t;
            else high = t;

            t = (low + high) / 2;
        }
        return t;
    }

    /**
     * Logaritmo da função Beta ln(B(a,b)) = lnΓ(a) + lnΓ(b) - lnΓ(a+b)
     */
    static logBeta(a, b) {
        return this.logGamma(a) + this.logGamma(b) - this.logGamma(a + b);
    }

    /**
     * Função Gama Incompleta Regularizada Inferior P(a, x), por série (x < a + 1)
     * e fração continuada de Lentz (x >= a + 1). Precisão ~1e-15 relativa.
     */
    static regularizedGammaP(a, x) {
        if (!(a > 0) || !Number.isFinite(x)) return NaN;
        if (x <= 0) return 0;
        if (x < a + 1) {
            let ap = a;
            let term = 1 / a;
            let sum = term;
            for (let n = 0; n < 1000; n++) {
                ap += 1;
                term *= x / ap;
                sum += term;
                if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
            }
            return sum * Math.exp(-x + a * Math.log(x) - this.logGamma(a));
        }
        return 1 - this.regularizedGammaQ(a, x);
    }

    /**
     * Função Gama Incompleta Regularizada Superior Q(a, x) = 1 - P(a, x)
     */
    static regularizedGammaQ(a, x) {
        if (!(a > 0) || !Number.isFinite(x)) return NaN;
        if (x <= 0) return 1;
        if (x < a + 1) return 1 - this.regularizedGammaP(a, x);

        const tiny = 1e-300;
        let b = x + 1 - a;
        let c = 1 / tiny;
        let d = 1 / b;
        let h = d;
        for (let i = 1; i <= 1000; i++) {
            const an = -i * (i - a);
            b += 2;
            d = an * d + b;
            if (Math.abs(d) < tiny) d = tiny;
            c = b + an / c;
            if (Math.abs(c) < tiny) c = tiny;
            d = 1 / d;
            const delta = d * c;
            h *= delta;
            if (Math.abs(delta - 1) < 1e-16) break;
        }
        return Math.exp(-x + a * Math.log(x) - this.logGamma(a)) * h;
    }

    /**
     * CDF exata da distribuição Chi-Quadrado (sem aproximação de Wilson-Hilferty)
     */
    static chiSquareCDF(chiSq, df) {
        if (!(df > 0)) return NaN;
        if (chiSq <= 0) return 0;
        return this.regularizedGammaP(df / 2, chiSq / 2);
    }

    /**
     * p-value exato do teste Chi-Quadrado: P(χ²_df >= chiSq)
     */
    static chiSquareSurvival(chiSq, df) {
        if (!(df > 0)) return NaN;
        if (chiSq <= 0) return 1;
        return this.regularizedGammaQ(df / 2, chiSq / 2);
    }

    /**
     * Cauda superior exata da Binomial: P(X >= k) para X ~ Binomial(n, p)
     * P(X >= k) = I_p(k, n - k + 1)
     */
    static binomialUpperTail(k, n, p) {
        if (!Number.isFinite(n) || n < 0) return NaN;
        if (k <= 0) return 1;
        if (k > n) return 0;
        if (p <= 0) return 0;
        if (p >= 1) return 1;
        const pv = this.regIncompleteBeta(p, k, n - k + 1);
        return Number.isFinite(pv) ? Math.max(0, Math.min(1, pv)) : NaN;
    }

    /**
     * Cauda inferior exata da Binomial: P(X <= k)
     */
    static binomialLowerTail(k, n, p) {
        if (k < 0) return 0;
        if (k >= n) return 1;
        return Math.max(0, Math.min(1, 1 - this.binomialUpperTail(k + 1, n, p)));
    }

    /**
     * Teste Binomial exato (unilateral ou bilateral) - p-value por inversão da
     * distribuição, escolhendo o lado da hipótese alternativa observada.
     * @param {number} k - sucessos observados
     * @param {number} n - tentativas
     * @param {number} p0 - probabilidade nula (ex.: drawn / total)
     * @param {'greater'|'less'|'two-sided'} alternative
     */
    static binomialTest(k, n, p0, alternative = 'greater') {
        if (!(n > 0) || !(p0 > 0) || !(p0 < 1)) {
            return { k, n, p0, alternative, pValue: null, significant: false };
        }
        const kk = Math.max(0, Math.min(n, Math.round(k)));
        let pValue;
        if (alternative === 'greater') {
            pValue = this.binomialUpperTail(kk, n, p0);
        } else if (alternative === 'less') {
            pValue = this.binomialLowerTail(kk, n, p0);
        } else {
            // bilateral exato por duplicação do lado observado (conservador, limitado a 1)
            const lower = this.binomialLowerTail(kk, n, p0);
            const upper = this.binomialUpperTail(kk, n, p0);
            pValue = Math.min(1, 2 * Math.min(lower, upper));
        }
        if (!Number.isFinite(pValue)) pValue = 1;
        return {
            k: kk,
            n,
            p0: Number(p0.toFixed(6)),
            alternative,
            observedRate: Number((kk / n).toFixed(6)),
            lift: Number((kk / n / p0).toFixed(4)),
            pValue: Number(Math.max(1e-16, Math.min(1, pValue)).toFixed(10))
        };
    }

    /**
     * Correção de Benjamini-Hochberg (controle de FDR) sobre uma lista de p-values.
     * Retorna q-values na mesma ordem da entrada, mais a lista de rejeições.
     */
    static benjaminiHochberg(pValues, alpha = 0.05, familySize = null) {
        const k = Array.isArray(pValues) ? pValues.length : 0;
        // familySize permite informar o total REAL de hipóteses testadas (ex.: todos os
        // pares possíveis) quando só as mais promissoras foram materializadas. Isso torna
        // o q-value conservador — nunca otimista.
        const m = Number.isFinite(familySize) && familySize > k ? familySize : k;
        if (k === 0) return { qValues: [], rejected: [], alpha, m: 0, threshold: 0 };

        const cleaned = pValues.map((p, i) => ({
            i,
            p: Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 1
        }));
        cleaned.sort((a, b) => a.p - b.p || a.i - b.i);

        const qValues = new Array(k).fill(1);
        let running = 1;
        let threshold = 0;
        for (let r = k; r >= 1; r--) {
            const { i, p } = cleaned[r - 1];
            running = Math.min(running, (p * m) / r);
            qValues[i] = Number(running.toFixed(10));
        }
        // maior p tal que p <= alpha * r / m
        for (let r = k; r >= 1; r--) {
            if (cleaned[r - 1].p <= (alpha * r) / m) {
                threshold = cleaned[r - 1].p;
                break;
            }
        }
        const rejected = cleaned.map(entry => qValues[entry.i] <= alpha);
        return {
            qValues,
            rejected,
            alpha,
            m,
            threshold: Number(threshold.toFixed(10))
        };
    }

    /**
     * Quantil da Normal Padrão (inverso da CDF) - algoritmo de Acklam, erro relativo < 1.15e-9
     */
    static normalQuantile(p) {
        if (!(p > 0) || !(p < 1)) {
            if (p === 0) return -Infinity;
            if (p === 1) return Infinity;
            return NaN;
        }
        const a = [
            -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1,
            2.506628277459239
        ];
        const b = [
            -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1
        ];
        const c = [
            -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968,
            2.938163982698783
        ];
        const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
        const pLow = 0.02425;
        const pHigh = 1 - pLow;

        if (p < pLow) {
            const q = Math.sqrt(-2 * Math.log(p));
            return (
                (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
                ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
            );
        }
        if (p > pHigh) {
            const q = Math.sqrt(-2 * Math.log(1 - p));
            return (
                -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
                ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
            );
        }
        const q = p - 0.5;
        const r = q * q;
        return (
            ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
        );
    }

    /**
     * Menor efeito detectável (MDE) para um teste de média com n observações,
     * desvio-padrão sd, nível alpha e poder desejado (unilateral).
     * Responde: "quantos acertos de vantagem este backtest conseguiria enxergar?"
     */
    static minimumDetectableEffect(n, sd, alpha = 0.05, power = 0.8, oneSided = true) {
        if (!(n > 1) || !(sd > 0)) return null;
        const zAlpha = this.normalQuantile(1 - (oneSided ? alpha : alpha / 2));
        const zPower = this.normalQuantile(power);
        return Number((((zAlpha + zPower) * sd) / Math.sqrt(n)).toFixed(4));
    }

    /**
     * Tamanho de amostra necessário para detectar um efeito com dado poder.
     */
    static requiredSampleSize(sd, effect, alpha = 0.05, power = 0.8, oneSided = true) {
        if (!(sd > 0) || !(Math.abs(effect) > 0)) return null;
        const zAlpha = this.normalQuantile(1 - (oneSided ? alpha : alpha / 2));
        const zPower = this.normalQuantile(power);
        return Math.ceil(Math.pow(((zAlpha + zPower) * sd) / Math.abs(effect), 2));
    }

    /**
     * Poder estatístico obtido de um teste com efeito observado e n amostras.
     */
    static observedPower(effect, n, sd, alpha = 0.05, oneSided = true) {
        if (!(n > 1) || !(sd > 0)) return null;
        const zAlpha = this.normalQuantile(1 - (oneSided ? alpha : alpha / 2));
        const lambda = Math.abs(effect) / (sd / Math.sqrt(n)) - zAlpha;
        const power = this.normalCDF(lambda);
        if (!Number.isFinite(power)) return null;
        return Number(Math.max(0, Math.min(1, power)).toFixed(4));
    }

    /**
     * CDF da Distribuição Normal Padrão Z
     */
    static normalCDF(z) {
        return 0.5 * (1 + this.erf(z / Math.SQRT2));
    }

    /**
     * Função Erro erf(x)
     */
    static erf(x) {
        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x);
        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061405429;
        const p = 0.3275911;

        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
        return sign * y;
    }

    /**
     * Valor crítico Z da distribuição Normal Padrão (ex: 1.96 para 95%)
     */
    static normalZCriticalValue(confidenceLevel) {
        const alpha = 1 - confidenceLevel;
        const p = 1 - alpha / 2;

        // Aproximação de Odeh e Evans para quantil normal
        const q = p - 0.5;
        if (Math.abs(q) < 0.42) {
            const r = q * q;
            return (
                (q * (((-25.44106049637 * r + 41.39119773534) * r - 18.61500062529) * r + 2.50662823884)) /
                ((((3.13082909833 * r - 21.06224101826) * r + 31.3082909833) * r - 16.08378514874) * r + 1.0)
            );
        } else {
            const r = p < 0.5 ? p : 1 - p;
            const y = Math.sqrt(-2.0 * Math.log(r));
            const z = y - (2.30753 + 0.27061 * y) / (1.0 + (0.99229 + 0.04481 * y) * y);
            return p < 0.5 ? -z : z;
        }
    }

    /**
     * Teste Z de uma amostra contra um valor esperado teórico conhecido (ex.: média
     * hipergeométrica de acertos de uma aposta aleatória). Ao contrário do teste
     * pareado contra uma única aposta aleatória, o desvio-padrão aqui é o ANALÍTICO,
     * o que elimina o ruído de amostragem da baseline e aumenta muito a precisão
     * para detectar (ou descartar) vantagem real.
     * @param {number[]} values - acertos observados
     * @param {number} expectedMean - média sob H0 (ex.: pick * drawn / total)
     * @param {number} theoreticalSd - desvio-padrão sob H0 (hipergeométrico)
     */
    static zTestVersusExpected(values, expectedMean, theoreticalSd, alpha = 0.05) {
        const n = Array.isArray(values) ? values.length : 0;
        if (n < 2 || !(theoreticalSd > 0)) {
            return { n, mean: null, expectedMean, z: null, pValue: 1, alpha, statisticallySignificant: false };
        }
        const mean = values.reduce((a, b) => a + b, 0) / n;
        const se = theoreticalSd / Math.sqrt(n);
        const z = (mean - expectedMean) / se;
        const pOne = 1 - this.normalCDF(z);
        const pTwo = 2 * (1 - this.normalCDF(Math.abs(z)));
        return {
            n,
            mean: Number(mean.toFixed(6)),
            expectedMean: Number(expectedMean.toFixed(6)),
            excess: Number((mean - expectedMean).toFixed(6)),
            excessPercent: expectedMean > 0 ? Number((((mean - expectedMean) / expectedMean) * 100).toFixed(2)) : null,
            theoreticalSd: Number(theoreticalSd.toFixed(6)),
            standardError: Number(se.toFixed(6)),
            z: Number(z.toFixed(4)),
            pValue: Number(Math.max(1e-16, Math.min(1, pOne)).toFixed(10)),
            pValueTwoSided: Number(Math.max(0, Math.min(1, pTwo)).toFixed(10)),
            alpha,
            statisticallySignificant: pOne < alpha && mean > expectedMean,
            minimumDetectableEffect: this.minimumDetectableEffect(n, theoreticalSd, alpha, 0.8, true),
            observedPower: this.observedPower(mean - expectedMean, n, theoreticalSd, alpha, true)
        };
    }

    /**
     * Calcula métricas estatísticas descritivas básicas
     */
    static calculateStats(values) {
        if (!values || values.length === 0) {
            return {
                sampleSize: 0,
                mean: null,
                median: null,
                variance: null,
                standardDeviation: null,
                standardError: null
            };
        }

        const n = values.length;
        const sorted = [...values].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        const mean = sum / n;

        const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];

        if (n < 2) {
            return {
                sampleSize: 1,
                mean: Number(mean.toFixed(4)),
                median: Number(median.toFixed(4)),
                variance: 0,
                standardDeviation: 0,
                standardError: 0
            };
        }

        // Variância amostral (N - 1)
        const variance = sorted.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (n - 1);
        const standardDeviation = Math.sqrt(variance);
        const standardError = standardDeviation / Math.sqrt(n);

        return {
            sampleSize: n,
            mean: Number(mean.toFixed(4)),
            median: Number(median.toFixed(4)),
            variance: Number(variance.toFixed(4)),
            standardDeviation: Number(standardDeviation.toFixed(4)),
            standardError: Number(standardError.toFixed(4))
        };
    }

    /**
     * Calcula Intervalo de Confiança dinâmico (Student-t para n < 30, Normal Z para n >= 30)
     */
    static confidenceInterval(values, confidenceLevel = 0.95) {
        const stats = this.calculateStats(values);
        if (stats.sampleSize < 2 || stats.standardError === 0) {
            if (stats.sampleSize === 0) return null;
            return {
                mean: stats.mean,
                standardDeviation: 0,
                standardError: 0,
                confidenceLevel,
                lower: stats.mean,
                upper: stats.mean,
                margin: 0,
                sampleSize: stats.sampleSize,
                method: 'Insuficiente'
            };
        }

        const n = stats.sampleSize;
        const df = n - 1;
        const isSmallSample = n < 30;
        const method = isSmallSample ? 'Student-t' : 'Normal Z';

        const critValue = isSmallSample
            ? this.studentTCriticalValue(confidenceLevel, df)
            : this.normalZCriticalValue(confidenceLevel);

        const margin = critValue * stats.standardError;
        const lower = stats.mean - margin;
        const upper = stats.mean + margin;

        return {
            mean: stats.mean,
            standardDeviation: stats.standardDeviation,
            standardError: stats.standardError,
            confidenceLevel,
            lower: Number(lower.toFixed(4)),
            upper: Number(upper.toFixed(4)),
            margin: Number(margin.toFixed(4)),
            sampleSize: n,
            method,
            df
        };
    }

    /**
     * Teste t Pareado exato com p-value e Cohen's d
     */
    static pairedTTest(modelHits, baselineHits, alpha = 0.05) {
        const n = Math.min(modelHits ? modelHits.length : 0, baselineHits ? baselineHits.length : 0);
        if (n < 5) {
            return {
                modelMean: null,
                baselineMean: null,
                difference: null,
                relativeImprovement: '0.0%',
                tStatistic: 0,
                df: 0,
                pValue: 1.0,
                alpha,
                statisticallySignificant: false,
                effectSize: 0,
                effectDescriptor: 'Insuficiente',
                conclusion: 'Dados estatísticos insuficientes para realizar teste estatístico.'
            };
        }

        const modelSlice = modelHits.slice(0, n);
        const baselineSlice = baselineHits.slice(0, n);
        const modelStats = this.calculateStats(modelSlice);
        const baselineStats = this.calculateStats(baselineSlice);

        // Estatísticas calculadas SEM arredondamento (o arredondamento prévio
        // degradava a precisão do t e, consequentemente, do p-value).
        const diffs = new Array(n);
        let rawMean = 0;
        for (let i = 0; i < n; i++) {
            const d = Number(modelSlice[i]) - Number(baselineSlice[i]);
            diffs[i] = d;
            rawMean += d;
        }
        rawMean /= n;

        let ssq = 0;
        for (let i = 0; i < n; i++) ssq += Math.pow(diffs[i] - rawMean, 2);
        const rawVariance = n > 1 ? ssq / (n - 1) : 0;
        const rawSd = Math.sqrt(rawVariance);
        const seDiff = rawSd / Math.sqrt(n);
        const meanDiff = rawMean;
        const df = n - 1;

        const mde = this.minimumDetectableEffect(
            n,
            rawSd > 0 ? rawSd : Math.sqrt(rawVariance + 1e-12),
            alpha,
            0.8,
            true
        );

        if (!(seDiff > 0) || !Number.isFinite(seDiff)) {
            // Variância nula: o teste t é degenerado. Em vez de inventar
            // p = 0.0001 (falso positivo garantido), aplica-se o teste de sinais
            // (binomial exato), que é válido para diferenças constantes.
            const positives = diffs.filter(d => d > 0).length;
            const negatives = diffs.filter(d => d < 0).length;
            const effective = positives + negatives;
            const isModelBetter = meanDiff > 0;
            const signP =
                effective > 0
                    ? isModelBetter
                        ? this.binomialUpperTail(positives, effective, 0.5)
                        : this.binomialUpperTail(negatives, effective, 0.5)
                    : 1;
            const signPV = Number(Math.max(1e-16, Math.min(1, signP)).toFixed(10));
            return {
                modelMean: modelStats.mean,
                baselineMean: baselineStats.mean,
                difference: Number(meanDiff.toFixed(4)),
                relativeImprovement:
                    baselineStats.mean > 0 ? `${((meanDiff / baselineStats.mean) * 100).toFixed(2)}%` : '0.0%',
                tStatistic: 0,
                df,
                pValue: signPV,
                pValueTwoSided: signPV,
                alpha,
                statisticallySignificant: signPV < alpha && meanDiff > 0,
                effectSize: isModelBetter ? 1.0 : 0,
                effectDescriptor: isModelBetter ? 'Constante' : 'Nulo',
                method: 'Teste de sinais (variância nula)',
                minimumDetectableEffect: mde,
                observedPower: signPV < alpha ? 1 : null,
                conclusion: isModelBetter
                    ? `Diferenças de acerto constantes (+${meanDiff.toFixed(2)} por concurso); teste t degenerado, teste de sinais exato com p=${signPV}.`
                    : 'Desempenho equivalente à baseline (diferenças nulas).'
            };
        }

        const tStat = meanDiff / seDiff;

        // p-value unilateral (Modelo > Baseline) usando CDF de t de Student exata
        const pValueOneTailed = 1 - this.studentTCDF(tStat, df);
        const pValueTwoSided = tStat === 0 ? 1 : 2 * (1 - this.studentTCDF(Math.abs(tStat), df));
        const pValue = Number(Math.max(1e-16, Math.min(1.0, pValueOneTailed)).toFixed(10));

        const statisticallySignificant = pValue < alpha && meanDiff > 0;

        // Cohen's d para amostras pareadas: d = meanDiff / s_diff
        const cohensD = rawSd > 0 ? meanDiff / rawSd : 0;
        const absD = Math.abs(cohensD);
        let effectDescriptor = 'Desprezível';
        if (absD >= 0.8) effectDescriptor = 'Grande';
        else if (absD >= 0.5) effectDescriptor = 'Médio';
        else if (absD >= 0.2) effectDescriptor = 'Pequeno';

        const observedPower = this.observedPower(meanDiff, n, rawSd, alpha, true);

        let conclusion;
        if (statisticallySignificant) {
            conclusion = `Existe evidência estatística significativa (p=${pValue} < ${alpha}) de que o modelo supera a baseline aleatória.`;
        } else if (meanDiff > 0) {
            const powerNote =
                observedPower !== null && observedPower < 0.8 && mde !== null
                    ? ` Poder estatístico de ${(observedPower * 100).toFixed(0)}%: este teste só detectaria vantagens a partir de +${mde} acertos/concurso.`
                    : '';
            conclusion = `Não há evidência estatística suficiente (p=${pValue} >= ${alpha}) para afirmar superioridade do modelo, apesar da diferença média positiva (+${meanDiff.toFixed(2)} acertos).${powerNote}`;
        } else {
            conclusion = `Não há evidência estatística de superioridade (diferença média: ${meanDiff.toFixed(2)} acertos).`;
        }

        const relativeImprovement =
            baselineStats.mean > 0 ? `${((meanDiff / baselineStats.mean) * 100).toFixed(2)}%` : '0.0%';

        return {
            modelMean: modelStats.mean,
            baselineMean: baselineStats.mean,
            difference: Number(meanDiff.toFixed(4)),
            relativeImprovement,
            tStatistic: Number(tStat.toFixed(4)),
            df,
            pValue,
            pValueTwoSided: Number(Math.max(0, Math.min(1, pValueTwoSided)).toFixed(10)),
            alpha,
            statisticallySignificant,
            effectSize: Number(cohensD.toFixed(4)),
            effectDescriptor,
            method: 't de Student pareado bilateral/unilateral (CDF exata)',
            standardError: Number(seDiff.toFixed(6)),
            minimumDetectableEffect: mde,
            observedPower,
            conclusion
        };
    }

    /**
     * Reamostragem Bootstrap determinística para comparação Modelo vs Baseline
     */
    static bootstrapCompare(modelHits, baselineHits, options = {}) {
        const iterations = options.iterations || 5000;
        const seed = options.seed ?? 123456;
        const prng = new SeededRandom(seed);
        const n = Math.min(modelHits ? modelHits.length : 0, baselineHits ? baselineHits.length : 0);

        if (n < 5) {
            return {
                iterations: 0,
                seed,
                meanDiff: 0,
                ciLower: 0,
                ciUpper: 0,
                pValue: 1.0,
                statisticallySignificant: false,
                differenceDistribution: []
            };
        }

        const bootstrapMeans = [];
        let extremeCount = 0;

        for (let b = 0; b < iterations; b++) {
            let sumDiff = 0;
            for (let i = 0; i < n; i++) {
                const idx = prng.nextInt(0, n - 1);
                sumDiff += modelHits[idx] - baselineHits[idx];
            }
            const sampleMeanDiff = sumDiff / n;
            bootstrapMeans.push(sampleMeanDiff);
            if (sampleMeanDiff <= 0) {
                extremeCount++;
            }
        }

        bootstrapMeans.sort((a, b) => a - b);

        const lowerIdx = Math.floor(iterations * 0.025);
        const upperIdx = Math.floor(iterations * 0.975);

        const ciLower = Number(bootstrapMeans[lowerIdx].toFixed(4));
        const ciUpper = Number(bootstrapMeans[upperIdx].toFixed(4));
        const meanDiff = Number((bootstrapMeans.reduce((a, b) => a + b, 0) / iterations).toFixed(4));
        // Correção de viés do estimador de p bootstrap: (B_ext + 1) / (B + 1)
        // evita p = 0 (que declararia significância infinita a partir de amostra finita).
        const pValue = Number(Math.min(1, (extremeCount + 1) / (iterations + 1)).toFixed(6));

        return {
            iterations,
            seed,
            meanDiff,
            ciLower,
            ciUpper,
            pValue,
            statisticallySignificant: pValue < 0.05 && meanDiff > 0,
            differenceDistribution: bootstrapMeans
        };
    }
}
