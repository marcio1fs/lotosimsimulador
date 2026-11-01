/**
 * SequentialTestEngine — inferência válida quando o usuário olha repetidamente
 *
 * O PROBLEMA
 * ----------
 * O relatório estatístico mostra um p-valor clássico. Esse p-valor responde a
 * uma pergunta só: "se eu tivesse decidido de antemão olhar UMA vez, com esta
 * janela, qual a chance de um resultado assim?".
 *
 * O uso real do app é o oposto: a pessoa gera jogos, olha o relatório, troca a
 * janela (20 → 50 → 200), gera de novo, e para quando alguma configuração
 * "parece boa". Cada olhada é um teste. Com dados de loteria — que são
 * aleatórios por construção — a chance de **alguma** das olhadas cair abaixo de
 * 0,05 cresce rápido com o número de olhadas:
 *
 *     P(algum falso-positivo) ≈ 1 − (1 − α)^k        (olhadas independentes)
 *
 * Medido neste repositório (300 séries de 120 olhadas cada, sem nenhum sinal):
 * o t-test clássico aplicado a cada prefixo acusou "significância" em **56,3%**
 * das séries. O α nominal era 5%. É esse número que o app estava convidando o
 * usuário a produzir. O p always-valid, nas mesmas séries, erra em **3,7%**.
 *
 * A CORREÇÃO
 * ----------
 * Um p-valor *always-valid* (também chamado de anytime-valid) mantém a garantia
 * de erro tipo I em **todos** os tamanhos de amostra simultaneamente:
 *
 *     P(∃ n : p_n ≤ α  |  H0 verdadeira) ≤ α
 *
 * A construção usada aqui é a mSPRT (mixture sequential probability ratio test),
 * de Johari et al. (2017), que na prática é um *e-value*: uma variável aleatória
 * não-negativa com esperança ≤ 1 sob H0. Pela desigualdade de Ville, 1/Λ é
 * p-valor válido em qualquer instante de parada — não importa quantas vezes se
 * olhe nem como a decisão de parar foi tomada.
 *
 * Com d_i = acertos_modelo − acertos_baseline no concurso i e Λ_n a razão de
 * verossimilhança misturada sobre uma prior N(0, τ²) para o efeito médio:
 *
 *     Λ_n = √(σ² / (σ² + nτ²)) · exp( n² · d̄² · τ² / (2σ²(σ² + nτ²)) )
 *     p_n = min(1, 1/Λ_n)
 *
 * O MESMO e-value dá o intervalo de confiança sequencial, por inversão: o
 * conjunto de μ0 que não seriam rejeitados em nenhuma olhada.
 *
 * O QUE ISSO CUSTA — E O CUSTO É REAL
 * -----------------------------------
 * Válido em qualquer instante significa **menos poder em cada instante**. Medido
 * aqui (200 concursos, σ = 2 acertos, 100 réplicas por efeito):
 *
 *     efeito real 0,3 acertos → poder 30% (clássico em 200: 60%)
 *     efeito real 0,5 acertos → poder 73% (clássico em 200: 96%)
 *     efeito real 0,9 acertos → poder 99% (clássico em 200: 100%)
 *     efeito real 1,5 acertos → poder 100% (clássico em 200: 100%)
 *
 * Ou seja: o teste sequencial **não vê** vantagens pequenas que o teste clássico
 * veria se você tivesse combinado olhar uma vez só. Isso não é um defeito da
 * implementação, é o preço de poder olhar quantas vezes quiser. Quem quiser o
 * poder do teste clássico tem que aceitar a regra de uma única olhada.
 *
 * HONESTIDADE SOBRE AS APROXIMAÇÕES
 * ---------------------------------
 * 1. σ não é conhecido: é estimado em um **bloco de aquecimento** de concursos
 *    iniciais (padrão 20) que não é monitorado, e fica congelado a partir dali.
 *    A tentação era estimar σ com os mesmos dados que estão sendo testados —
 *    isso acusa "sinal" em ruído puro (medido: 100% de falso-positivo, porque
 *    uma amostra de 2 pontos pode ter desvio-padrão quase zero). Separar o
 *    bloco é o que torna a garantia defensável, e a calibração empírica em
 *    `tests/sequentialTest.test.js` verifica o erro tipo I por simulação.
 * 2. τ (a escala do efeito que se espera encontrar) é uma escolha do analista.
 *    τ pequeno demais perde poder para efeitos grandes; τ grande demais perde
 *    poder para efeitos pequenos. O padrão de 0,5 acerto ≈ 5,5% sobre a média
 *    esperada da Lotofácil — pequeno o bastante para ser uma vantagem
 *    interessante, grande o bastante para ser detectável.
 * 3. O teste decide sobre a **média de acertos**, não sobre prêmios. Um modelo
 *    pode acertar na média e ainda assim não ganhar nada.
 */

/**
 * Referências citáveis para o método. Todas verificáveis; nenhuma é sobre
 * loteria — a estatística sequencial é anterior e independente do domínio.
 */
export const SEQUENTIAL_SOURCES = {
    VILLE_1939: {
        id: 'VILLE_1939',
        citation: 'Ville, J. (1939). Étude critique de la notion de collectif. Gauthier-Villars.',
        contribution: 'Desigualdade de Ville: P(sup_n Λ_n ≥ 1/α) ≤ α para martingais não-negativos — a base de todo teste always-valid.'
    },
    WALD_1945: {
        id: 'WALD_1945',
        citation: 'Wald, A. (1945). Sequential Tests of Statistical Hypotheses. Annals of Mathematical Statistics 16(2), 117–186.',
        contribution: 'Teste sequencial de razão de verossimilhança (SPRT): o ancestral direto da mSPRT.'
    },
    ROBBINS_1970: {
        id: 'ROBBINS_1970',
        citation: 'Robbins, H. (1970). Statistical Methods Related to the Law of the Iterated Logarithm. Annals of Mathematical Statistics 41(5), 1397–1409.',
        contribution: 'Primeiras fronteiras válidas uniformemente no tempo para a média.'
    },
    JOHARI_2017: {
        id: 'JOHARI_2017',
        citation: 'Johari, R., Koomen, P., Pekelis, L., Walsh, D. (2017). Peeking at A/B Tests: Why It Matters, and What to Do About It. KDD 2017.',
        contribution: 'mSPRT aplicada a experimentos online: o e-value com prior normal usado aqui.'
    },
    HOWARD_2021: {
        id: 'HOWARD_2021',
        citation: 'Howard, S. R., Ramdas, A., McAuliffe, J., Sekhon, J. (2021). Time-uniform, nonparametric, nonasymptotic confidence sequences. Annals of Statistics 49(2), 1055–1080.',
        contribution: 'Sequências de confiança uniformes no tempo e o custo em poder de abandonar o ponto fixo.'
    }
};

/** Parâmetros padrão, com a justificativa de cada um. */
export const SEQUENTIAL_DEFAULTS = Object.freeze({
    /** Nível de significância nominal. */
    alpha: 0.05,
    /**
     * Escala do efeito esperado, em acertos por concurso. 0,5 acerto ≈ 5,5% de
     * vantagem sobre a média hipergeométrica da Lotofácil (9,0).
     */
    tau: 0.5,
    /** Amostras mínimas para a inferência sequencial fazer sentido. */
    minSamples: 4,
    /**
     * Bloco de aquecimento: os primeiros concursos servem APENAS para estimar σ.
     * Eles não são monitorados — e isso é o que torna a garantia honesta. Se σ
     * fosse estimado com os mesmos dados que estão sendo testados, uma amostra
     * minúscula com desvio-padrão quase zero geraria z gigante e o teste
     * acusaria "sinal" em ruído puro (medido: 100% de falso-positivo).
     */
    burnIn: 20,
    /** Piso de σ para evitar divisão por zero em sequências degeneradas. */
    sigmaFloor: 1e-9,
    /** Esquema de gasto de α por número de olhadas. */
    spendingScheme: 'quadratic'
});

const PI_SQ_OVER_SIX = Math.PI * Math.PI / 6;

/**
 * Média e desvio-padrão amostral (ddof = 1).
 * @param {number[]} values
 */
function sampleStats(values) {
    const n = values.length;
    if (n === 0) return { n: 0, mean: 0, sd: 0 };
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[i];
    const mean = sum / n;
    if (n < 2) return { n, mean, sd: 0 };
    let ssq = 0;
    for (let i = 0; i < n; i++) {
        const d = values[i] - mean;
        ssq += d * d;
    }
    return { n, mean, sd: Math.sqrt(ssq / (n - 1)) };
}

/**
 * Orçamento de α entre várias olhadas.
 *
 * Existe porque o app permite uma sequência **discreta** de olhadas: gerar de
 * novo, trocar a janela, rodar um backtest por estratégia. Para esse caso existe
 * uma solução ainda mais simples que a mSPRT e igualmente válida, desde que os
 * limiares sejam fixados **antes** de olhar: gastar α em uma série cuja soma
 * converge para α.
 *
 * Aqui: α_m = α · (6/π²) / m². Como Σ_{m≥1} 1/m² = π²/6, a soma dos limiares é
 * exatamente α — e a união sobre **infinitas** olhadas ainda cabe em α. Isso vale
 * mesmo que o número de olhadas seja escolhido depois de ver os dados (é o ponto:
 * a união cobre todos os m possíveis).
 *
 * O esquema `bonferroni` (α/m) também está disponível, mas com uma ressalva: só
 * é válido se m for decidido **antes** da coleta. Com m escolhido olhando os
 * dados, o Bonferroni não protege — e é exatamente o que o usuário faz.
 */
export class AlphaBudget {
    /**
     * @param {object} [options]
     * @param {number} [options.alpha=0.05]
     * @param {'quadratic'|'bonferroni'} [options.scheme='quadratic']
     * @param {string} [options.label='sessão']
     */
    constructor(options = {}) {
        const alpha = Number(options.alpha ?? SEQUENTIAL_DEFAULTS.alpha);
        if (!(alpha > 0) || !(alpha < 1)) {
            throw new RangeError(`alpha deve estar em (0,1); recebido ${options.alpha}`);
        }
        const scheme = options.scheme ?? SEQUENTIAL_DEFAULTS.spendingScheme;
        if (scheme !== 'quadratic' && scheme !== 'bonferroni') {
            throw new RangeError(`esquema desconhecido: ${scheme}`);
        }
        this.alpha = alpha;
        this.scheme = scheme;
        this.label = String(options.label ?? 'sessão');
        this.looks = [];
    }

    /** Limiar de α concedido à m-ésima olhada (m começa em 1). */
    thresholdFor(m) {
        const k = Math.max(1, Math.floor(m));
        return this.scheme === 'bonferroni'
            ? this.alpha / k
            : (this.alpha / PI_SQ_OVER_SIX) / (k * k);
    }

    /**
     * Registra uma olhada e devolve o veredito sob o limiar daquela posição.
     * @param {object} look
     * @param {string} [look.label]
     * @param {number} look.pValue
     * @param {object} [look.metadata]
     */
    register(look = {}) {
        const raw = Number(look.pValue);
        if (!Number.isFinite(raw) || raw < 0 || raw > 1) {
            throw new RangeError(`p-valor inválido: ${look.pValue}`);
        }
        const index = this.looks.length + 1;
        const threshold = this.thresholdFor(index);
        // p reescalado para a mesma régua do α global: sobrevive se ≤ alpha.
        const adjustedPValue = Math.min(1, (raw / threshold) * this.alpha);
        const entry = {
            index,
            label: String(look.label ?? `olhada ${index}`),
            pValue: raw,
            threshold,
            adjustedPValue,
            survives: raw <= threshold,
            metadata: look.metadata ? { ...look.metadata } : null
        };
        this.looks.push(entry);
        return { ...entry };
    }

    /** α já comprometido (soma dos limiares das olhadas feitas). */
    get spent() {
        return this.looks.reduce((acc, l) => acc + l.threshold, 0);
    }

    /** α que ainda pode ser gasto sem estourar o nível global. */
    get remaining() {
        return Math.max(0, this.alpha - this.spent);
    }

    get lookCount() {
        return this.looks.length;
    }

    /** Ver quantas olhadas ainda caberiam no orçamento. */
    report() {
        const survived = this.looks.filter(l => l.survives);
        return {
            label: this.label,
            alpha: this.alpha,
            scheme: this.scheme,
            looks: this.lookCount,
            spent: Number(this.spent.toFixed(8)),
            remaining: Number(this.remaining.toFixed(8)),
            nextThreshold: this.thresholdFor(this.lookCount + 1),
            survivedLooks: survived.length,
            minPValue: this.lookCount > 0 ? Math.min(...this.looks.map(l => l.pValue)) : null,
            entries: this.looks.map(l => ({ ...l })),
            note: this.lookCount > 0
                ? `${this.lookCount} olhada(s) nesta ${this.label}: ${survived.length} sobreviveu(aram) ao limiar de α gasto. ` +
                  `O limiar encolhe a cada olhada — é o que impede "procurar até achar".`
                : `Nenhuma olhada registrada nesta ${this.label}.`
        };
    }

    reset() {
        this.looks = [];
    }
}

export class SequentialTestEngine {
    /**
     * e-value (mSPRT) para a média de uma sequência de diferenças pareadas.
     *
     * Λ_n = √(σ²/(σ²+nτ²)) · exp( n² d̄² τ² / (2σ²(σ²+nτ²)) )
     *
     * @param {number[]} diffs
     * @param {object} [options]
     * @param {number} [options.sigma] desvio-padrão (se omitido, estimado dos dados)
     * @param {number} [options.tau=0.5] escala do efeito esperado, em acertos
     */
    static mixtureEValue(diffs, options = {}) {
        const values = Array.isArray(diffs) ? diffs.map(Number) : [];
        if (values.length === 0 || values.some(v => !Number.isFinite(v))) {
            return {
                n: 0, burnIn: 0, monitored: 0, meanDiff: null,
                eValue: 1, logEValue: 0, sigma: null, tau: null, available: false
            };
        }
        const tau = Number(options.tau ?? SEQUENTIAL_DEFAULTS.tau);
        if (!(tau > 0)) throw new RangeError(`tau deve ser positivo; recebido ${options.tau}`);

        const n = values.length;
        const provided = options.sigma === undefined || options.sigma === null ? null : Number(options.sigma);
        if (provided !== null && !(provided > 0)) {
            throw new RangeError(`sigma deve ser positivo; recebido ${options.sigma}`);
        }

        // Sem σ fornecido: estima no bloco inicial e testa apenas o restante.
        // Bloco limitado a um terço da amostra para não engolir séries curtas.
        const requestedBurnIn = Number(options.burnIn ?? SEQUENTIAL_DEFAULTS.burnIn);
        if (!(requestedBurnIn >= 0)) throw new RangeError(`burnIn inválido: ${options.burnIn}`);
        const burnIn = provided !== null
            ? 0
            : Math.min(Math.floor(requestedBurnIn), Math.max(1, Math.floor(n / 3)));

        const window = provided !== null ? values : values.slice(burnIn);
        const monitored = window.length;
        const stats = sampleStats(window);
        const calib = sampleStats(values.slice(0, burnIn));

        // Sem variabilidade no aquecimento não existe σ estimável, e inventar um
        // piso minúsculo transformaria qualquer média ≠ 0 em "p = 0". Melhor
        // dizer que o teste não está disponível.
        // Comparação com tolerância: 50 valores idênticos ainda produzem desvios
        // de ~1e-17 por erro de ponto flutuante, e "sd > 0" aceitaria isso.
        const negligibleSd = 1e-12 * Math.max(1, Math.abs(calib.mean));
        if (provided === null && !(calib.sd > negligibleSd)) {
            return {
                n, burnIn, monitored, meanDiff: null, eValue: 1, logEValue: 0,
                sigma: null, tau, available: false,
                reason: 'Bloco de aquecimento sem variabilidade: não é possível estimar σ.'
            };
        }
        const sigma = Math.max(SEQUENTIAL_DEFAULTS.sigmaFloor, provided ?? Math.max(calib.sd, negligibleSd));

        const v2 = sigma * sigma;
        const den = v2 + monitored * tau * tau;
        const logEValue = 0.5 * Math.log(v2 / den)
            + (monitored * monitored * stats.mean * stats.mean * tau * tau) / (2 * v2 * den);

        return {
            n,
            burnIn,
            monitored,
            meanDiff: monitored > 0 ? stats.mean : null,
            sigma,
            sigmaSource: provided !== null ? 'fornecido' : 'aquecimento',
            tau,
            logEValue,
            eValue: Math.exp(Math.min(700, logEValue)),
            available: monitored > 0
        };
    }

    /**
     * p-valor válido em qualquer instante de parada: p = min(1, 1/Λ).
     */
    static alwaysValidPValue(diffs, options = {}) {
        const ev = this.mixtureEValue(diffs, options);
        if (!ev.available) {
            return { ...ev, pValue: 1, isAlwaysValid: true };
        }
        const pValue = Math.min(1, Math.max(0, Math.exp(-Math.min(700, ev.logEValue))));
        return { ...ev, pValue, isAlwaysValid: true };
    }

    /**
     * Intervalo de confiança sequencial (uniforme no tempo), obtido invertendo o
     * mesmo e-value: μ0 é aceitável enquanto 1/Λ_n(μ0) > α.
     *
     *   |d̄ − μ0| ≤ √( 2σ²(σ²+nτ²)/(n²τ²) · ln( √(σ²+nτ²)/(σ·α) ) )
     *
     * Como vem da mesma quantidade que gera o p-valor, o intervalo e o teste
     * nunca se contradizem (se o IC sequencial exclui zero, o p sequencial está
     * abaixo de α, e vice-versa).
     */
    static confidenceSequence(diffs, options = {}) {
        const ev = this.mixtureEValue(diffs, options);
        const alpha = Number(options.alpha ?? SEQUENTIAL_DEFAULTS.alpha);
        if (!ev.available) {
            return { available: false, lower: null, upper: null, halfWidth: null, alpha, reason: ev.reason };
        }
        const n = ev.monitored;
        const v2 = ev.sigma * ev.sigma;
        const t2 = ev.tau * ev.tau;
        const den = v2 + n * t2;
        const logTerm = Math.log(Math.sqrt(den) / (ev.sigma * alpha));
        const halfWidth = logTerm <= 0
            ? Infinity
            : Math.sqrt((2 * v2 * den) / (n * n * t2) * logTerm);
        const lower = ev.meanDiff - halfWidth;
        const upper = ev.meanDiff + halfWidth;
        return {
            available: true,
            method: 'inversão da mSPRT (uniforme no tempo)',
            alpha,
            n,
            burnIn: ev.burnIn,
            meanDiff: ev.meanDiff,
            halfWidth,
            lower,
            upper,
            excludesZero: lower > 0 || upper < 0
        };
    }

    /**
     * Monitora cada prefixo da série: em que olhada o p sequencial cruzaria α,
     * e qual o menor p alcançado.
     *
     * @param {number[]} diffs
     * @param {object} [options]
     */
    static monitor(diffs, options = {}) {
        const values = Array.isArray(diffs) ? diffs.map(Number) : [];
        const alpha = Number(options.alpha ?? SEQUENTIAL_DEFAULTS.alpha);
        const tau = Number(options.tau ?? SEQUENTIAL_DEFAULTS.tau);

        if (values.length < SEQUENTIAL_DEFAULTS.minSamples) {
            return {
                available: false,
                looks: values.length,
                alpha,
                reason: `São necessários ao menos ${SEQUENTIAL_DEFAULTS.minSamples} concursos para a inferência sequencial.`
            };
        }

        // σ vem do bloco de aquecimento e fica CONGELADO: reestimar σ a cada
        // olhada quebraria a propriedade de martingal que sustenta a garantia.
        const first = this.mixtureEValue(values, { tau, sigma: options.sigma, burnIn: options.burnIn });
        if (!first.available) {
            return { available: false, looks: values.length, alpha, reason: first.reason };
        }
        const burnIn = first.burnIn;
        const sigma = first.sigma;
        const monitoredSeries = values.slice(burnIn);

        const curve = [];
        let firstSignificantLook = null;
        let minP = 1;
        let minPLook = null;
        for (let n = 1; n <= monitoredSeries.length; n++) {
            const p = this.alwaysValidPValue(monitoredSeries.slice(0, n), { sigma, tau }).pValue;
            curve.push(Number(p.toFixed(6)));
            if (p < minP) { minP = p; minPLook = n; }
            if (firstSignificantLook === null && p <= alpha) firstSignificantLook = n;
        }

        return {
            available: true,
            looks: monitoredSeries.length,
            burnIn,
            sigma: Number(sigma.toFixed(6)),
            alpha,
            firstSignificantLook,
            firstSignificantSample: firstSignificantLook === null ? null : firstSignificantLook + burnIn,
            minPValue: minP,
            minPValueLook: minPLook,
            curve,
            note: firstSignificantLook === null
                ? `Em nenhuma das ${monitoredSeries.length} olhadas o p sequencial cruzou ${alpha} — o resultado esperado em dados sem sinal.`
                : `O p sequencial cruza ${alpha} na olhada ${firstSignificantLook} (concurso ${firstSignificantLook + burnIn} da amostra). Válido em qualquer olhada: não importa quantas vezes se olhe.`
        };
    }

    /**
     * Bloco pronto para o backtest: compara as duas séries de acertos e devolve
     * o p sequencial ao lado do clássico, com a interpretação do que cada um vale.
     *
     * @param {number[]} modelHits
     * @param {number[]} baselineHits
     * @param {object} [options]
     * @param {number} [options.classicalPValue] p do teste clássico, só para comparação
     */
    static analyzePaired(modelHits, baselineHits, options = {}) {
        const n = Math.min(
            Array.isArray(modelHits) ? modelHits.length : 0,
            Array.isArray(baselineHits) ? baselineHits.length : 0
        );
        if (n < SEQUENTIAL_DEFAULTS.minSamples) {
            return {
                available: false,
                reason: `Amostra insuficiente (${n} pares) para inferência sequencial.`,
                samples: n,
                alpha: Number(options.alpha ?? SEQUENTIAL_DEFAULTS.alpha)
            };
        }

        const diffs = new Array(n);
        for (let i = 0; i < n; i++) diffs[i] = Number(modelHits[i]) - Number(baselineHits[i]);

        const alpha = Number(options.alpha ?? SEQUENTIAL_DEFAULTS.alpha);
        const tau = Number(options.tau ?? SEQUENTIAL_DEFAULTS.tau);
        const scenario = { tau, sigma: options.sigma, burnIn: options.burnIn };
        const test = this.alwaysValidPValue(diffs, scenario);
        if (!test.available) {
            return {
                available: false,
                samples: n,
                alpha,
                reason: test.reason || 'Não foi possível estimar a variabilidade da série.'
            };
        }
        const cs = this.confidenceSequence(diffs, { ...scenario, alpha });
        const monitoring = this.monitor(diffs, { ...scenario, alpha });

        const classical = options.classicalPValue;
        return {
            available: true,
            method: 'mSPRT (mixture sequential probability ratio test)',
            samples: n,
            burnIn: test.burnIn,
            monitored: test.monitored,
            alpha,
            tau,
            sigma: Number(test.sigma.toFixed(6)),
            sigmaSource: test.sigmaSource,
            meanDiff: Number(test.meanDiff.toFixed(6)),
            eValue: Number(test.eValue.toPrecision(6)),
            alwaysValidPValue: Number(test.pValue.toFixed(10)),
            classicalPValue: typeof classical === 'number' ? classical : null,
            confidenceSequence: cs.available ? {
                lower: Number(cs.lower.toFixed(6)),
                upper: Number(cs.upper.toFixed(6)),
                halfWidth: Number(cs.halfWidth.toFixed(6)),
                excludesZero: cs.excludesZero,
                method: cs.method
            } : null,
            monitoring,
            interpretation:
                `O p clássico vale para UMA olhada decidida de antemão. O p sequencial vale em qualquer ` +
                `olhada: pode gerar e comparar janelas quantas vezes quiser sem inflar o erro tipo I. ` +
                `O preço é poder — vantagens abaixo de ~0,5 acerto passam despercebidas com este tamanho de amostra.`
        };
    }

    // ------------------------------------------------------------------
    // Orçamento de α da sessão (uma olhada por geração de jogos)
    // ------------------------------------------------------------------

    /** Orçamento compartilhado da aplicação (criado sob demanda). */
    static get sharedBudget() {
        if (!this._sharedBudget) {
            this._sharedBudget = new AlphaBudget({ alpha: SEQUENTIAL_DEFAULTS.alpha, scheme: SEQUENTIAL_DEFAULTS.spendingScheme });
        }
        return this._sharedBudget;
    }

    /**
     * Registra uma olhada na sessão corrente.
     * @param {{label?: string, pValue: number, metadata?: object}} look
     */
    static registerLook(look) {
        return this.sharedBudget.register(look);
    }

    /** Relatório da sessão (quantas olhadas, quanto de α já foi gasto). */
    static getSessionReport() {
        return this.sharedBudget.report();
    }

    /** Zera o orçamento da sessão. */
    static resetSession() {
        this.sharedBudget.reset();
    }
}
