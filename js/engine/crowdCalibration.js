/**
 * Calibração do AntiCrowdEngine — a parte que faltava do item 6.8 da auditoria.
 *
 * O PROBLEMA, EM UMA FRASE
 * ------------------------
 * O motor anti-multidão precisa de uma coisa que o Brasil não publica: **quantas
 * pessoas apostam em cada dezena**. A Caixa divulga as dezenas sorteadas, os
 * ganhadores de cada faixa e a arrecadação; não divulga as apostas. Sem essa
 * tabela, as magnitudes em `CROWD_PRIORS` são julgamento, não medida — e o motor
 * devolve `calibrated: false` dizendo exatamente isso.
 *
 * O QUE ESTE MÓDULO FAZ
 * ---------------------
 * Três coisas que não dependem de dado que não existe:
 *
 * 1. **Pipeline de ingestão.** Quando alguém tiver a tabela de apostas por dezena
 *    (a Caixa internamente, uma casa lotérica com histórico, um estudo publicado),
 *    `parsePopularityCsv` + `deriveWeightsFromCounts` transformam o arquivo em
 *    pesos com intervalo de confiança por dezena, e dizem quais dezenas a amostra
 *    **não** distingue da média. O resultado entra em `AntiCrowdEngine.setCalibration`.
 *
 * 2. **Sensibilidade.** A pergunta prática não é "as magnitudes são exatas?" — é
 *    "a **escolha** depende delas?". `priorSensitivity` perturba os priors que
 *    decidem a ordem das dezenas; `ticketScoreSensitivity` perturba os que
 *    decidem a nota do bilhete. Se a ordem sobrevive, a falta de calibração afeta
 *    a escala do número, não a decisão.
 *
 * 3. **Influência.** `priorInfluence` mexe num prior de cada vez e ranqueia: qual
 *    crença, se medida, mudaria mais o resultado? É a resposta para "por onde
 *    começar a medir".
 *
 * O QUE DESCOBRI AO IMPLEMENTAR (e vale registrar)
 * ------------------------------------------------
 * Os pesos por dezena (`getNumberAntiCrowdWeight`) **não** entram na pontuação do
 * bilhete (`evaluateTicketAntiCrowd`): a nota vem de características do bilhete —
 * proporção de datas, progressão aritmética, terminações, geometria. As duas
 * metades do motor são independentes. Consequência prática: os pesos guiam a
 * **geração**, a nota classifica o bilhete gerado, e um bilhete pode sair com
 * pesos anti-multidão e nota ruim (ou o contrário). Por isso a sensibilidade é
 * medida em duas frentes separadas, com métricas diferentes.
 *
 * O QUE ESTE MÓDULO NÃO FAZ
 * -------------------------
 * Não estima popularidade a partir do resultado dos sorteios. Já se pensou nisso:
 * os ganhadores de cada faixa são publicados por concurso, e em tese um sorteio
 * com muitas dezenas de data teria mais ganhadores que o esperado. Para virar
 * estimativa por dezena faltaria o denominador — o número de apostas daquele
 * concurso —, e o erro amostral por concurso é enorme (a faixa principal da
 * Mega-Sena tem 0 ou 1 ganhador). Um estimador assim produziria número com cara
 * de medida e precisão de palpite: exatamente o que esta auditoria veio remover.
 */

import { AntiCrowdEngine, CROWD_PRIORS } from './antiCrowdEngine.js';
import { SeededRandom } from './prng.js';

/** Soma usada no alisamento de Dirichlet; 0,5 é o Jeffreys sem opinião forte. */
export const DEFAULT_ALPHA = 0.5;

/**
 * Inclinação da reta popularidade → peso.
 *
 * Ancorada em dois pontos que já existem no motor: uma dezena com popularidade
 * média (`relative = 1`) recebe `baseWeight`; uma dezena 50% mais apostada que a
 * média cai no piso `minWeight`. Daí `slope = (baseWeight - minWeight) / 0,5`.
 * Não inventa constante nova: deriva das que o motor já usava.
 */
export const popularitySlope = () => (CROWD_PRIORS.baseWeight.value - CROWD_PRIORS.minWeight.value) / 0.5;

/**
 * Priors que decidem a ORDEM das dezenas — os únicos que `priorSensitivity` mexe.
 *
 * São exatamente os lidos por `getNumberAntiCrowdWeight`. Ficam de fora:
 *
 *  - `baseWeight`, `minWeight`, `maxWeight`: âncoras da escala de saída (0,15 a
 *    1,0). Mexer nelas não muda crença nenhuma, só a régua — e a régua está
 *    declarada em `CROWD_PRIORS`;
 *  - o bloco de nota do bilhete (ver `TICKET_PRIORS`), medido à parte;
 *  - limiares de risco: mudam rótulo, não número.
 */
export const RANKING_PRIORS = Object.freeze([
    'above31Bonus',
    'monthOverlapPenalty',
    'dayOnlyPenalty',
    'edgePenaltyLotofacil',
    'luckyPenalty',
    'roundTenPenalty',
    'roundFivePenalty'
]);

/** Priors que decidem a NOTA do bilhete (0 a 100) e o multiplicador de EV. */
export const TICKET_PRIORS = Object.freeze([
    'birthdayBonus',
    'birthdayPenalty',
    'monthPenalty',
    'arithmeticPenalty',
    'arithmeticBonus',
    'endingPenaltyUnit',
    'endingBonus',
    'luckyPenaltyUnit',
    'luckyBonus',
    'geometryPenalty',
    'repetitionPenaltyUnit',
    'evScaleLarge',
    'evScaleSmall'
]);

/** Configurações usadas nas análises (universo grande e pequeno). */
export const DEFAULT_SENSITIVITY_CONFIGS = {
    mega: { total: 60, pick: 6, drawn: 6 },
    lotofacil: { total: 25, pick: 15, drawn: 15 }
};

/**
 * Lê uma tabela de apostas por dezena.
 *
 * Formato aceito (CSV, TSV ou separado por `;`), com `#` para comentário:
 *
 *     # apostas por dezena — Mega-Sena, acumulado 2026
 *     dezena,apostas
 *     1,412530
 *     2,398112
 *
 * Cabeçalho é detectado e ignorado (primeira linha sem número). Dezenas
 * repetidas são somadas e registradas em `issues` — repetir linha é erro de
 * digitação ou junção de períodos, e nos dois casos somar é o certo.
 *
 * @param {string} text
 * @returns {{counts: Record<number, number>, sampleSize: number, issues: object[], lines: number}}
 */
export function parsePopularityCsv(text) {
    if (typeof text !== 'string') throw new TypeError('parsePopularityCsv espera texto');

    const counts = Object.create(null);
    const issues = [];
    let sampleSize = 0;
    let lines = 0;
    let sawHeader = false;

    String(text)
        .split(/\r?\n/)
        .forEach((rawLine, index) => {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) return;
            lines++;

            const parts = line
                .split(/[;,\t|]/)
                .map(part => part.trim())
                .filter(part => part !== '');

            if (parts.length < 2) {
                issues.push({ line: index + 1, reason: 'linha precisa de dezena e quantidade', text: line });
                return;
            }

            const number = Number(parts[0]);
            const amount = Number(parts[1]);

            if (!Number.isInteger(number)) {
                // Cabeçalho é a explicação mais provável; registra uma vez só.
                if (!sawHeader) {
                    issues.push({ line: index + 1, reason: 'cabeçalho ignorado', text: line });
                    sawHeader = true;
                }
                return;
            }
            if (number < 1) {
                issues.push({ line: index + 1, reason: 'dezena precisa ser >= 1', text: line });
                return;
            }
            if (!Number.isFinite(amount) || amount < 0) {
                issues.push({ line: index + 1, reason: 'quantidade precisa ser número >= 0', text: line });
                return;
            }

            if (counts[number] !== undefined) {
                issues.push({ line: index + 1, reason: `dezena ${number} repetida — somada`, text: line });
            }
            counts[number] = (counts[number] || 0) + amount;
            sampleSize += amount;
        });

    return { counts, sampleSize, issues, lines };
}

/** Intervalo de Wilson para uma proporção (95% por padrão). */
function wilson(successes, trials, z = 1.959963984540054) {
    if (!(trials > 0)) return { lower: 0, upper: 1 };
    const p = successes / trials;
    const denom = 1 + (z * z) / trials;
    const centre = (p + (z * z) / (2 * trials)) / denom;
    const half = (z / denom) * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials));
    return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

/**
 * Converte contagens de apostas em pesos por dezena, prontos para o motor.
 *
 * Método, declarado por inteiro:
 *
 *  1. alisamento de Dirichlet com `alpha` (Jeffreys, 0,5) — evita que uma dezena
 *     com 0 apostas vire "infinitamente impopular" só porque a amostra não a viu;
 *  2. popularidade relativa `r_i = share_i / (1/n)`: 1 = dezena média;
 *  3. reta ancorada (ver `popularitySlope`): `r = 1` → `baseWeight`, recortada em
 *     `[minWeight, maxWeight]`;
 *  4. intervalo de Wilson por dezena, propagado para a faixa de peso — dezena cujo
 *     intervalo contém a média **não** está distinguida da multidão, e o relatório
 *     diz isso em vez de fingir precisão.
 *
 * @param {Record<number, number>} counts - apostas por dezena
 * @param {object} [options]
 * @param {number} options.total - universo da loteria (25, 60, 80, 100)
 * @param {number} [options.alpha]
 * @returns {object} relatório com `weights` ({dezena: peso}) e diagnóstico
 */
export function deriveWeightsFromCounts(counts, { total, alpha = DEFAULT_ALPHA } = {}) {
    if (!counts || typeof counts !== 'object') throw new TypeError('counts deve ser um objeto { dezena: apostas }');
    if (!Number.isInteger(total) || total < 2) throw new RangeError('total precisa ser inteiro >= 2');

    const entries = Object.entries(counts)
        .map(([key, value]) => [parseInt(key, 10), Number(value)])
        .filter(([number, value]) => Number.isInteger(number) && number >= 1 && Number.isFinite(value) && value >= 0)
        .sort((a, b) => a[0] - b[0]);

    if (entries.length < 2) throw new RangeError('são necessárias ao menos duas dezenas com apostas');

    const sampleSize = entries.reduce((sum, [, value]) => sum + value, 0);
    if (!(sampleSize > 0)) throw new RangeError('a amostra precisa ter ao menos uma aposta');

    const n = entries.length;
    const uniform = 1 / n;
    const slope = popularitySlope();
    const baseWeight = CROWD_PRIORS.baseWeight.value;
    const minWeight = CROWD_PRIORS.minWeight.value;
    const maxWeight = CROWD_PRIORS.maxWeight.value;

    const clamp = value => Math.max(minWeight, Math.min(maxWeight, value));
    const toWeight = relative => clamp(baseWeight - slope * (relative - 1));

    const numbers = entries.map(([number, count]) => {
        const share = (count + alpha) / (sampleSize + alpha * n);
        const relative = share / uniform;
        const ci = wilson(count, sampleSize);
        // Reaplica o alisamento nos limites do intervalo para a faixa de peso sair
        // na mesma escala do centro.
        const boundShare = bound => ((bound * sampleSize + alpha) / (sampleSize + alpha * n)) * n;
        // Mais popular → peso MENOR: a faixa de peso é o intervalo da popularidade
        // virado do avesso, então ordena os dois extremos em vez de supor a ordem.
        const weightA = toWeight(boundShare(ci.lower));
        const weightB = toWeight(boundShare(ci.upper));
        return {
            number,
            count,
            share: Number(share.toFixed(8)),
            relative: Number(relative.toFixed(4)),
            weight: Number(toWeight(relative).toFixed(4)),
            weightRange: [Number(Math.min(weightA, weightB).toFixed(4)), Number(Math.max(weightA, weightB).toFixed(4))],
            distinguishable: ci.lower > uniform || ci.upper < uniform
        };
    });

    const present = new Set(entries.map(([number]) => number));
    const missing = [];
    for (let number = 1; number <= total; number++) if (!present.has(number)) missing.push(number);

    const weights = {};
    for (const item of numbers) weights[item.number] = item.weight;

    const byPopularity = [...numbers].sort((a, b) => a.relative - b.relative);
    return {
        total,
        alpha,
        sampleSize,
        numbersCovered: numbers.length,
        complete: missing.length === 0,
        missing,
        uniformShare: Number(uniform.toFixed(8)),
        slope: Number(slope.toFixed(4)),
        weights,
        numbers,
        diagnostics: {
            distinguishable: numbers.filter(item => item.distinguishable).length,
            expectedByChance: Number((numbers.length * 0.05).toFixed(2)),
            leastPopular: byPopularity.slice(0, 5).map(item => item.number),
            mostPopular: byPopularity
                .slice(-5)
                .reverse()
                .map(item => item.number),
            note: missing.length
                ? `a tabela cobre ${numbers.length} de ${total} dezenas: as ausentes entram com zero apostas e peso máximo na escala`
                : 'tabela cobre o universo inteiro da loteria'
        }
    };
}

/** Ranks com empates resolvidos pela média (necessário para Spearman com pesos repetidos). */
function averageRanks(values) {
    const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const ranks = new Array(values.length);
    let i = 0;
    while (i < order.length) {
        let j = i;
        while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
        const rank = (i + j) / 2 + 1;
        for (let k = i; k <= j; k++) ranks[order[k].index] = rank;
        i = j + 1;
    }
    return ranks;
}

/** Correção de Pearson entre dois vetores. */
function pearson(a, b) {
    const mean = arr => arr.reduce((sum, value) => sum + value, 0) / arr.length;
    const ma = mean(a);
    const mb = mean(b);
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < a.length; i++) {
        const x = a[i] - ma;
        const y = b[i] - mb;
        num += x * y;
        da += x * x;
        db += y * y;
    }
    return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 1;
}

/** Spearman = Pearson das ordens (com empates pela média). */
export function spearman(a, b) {
    return pearson(averageRanks(a), averageRanks(b));
}

/**
 * Distância de variação total entre duas distribuições de probabilidade.
 * Interpretação direta: 0,04 = "4% da massa mudou de lugar".
 */
export function totalVariationDistance(a, b) {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / 2;
}

/** Probabilidade de escolha de cada dezena, dado o vetor de pesos. */
function samplingDistribution(weights) {
    const sum = weights.reduce((acc, value) => acc + value, 0);
    return weights.map(value => value / sum);
}

/** Bilhetes aleatórios reproduzíveis. */
function makeTickets(rng, config, count) {
    const tickets = [];
    for (let t = 0; t < count; t++) {
        const pool = [];
        for (let number = 1; number <= config.total; number++) pool.push(number);
        tickets.push(rng.sample(pool, config.pick).sort((a, b) => a - b));
    }
    return tickets;
}

const quantiles = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return { min: at(0), median: at(0.5), max: sorted[sorted.length - 1] };
};

const round4 = value => Number(value.toFixed(4));
const round2 = value => Number(value.toFixed(2));

/**
 * Sensibilidade dos pesos por dezena — o que decide **quais dezenas** o gerador
 * prefere.
 *
 * Para cada perturbação (multiplicador uniforme em `[1-m, 1+m]` em cada prior de
 * `RANKING_PRIORS`), mede:
 *
 *  - **ρ de Spearman** entre a ordem das dezenas antes e depois;
 *  - **TVD** entre as distribuições de amostragem — quanto da massa de
 *    probabilidade mudou de lugar;
 *  - quantas dezenas efetivamente mudaram de peso.
 *
 * @param {object} [options]
 * @param {number} [options.perturbations=400]
 * @param {number} [options.magnitude=0.5] - perturbação relativa máxima
 * @param {number} [options.seed=20261101]
 * @param {object} [options.configs]
 * @returns {object} relatório por loteria
 */
export function priorSensitivity({
    perturbations = 400,
    magnitude = 0.5,
    seed = 20261101,
    configs = DEFAULT_SENSITIVITY_CONFIGS
} = {}) {
    if (!(magnitude > 0 && magnitude < 1)) throw new RangeError('magnitude precisa estar em (0, 1)');
    if (!Number.isInteger(perturbations) || perturbations < 1) throw new RangeError('perturbations precisa ser >= 1');

    const rng = new SeededRandom(seed);
    const keys = [...RANKING_PRIORS];
    const report = {};

    for (const [name, config] of Object.entries(configs)) {
        const universe = [];
        for (let number = 1; number <= config.total; number++) universe.push(number);

        const baseline = universe.map(number => AntiCrowdEngine.getNumberAntiCrowdWeight(number, config.total));
        const baselineDist = samplingDistribution(baseline);

        const rhos = [];
        const tvds = [];
        const changed = [];

        for (let round = 0; round < perturbations; round++) {
            const overrides = {};
            for (const key of keys) {
                overrides[key] = CROWD_PRIORS[key].value * (1 + (rng.next() * 2 - 1) * magnitude);
            }
            const weights = AntiCrowdEngine.withPriorOverrides(overrides, () =>
                universe.map(number => AntiCrowdEngine.getNumberAntiCrowdWeight(number, config.total))
            );
            rhos.push(spearman(baseline, weights));
            tvds.push(totalVariationDistance(baselineDist, samplingDistribution(weights)));
            changed.push(weights.filter((weight, index) => weight !== baseline[index]).length);
        }

        report[name] = {
            total: config.total,
            perturbedPriors: keys.length,
            magnitude,
            perturbations,
            weightRankCorrelation: {
                min: round4(quantiles(rhos).min),
                median: round4(quantiles(rhos).median),
                max: round4(quantiles(rhos).max)
            },
            samplingShift: { median: round4(quantiles(tvds).median), max: round4(quantiles(tvds).max) },
            numbersAffected: { median: Math.round(quantiles(changed).median), max: quantiles(changed).max }
        };
    }

    return { priorsPerturbed: keys, magnitude, perturbations, report };
}

/**
 * Sensibilidade da NOTA do bilhete — o que decide o índice 0..100 e o
 * multiplicador de EV.
 *
 * Perturba `TICKET_PRIORS` e mede, numa amostra de bilhetes reproduzível:
 * correlação de ordem das notas, maior deslocamento em pontos, fração de bilhetes
 * que troca de faixa de risco e a amplitude do multiplicador de EV.
 *
 * @param {object} [options]
 * @param {number} [options.perturbations=200]
 * @param {number} [options.magnitude=0.5]
 * @param {number} [options.ticketsPerLottery=80]
 * @param {number} [options.seed=20261101]
 * @param {object} [options.configs]
 */
export function ticketScoreSensitivity({
    perturbations = 200,
    magnitude = 0.5,
    ticketsPerLottery = 80,
    seed = 20261101,
    configs = DEFAULT_SENSITIVITY_CONFIGS
} = {}) {
    if (!(magnitude > 0 && magnitude < 1)) throw new RangeError('magnitude precisa estar em (0, 1)');
    if (!Number.isInteger(perturbations) || perturbations < 1) throw new RangeError('perturbations precisa ser >= 1');

    const rng = new SeededRandom(seed);
    const keys = [...TICKET_PRIORS];
    const report = {};

    for (const [name, config] of Object.entries(configs)) {
        const tickets = makeTickets(rng, config, ticketsPerLottery);
        const baseline = tickets.map(ticket => AntiCrowdEngine.evaluateTicketAntiCrowd(ticket, config));
        const baselineScores = baseline.map(item => item.antiCrowdScore);

        const rhos = [];
        const shifts = [];
        const labelChanges = [];
        const evValues = baseline.map(item => item.expectedValueMultiplier);

        for (let round = 0; round < perturbations; round++) {
            const overrides = {};
            for (const key of keys) {
                overrides[key] = CROWD_PRIORS[key].value * (1 + (rng.next() * 2 - 1) * magnitude);
            }
            const evaluated = AntiCrowdEngine.withPriorOverrides(overrides, () =>
                tickets.map(ticket => AntiCrowdEngine.evaluateTicketAntiCrowd(ticket, config))
            );
            const scores = evaluated.map(item => item.antiCrowdScore);

            rhos.push(spearman(baselineScores, scores));
            shifts.push(Math.max(...scores.map((score, index) => Math.abs(score - baselineScores[index]))));
            labelChanges.push(
                evaluated.filter((item, index) => item.crowdRiskLevel !== baseline[index].crowdRiskLevel).length /
                    tickets.length
            );
            for (const item of evaluated) evValues.push(item.expectedValueMultiplier);
        }

        const evSorted = [...evValues].sort((a, b) => a - b);
        report[name] = {
            total: config.total,
            tickets: tickets.length,
            perturbedPriors: keys.length,
            magnitude,
            perturbations,
            scoreRankCorrelation: {
                min: round4(quantiles(rhos).min),
                median: round4(quantiles(rhos).median)
            },
            maxScoreShiftPoints: round2(quantiles(shifts).max),
            riskLabelChangeShare: {
                median: round4(quantiles(labelChanges).median),
                max: round4(quantiles(labelChanges).max)
            },
            evMultiplierRange: {
                baselineMedian: round2(quantiles(baseline.map(item => item.expectedValueMultiplier)).median),
                min: round2(evSorted[0]),
                max: round2(evSorted[evSorted.length - 1])
            }
        };
    }

    return { priorsPerturbed: keys, magnitude, perturbations, report };
}

/**
 * Influência de cada prior, um de cada vez.
 *
 * A sensibilidade conjunta responde "e se tudo estiver errado?". Esta responde
 * outra pergunta, mais útil para quem for medir: **qual crença, se medida,
 * mudaria mais a ordem das dezenas?** Cada prior é multiplicado por `1 ± magnitude`
 * isoladamente, e o resultado é a correlação de ordem com o original.
 *
 * ρ perto de 1 → aquele prior não decide nada sozinho. ρ baixo → é ali que a
 * falta de calibração dói.
 *
 * @param {object} [options]
 * @param {number} [options.magnitude=0.5]
 * @param {object} [options.configs]
 */
export function priorInfluence({ magnitude = 0.5, configs = DEFAULT_SENSITIVITY_CONFIGS } = {}) {
    if (!(magnitude > 0 && magnitude < 1)) throw new RangeError('magnitude precisa estar em (0, 1)');

    const report = {};
    for (const [name, config] of Object.entries(configs)) {
        const universe = [];
        for (let number = 1; number <= config.total; number++) universe.push(number);
        const baseline = universe.map(number => AntiCrowdEngine.getNumberAntiCrowdWeight(number, config.total));

        report[name] = RANKING_PRIORS.map(key => {
            const base = CROWD_PRIORS[key].value;
            const measure = factor => {
                const weights = AntiCrowdEngine.withPriorOverrides({ [key]: base * factor }, () =>
                    universe.map(number => AntiCrowdEngine.getNumberAntiCrowdWeight(number, config.total))
                );
                return {
                    rho: round4(spearman(baseline, weights)),
                    changed: weights.filter((weight, index) => weight !== baseline[index]).length
                };
            };
            const down = measure(1 - magnitude);
            const up = measure(1 + magnitude);
            return {
                prior: key,
                basis: CROWD_PRIORS[key].basis,
                value: base,
                rhoDown: down.rho,
                rhoUp: up.rho,
                worstRho: Math.min(down.rho, up.rho),
                numbersAffected: Math.max(down.changed, up.changed)
            };
        }).sort((a, b) => a.worstRho - b.worstRho);
    }

    return { magnitude, report };
}
