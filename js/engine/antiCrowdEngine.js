/**
 * AntiCrowdEngine - Motor de Teoria dos Jogos e Anti-Viés Comportamental ("Modo Prêmio Sozinho")
 *
 * Fundamento em Teoria dos Jogos Aplicada a Loterias:
 * Embora todas as combinações tenham a mesma probabilidade física de sorteio P(x),
 * os apostadores humanos NÃO escolhem combinações de forma uniforme.
 *
 * O QUE É EVIDÊNCIA E O QUE NÃO É
 * -------------------------------
 * A **direção** dos vieses abaixo é documentada em literatura empírica de loterias
 * (ver CROWD_PRIORS.sources). As **magnitudes** dos pesos e do "+65%" que este
 * arquivo citava antes NÃO vêm dessa literatura: são apropriações de ordem de
 * grandeza, sem calibração para o Brasil e sem fonte. Elas estão declaradas como
 * priors em `CROWD_PRIORS`, cada uma com seu `basis`, e o motor reporta
 * `calibrated: false` enquanto não houver dado de popularidade real.
 *
 * Para calibrar de verdade: `AntiCrowdEngine.setCalibration({ popularityByNumber,
 * sampleSize, source })` — o peso passa a ser um encolhimento entre o prior e a
 * popularidade observada, com força proporcional ao tamanho da amostra.
 *
 * Vieses documentados (direção), entre outros:
 *   1. Datas de aniversário e meses (01 a 31, especialmente 01 a 12);
 *   2. Números da sorte culturais (07, 13, 17, 22, 25);
 *   3. Progressões aritméticas (ex: 05-10-15-20-25-30 ou 02-04-06-08...);
 *   4. Colunas ou diagonais simétricas desenhadas no volante;
 *   5. Dezenas com mesmo dígito final (terminações repetidas, ex: 07-17-27-37);
 *   6. Repetição elevada do resultado do concurso anterior.
 *
 * Ao minimizar a popularidade humana (Crowd Bias) mantendo o bilhete dentro da Zona
 * Central da Curva de Gauss, o Valor Esperado Financeiro E[V] = P(ganhar) × (Prêmio / E[Ganhadores])
 * aumenta significativamente por reduzir o risco de divisão de prêmio (prize splitting).
 */

import { StatisticalAnalyzer } from './statisticalAnalyzer.js';

export const LUCKY_CROWD_NUMBERS = new Set([7, 13, 10, 17, 21, 22, 25, 33]);

/**
 * Referências usadas para a DIREÇÃO de cada viés. Nenhuma delas fornece as
 * magnitudes deste arquivo — ver `basis` em cada prior.
 */
export const CROWD_SOURCES = {
    COOK_CLOTFELTER_1993:
        'Cook & Clotfelter (1993), "The Peculiar Scale Economies of Lotto", American Economic Review 83(3)',
    CLOTFELTER_COOK_1993:
        "Clotfelter & Cook (1993), \"The 'Gambler's Fallacy' in Lottery Play\", Management Science 39(12)",
    HAIGH_1997: 'Haigh (1997), "The Statistics of the National Lottery", JRSS Series A 160(2)',
    SIMON_1998:
        'Simon (1998), "An Analysis of the Distribution of Combinations Chosen by UK National Lottery Players", J. Risk & Uncertainty 17',
    ZIEMBA_1986: 'Ziemba, Brumelle, Gautier & Schwartz (1986), "Dr Z\'s 6/49 Lotto Guidebook"'
};

/**
 * Priors do motor anti-multidão.
 *
 * `basis`:
 *   'literatura'  → a DIREÇÃO do efeito tem suporte empírico publicado
 *   'arbitrário'  → magnitude escolhida por julgamento, sem calibração pública
 *   'sem fonte'   → afirmação sem suporte que se possa citar
 *
 * Nenhuma magnitude abaixo foi estimada com dados brasileiros. Isso é declarado,
 * não escondido: o motor devolve `calibrated: false` até que exista dado de
 * popularidade real por dezena.
 */
export const CROWD_PRIORS = {
    baseWeight: { value: 0.7, basis: 'arbitrário', source: null, note: 'ponto neutro da escala de peso individual' },
    above31Bonus: {
        value: 0.25,
        basis: 'literatura',
        source: CROWD_SOURCES.COOK_CLOTFELTER_1993,
        note: 'dezenas > 31 fogem do viés de aniversário'
    },
    monthOverlapPenalty: {
        value: 0.22,
        basis: 'literatura',
        source: CROWD_SOURCES.ZIEMBA_1986,
        note: '01..12 valem dia e mês'
    },
    dayOnlyPenalty: {
        value: 0.1,
        basis: 'literatura',
        source: CROWD_SOURCES.COOK_CLOTFELTER_1993,
        note: '13..31 são apenas dias'
    },
    edgePenaltyLotofacil: { value: 0.08, basis: 'arbitrário', source: null, note: '1 e 25 na Lotofácil' },
    luckyPenalty: {
        value: 0.1,
        basis: 'literatura',
        source: CROWD_SOURCES.ZIEMBA_1986,
        note: 'números de sorte culturais'
    },
    roundTenPenalty: { value: 0.08, basis: 'arbitrário', source: null, note: 'múltiplos de 10' },
    roundFivePenalty: { value: 0.04, basis: 'arbitrário', source: null, note: 'múltiplos de 5' },
    minWeight: { value: 0.15, basis: 'arbitrário', source: null, note: 'piso da escala' },
    maxWeight: { value: 1.0, basis: 'arbitrário', source: null, note: 'teto da escala' },
    scoreBase: { value: 65, basis: 'arbitrário', source: null, note: 'base do índice 0..100' },
    birthdayBonus: { value: 22, basis: 'arbitrário', source: null, note: 'bônus por proteger de datas' },
    birthdayPenalty: {
        value: 35,
        basis: 'arbitrário',
        source: null,
        note: 'penalidade proporcional ao excesso de datas'
    },
    monthPenalty: { value: 12, basis: 'arbitrário', source: null, note: 'maioria das dezenas em meses' },
    arithmeticPenalty: {
        value: 25,
        basis: 'literatura',
        source: CROWD_SOURCES.HAIGH_1997,
        note: 'progressões aritméticas são populares'
    },
    arithmeticBonus: { value: 10, basis: 'arbitrário', source: null, note: 'bônus por espaçamento irregular' },
    endingPenaltyUnit: {
        value: 10,
        basis: 'literatura',
        source: CROWD_SOURCES.SIMON_1998,
        note: 'terminações repetidas são populares'
    },
    endingBonus: { value: 8, basis: 'arbitrário', source: null, note: 'bônus sem concentração de terminação' },
    luckyPenaltyUnit: { value: 6, basis: 'arbitrário', source: null, note: 'por dezena de sorte acima do esperado' },
    luckyBonus: { value: 6, basis: 'arbitrário', source: null, note: 'sem excesso de dezenas de sorte' },
    geometryPenalty: {
        value: 15,
        basis: 'literatura',
        source: CROWD_SOURCES.HAIGH_1997,
        note: 'desenhos lineares no volante'
    },
    repetitionPenaltyUnit: {
        value: 8,
        basis: 'arbitrário',
        source: null,
        note: 'por dezena copiada do concurso anterior'
    },
    evScaleLarge: {
        value: 1.45,
        basis: 'sem fonte',
        source: null,
        note: 'escala do multiplicador de EV (universo >= 60)'
    },
    evScaleSmall: { value: 0.65, basis: 'sem fonte', source: null, note: 'escala do multiplicador de EV (demais)' },
    riskThresholdHigh: { value: 45, basis: 'arbitrário', source: null, note: 'corte de risco ALTO' },
    riskThresholdModerate: { value: 68, basis: 'arbitrário', source: null, note: 'corte de risco MODERADO' },
    /** Força do encolhimento na calibração: λ = n / (n + k). */
    calibrationShrinkage: {
        value: 100000,
        basis: 'arbitrário',
        source: null,
        note: 'apostas necessárias para metade do peso vir do dado observado'
    }
};

/** Atalho: valor de um prior. */
const P = name => CROWD_PRIORS[name].value;

export class AntiCrowdEngine {
    /**
     * Calcula o peso de anti-popularidade individual de uma dezena (0 a 1, onde 1 = menos apostada pela multidão)
     */
    /** Calibração ativa (null = apenas prior de literatura). */
    static _calibration = null;

    /**
     * Registra dados observados de popularidade por dezena.
     *
     * @param {object} params
     * @param {Object<number, number>} params.popularityByNumber - popularidade relativa (apostas, % ou contagem) por dezena
     * @param {number} params.sampleSize - nº de apostas observadas (define a força do encolhimento)
     * @param {string} [params.source] - origem dos dados, para auditoria
     * @returns {object} resumo da calibração aplicada
     */
    static setCalibration({ popularityByNumber, sampleSize, source = null } = {}) {
        if (!popularityByNumber || typeof popularityByNumber !== 'object') {
            throw new TypeError('popularityByNumber deve ser um objeto { dezena: popularidade }');
        }
        const entries = Object.entries(popularityByNumber)
            .map(([k, v]) => [parseInt(k, 10), Number(v)])
            .filter(([k, v]) => Number.isInteger(k) && k > 0 && Number.isFinite(v) && v >= 0);

        if (entries.length < 2) {
            throw new RangeError('são necessárias ao menos duas dezenas com popularidade válida');
        }
        if (!Number.isFinite(sampleSize) || sampleSize <= 0) {
            throw new RangeError('sampleSize deve ser um número positivo');
        }

        const popularity = {};
        for (const [num, value] of entries) popularity[num] = value;

        this._calibration = {
            popularityByNumber: popularity,
            sampleSize,
            source,
            lambda: sampleSize / (sampleSize + P('calibrationShrinkage')),
            at: new Date().toISOString()
        };
        return this.getCalibration();
    }

    static clearCalibration() {
        this._calibration = null;
        return null;
    }

    /**
     * Executa `fn` com alguns priors substituídos e restaura tudo no fim.
     *
     * Existe para a análise de sensibilidade de `crowdCalibration.js`: em vez de
     * reimplementar a fórmula de peso com valores mexidos (duas cópias divergem
     * no primeiro ajuste), a perturbação entra pela mesma porta que o código usa.
     * A restauração é em `finally` — se `fn` lançar, os priors voltam ao lugar.
     *
     * @param {Object<string, number>} overrides - { nomeDoPrior: valor }
     * @param {Function} fn
     * @returns {*} o que `fn` devolver
     */
    static withPriorOverrides(overrides, fn) {
        if (!overrides || typeof overrides !== 'object') throw new TypeError('overrides deve ser um objeto');
        if (typeof fn !== 'function') throw new TypeError('fn deve ser uma função');

        const saved = [];
        try {
            for (const [key, value] of Object.entries(overrides)) {
                if (!Object.hasOwn(CROWD_PRIORS, key)) throw new RangeError(`prior desconhecido: ${key}`);
                if (!Number.isFinite(value)) throw new TypeError(`valor não numérico para ${key}`);
                saved.push([key, CROWD_PRIORS[key].value]);
                CROWD_PRIORS[key].value = value;
            }
            return fn();
        } finally {
            for (const [key, value] of saved) CROWD_PRIORS[key].value = value;
        }
    }

    /** Resumo da calibração ativa (ou null). */
    static getCalibration() {
        if (!this._calibration) return null;
        const { popularityByNumber, sampleSize, source, lambda, at } = this._calibration;
        return {
            calibrated: true,
            source,
            sampleSize,
            shrinkageLambda: Number(lambda.toFixed(6)),
            numbersCovered: Object.keys(popularityByNumber).length,
            at
        };
    }

    /**
     * Peso individual derivado da popularidade OBSERVADA.
     * Menos popular → peso maior. Escala reutiliza os mesmos limites do prior.
     * @private
     */
    static _observedWeight(num, total) {
        const pop = this._calibration?.popularityByNumber;
        if (!pop) return null;
        const valores = Object.entries(pop)
            .filter(([n]) => Number(n) <= total)
            .map(([, v]) => v);
        if (valores.length < 2) return null;

        const pmin = Math.min(...valores);
        const pmax = Math.max(...valores);
        const own = pop[num];
        if (!Number.isFinite(own)) return null;
        if (pmax - pmin < 1e-12) return (P('minWeight') + P('maxWeight')) / 2;

        const norm = (own - pmin) / (pmax - pmin); // 0 = menos popular, 1 = mais popular
        const weight = P('maxWeight') - norm * (P('maxWeight') - P('minWeight'));
        return Math.max(P('minWeight'), Math.min(P('maxWeight'), weight));
    }

    /**
     * Calcula o peso de anti-popularidade individual de uma dezena (0 a 1, onde 1 = menos apostada pela multidão)
     *
     * Sem calibração: prior de literatura (ver CROWD_PRIORS).
     * Com calibração: encolhimento prior ↔ popularidade observada, com λ = n/(n+k).
     */
    static getNumberAntiCrowdWeight(num, total) {
        let score = P('baseWeight');

        // Em loterias com universo > 31 (Mega-Sena 60, Quina 80, Lotomania 100), dezenas > 31 fogem do viés de aniversário
        if (total > 31) {
            if (num > 31) {
                score += P('above31Bonus');
            } else if (num <= 12) {
                score -= P('monthOverlapPenalty');
            } else {
                score -= P('dayOnlyPenalty');
            }
        } else {
            // Na Lotofácil (1..25), dezenas centrais/ímpares iniciais e 07/13/25 têm viés humano ligeiramente maior
            if (num === 1 || num === 25) score -= P('edgePenaltyLotofacil');
        }

        // Penaliza números fetiche/sorte da multidão
        if (LUCKY_CROWD_NUMBERS.has(num)) {
            score -= P('luckyPenalty');
        }

        // Penaliza múltiplos redondos de 5 e 10 (muito marcados em apostas rápidas manuais)
        if (num % 10 === 0) {
            score -= P('roundTenPenalty');
        } else if (num % 5 === 0) {
            score -= P('roundFivePenalty');
        }

        const priorWeight = Math.max(P('minWeight'), Math.min(P('maxWeight'), score));

        // Encolhimento: sem dado, o prior é tudo; com muita amostra, o dado domina.
        const observed = this._observedWeight(num, total);
        if (observed === null) return Number(priorWeight.toFixed(4));

        const lambda = this._calibration.lambda;
        const blended = priorWeight * (1 - lambda) + observed * lambda;
        return Number(blended.toFixed(4));
    }

    /**
     * Avalia o Índice de Prêmio Sozinho (Anti-Crowd Score de 0 a 100) e o Multiplicador Estimado de Valor Esperado (EV)
     */
    static evaluateTicketAntiCrowd(numbers, config, analysis = null) {
        const sorted = [...numbers].sort((a, b) => a - b);
        const len = sorted.length;
        const total = config.total;
        if (len === 0) {
            return {
                antiCrowdScore: 50,
                expectedValueMultiplier: 1.0,
                crowdRiskLevel: 'MÉDIO',
                birthdayRatio: 0,
                hasArithmeticProgression: false,
                details: []
            };
        }

        const details = [];
        let penaltyPoints = 0;
        let bonusPoints = 0;

        // 1. Análise de Viés de Aniversário (01 a 31) e Meses (01 a 12)
        const birthdayCount = sorted.filter(n => n <= 31).length;
        const monthCount = sorted.filter(n => n <= 12).length;
        const birthdayRatio = birthdayCount / len;

        if (total > 31) {
            const expectedBirthdayRatio = 31 / total; // ~0.516 na Mega, ~0.387 na Quina
            if (birthdayRatio <= expectedBirthdayRatio) {
                bonusPoints += P('birthdayBonus') * (1 - birthdayRatio / Math.max(0.1, expectedBirthdayRatio));
                details.push(`+ Proteção Anti-Aniversário: ${len - birthdayCount}/${len} dezenas acima do dia 31`);
            } else {
                const excess = (birthdayRatio - expectedBirthdayRatio) / (1 - expectedBirthdayRatio);
                penaltyPoints += P('birthdayPenalty') * excess;
                if (birthdayRatio >= 0.8) {
                    details.push(`- Alto risco de divisão: ${birthdayCount}/${len} dezenas na faixa de datas (01-31)`);
                }
            }

            if (monthCount >= Math.ceil(len * 0.5)) {
                penaltyPoints += P('monthPenalty');
            }
        }

        // 2. Detecção de Progressão Aritmética (ex: espaçamento constante d entre 3+ dezenas consecutivas)
        const diffs = [];
        for (let i = 0; i < len - 1; i++) {
            diffs.push(sorted[i + 1] - sorted[i]);
        }
        const uniqueDiffs = new Set(diffs);
        const hasFullAP = len >= 4 && uniqueDiffs.size === 1;
        let equalDiffStreak = 1;
        let maxEqualDiffStreak = 1;
        for (let i = 1; i < diffs.length; i++) {
            if (diffs[i] === diffs[i - 1]) {
                equalDiffStreak++;
                if (equalDiffStreak > maxEqualDiffStreak) maxEqualDiffStreak = equalDiffStreak;
            } else {
                equalDiffStreak = 1;
            }
        }

        const hasArithmeticProgression =
            hasFullAP || (len <= 6 && maxEqualDiffStreak >= 3) || (len >= 15 && maxEqualDiffStreak >= 6);
        if (hasArithmeticProgression) {
            penaltyPoints += P('arithmeticPenalty');
            details.push(`- Padrão de progressão aritmética detectado (muito jogado por humanos)`);
        } else {
            bonusPoints += P('arithmeticBonus');
            details.push(`+ Quebra de simetria aritmética (espaçamentos irregulares orgânicos)`);
        }

        // 3. Concentração de Terminações (mesmo último dígito, ex: 04, 14, 24, 34)
        const lastDigits = {};
        sorted.forEach(n => {
            const d = n % 10;
            lastDigits[d] = (lastDigits[d] || 0) + 1;
        });
        const maxSameEnding = Math.max(0, ...Object.values(lastDigits));
        const expectedMaxEnding = Math.max(2, Math.ceil(len / 5));
        if (maxSameEnding > expectedMaxEnding) {
            penaltyPoints += (maxSameEnding - expectedMaxEnding) * P('endingPenaltyUnit');
            details.push(`- Concentração na mesma coluna/terminação (${maxSameEnding} dezenas)`);
        } else {
            bonusPoints += P('endingBonus');
        }

        // 4. Concentração de Números Fetiche / Sorte
        const luckyCount = sorted.filter(n => LUCKY_CROWD_NUMBERS.has(n)).length;
        const expectedLucky = (len * LUCKY_CROWD_NUMBERS.size) / total;
        if (luckyCount > expectedLucky + 1.5) {
            penaltyPoints += (luckyCount - expectedLucky) * P('luckyPenaltyUnit');
        } else if (luckyCount <= Math.ceil(expectedLucky)) {
            bonusPoints += P('luckyBonus');
        }

        // 5. Geometria de Linhas/Colunas (Evitar linhas ou colunas totalmente preenchidas na Mega/Quina)
        const geom = StatisticalAnalyzer.analyzeTicketGeometry(sorted, total);
        if (total >= 60 && (geom.maxInSingleRow >= 4 || geom.maxInSingleCol >= 3)) {
            penaltyPoints += P('geometryPenalty');
            details.push(`- Desenho linear no volante (alta incidência de apostas manuais)`);
        }

        // 6. Cópia excessiva do último sorteio
        const lastDraw = analysis?.lastDrawNumbers || [];
        if (lastDraw.length > 0) {
            const overlap = sorted.filter(n => lastDraw.includes(n)).length;
            const maxNormalOverlap = Math.ceil((len * (config.drawn || len)) / total) + 1;
            if (overlap > maxNormalOverlap) {
                penaltyPoints += (overlap - maxNormalOverlap) * P('repetitionPenaltyUnit');
            }
        }

        const rawScore = P('scoreBase') + bonusPoints - penaltyPoints;
        const antiCrowdScore = Number(Math.max(5, Math.min(99, rawScore)).toFixed(1));

        // Multiplicador Estimado de Valor Esperado (EV Multiplier)
        // ⚠️ O "2,4x menos divisões" que este comentário afirmava NÃO tem fonte e não foi
        // verificado. A escala abaixo (evScaleLarge/evScaleSmall) é uma aproximação
        // declarada em CROWD_PRIORS, não uma medida. Serve para ORDENAR bilhetes por
        // popularidade — não para prometer valor esperado.
        const scaleFactor = total >= 60 ? P('evScaleLarge') : P('evScaleSmall');
        const expectedValueMultiplier = Number((1.0 + ((antiCrowdScore - 50) / 100) * scaleFactor).toFixed(2));

        let crowdRiskLevel = 'BAIXO (Ideal p/ Prêmio Sozinho)';
        if (antiCrowdScore < P('riskThresholdHigh')) crowdRiskLevel = 'ALTO (Combinação Popular)';
        else if (antiCrowdScore < P('riskThresholdModerate')) crowdRiskLevel = 'MODERADO';

        const calibration = this.getCalibration();
        return {
            antiCrowdScore,
            expectedValueMultiplier: Math.max(0.5, expectedValueMultiplier),
            crowdRiskLevel,
            priorStatus: {
                calibrated: Boolean(calibration),
                source: calibration?.source ?? null,
                sampleSize: calibration?.sampleSize ?? null,
                note: calibration
                    ? 'Pesos encolhidos entre o prior de literatura e a popularidade observada.'
                    : 'Prior de literatura: direções suportadas, magnitudes não calibradas para o Brasil.'
            },
            birthdayRatio: Number((birthdayRatio * 100).toFixed(1)),
            hasArithmeticProgression,
            details
        };
    }

    /**
     * Proveniência de cada constante: o que tem suporte publicado e o que é
     * escolha de julgamento. Existe para que ninguém confunda a escala deste
     * motor com uma medida calibrada de popularidade.
     */
    static getPriorProvenance() {
        const priors = Object.entries(CROWD_PRIORS).map(([key, v]) => ({ key, ...v }));
        const byBasis = { literatura: 0, arbitrário: 0, 'sem fonte': 0 };
        for (const p of priors) byBasis[p.basis] = (byBasis[p.basis] || 0) + 1;

        const calibration = this.getCalibration();
        return {
            priors,
            byBasis,
            total: priors.length,
            calibrated: Boolean(calibration),
            calibration,
            sources: CROWD_SOURCES,
            note: calibration
                ? 'Calibração ativa: pesos encolhidos entre prior e popularidade observada.'
                : 'Sem calibração: ' +
                  byBasis.literatura +
                  ' priors têm direção documentada; ' +
                  (byBasis.arbitrário + byBasis['sem fonte']) +
                  ' são escolha de julgamento sem verificação empírica no Brasil.'
        };
    }
}
