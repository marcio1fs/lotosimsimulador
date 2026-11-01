/**
 * EvidenceWeightingEngine — pesos proporcionais à evidência disponível
 *
 * O PROBLEMA
 * ----------
 * O score composto somava 13 fatores com pesos fixos. Dois deles — cadeias de
 * Markov (0,10) e co-ocorrência de pares (0,11) — somavam **21% da decisão**
 * sem nenhuma sustentação: a auditoria mostrou que, em dados de sorteio,
 * nenhuma transição de Markov sobrevive ao controle de falsas descobertas
 * (FDR 5%) e que a co-ocorrência de pares é indistinguível de independência.
 *
 * Um fator que não pode ser distinguido de ruído não deveria decidir nada. Mas
 * o sistema continuava somando as "puxadas" de Markov e a "sinergia de pares"
 * como se fossem sinal.
 *
 * A REGRA
 * -------
 * Cada fator que faz uma afirmação estatística tem um teste associado. O peso
 * efetivo é:
 *
 *     peso_efetivo = peso_padrão × multiplicador
 *     multiplicador = 1  se o teste rejeita H0 (há evidência)
 *                   = 0  se o teste foi executado e NÃO rejeita H0
 *                   = 1  se não há teste disponível (não se pode afirmar nada)
 *
 * O último caso é importante: **ausência de teste não é evidência de ausência**.
 * Com histórico curto, o teste não roda e o fator mantém o peso — o relatório
 * apenas registra `assessed: false`. Zerar nesse caso seria trocar um erro por
 * outro.
 *
 * Depois do ajuste os pesos são renormalizados para somar 1, de modo que a
 * decisão passa a ser tomada pelos fatores que restaram.
 *
 * ESCOPO DELIBERADO
 * -----------------
 * Só entram aqui os fatores cuja afirmação tem teste explícito no sistema:
 * Markov e co-ocorrência. Fatores estruturais (paridade, soma, distribuição,
 * geometria) não afirmam previsão — moldam o bilhete — e o anti-crowd é teoria
 * dos jogos (reduzir o rateio esperado), não inferência estatística. Aplicar o
 * mesmo portão a eles seria confundir categorias diferentes.
 */

/**
 * Registro de fatores com teste estatístico associado.
 * Cada extrator recebe `analysis` e devolve { tested, tests, significant, ... }.
 */
const EVIDENCE_EXTRACTORS = {
    markov: {
        label: 'Cadeias de Markov',
        extract(analysis) {
            const mkv = analysis?.markovStats;
            if (!mkv) return { tested: false, reason: 'análise de Markov indisponível' };

            const tests = Number(mkv.testedTransitions ?? 0);
            const significant = Number(mkv.significantTransitions ?? 0);
            if (tests <= 0) {
                return { tested: false, reason: 'histórico insuficiente para testar transições' };
            }

            const rejected = significant > 0
                || mkv.hasStatisticallySignificantSignal === true;

            return {
                tested: true,
                tests,
                significant,
                rejected,
                method: mkv.method || 'FDR de Benjamini-Hochberg (5%)',
                reason: rejected
                    ? `${significant} de ${tests} transições sobrevivem ao FDR 5%`
                    : `nenhuma das ${tests} transições sobrevive ao FDR 5%`
            };
        }
    },
    cooccurrence: {
        label: 'Co-ocorrência de pares',
        extract(analysis) {
            const pairs = analysis?.topPairs;
            if (!Array.isArray(pairs) || pairs.length === 0) {
                return { tested: false, reason: 'análise de pares indisponível' };
            }

            const testedPairs = pairs.filter(p => Number.isFinite(p?.pValue) || Number.isFinite(p?.qValue));
            if (testedPairs.length === 0) {
                return { tested: false, reason: 'pares examinados sem teste de significância' };
            }

            const significant = testedPairs.filter(p => p.significant === true).length;
            const examined = Number(analysis?.pairStats?.examined ?? testedPairs.length);
            const rejected = significant > 0;

            return {
                tested: true,
                tests: testedPairs.length,
                examined,
                significant,
                rejected,
                method: 'Binomial exato com FDR de Benjamini-Hochberg (5%)',
                reason: rejected
                    ? `${significant} par(es) de ${testedPairs.length} examinados sobrevivem ao FDR 5%`
                    : `nenhum dos ${testedPairs.length} pares examinados sobrevive ao FDR 5% (família de ${examined})`
            };
        }
    }
};

export class EvidenceWeightingEngine {
    /** Fatores com teste embutido, na ordem em que aparecem no relatório. */
    static FACTORS = Object.keys(EVIDENCE_EXTRACTORS);

    /** Cache da avaliação por identidade do objeto de análise (independe dos pesos). */
    static _assessmentCache = new WeakMap();

    /**
     * Avalia a evidência de cada fator testável.
     * @param {object} analysis - objeto de StatisticalAnalyzer.analyze
     * @param {object} [options]
     * @returns {{factors: Array, assessedAny: boolean, gatedFactors: string[], notes: string[]}}
     */
    static assess(analysis, options = {}) {
        const enabled = options.enabled !== false;
        const cacheable = analysis && typeof analysis === 'object';
        if (cacheable) {
            const cached = this._assessmentCache.get(analysis);
            if (cached && cached.enabled === enabled) return cached.assessment;
        }

        const factors = [];

        for (const [factor, { label, extract }] of Object.entries(EVIDENCE_EXTRACTORS)) {
            const evidence = extract(analysis);
            const assessed = evidence.tested === true;
            const rejected = evidence.rejected === true;

            // Portão: zera somente quando o teste rodou e não rejeitou H0.
            const multiplier = !enabled || !assessed ? 1 : (rejected ? 1 : 0);

            factors.push({
                factor,
                label,
                assessed,
                examined: evidence.tested === true,
                tests: evidence.tests ?? 0,
                significant: evidence.significant ?? 0,
                rejectedH0: assessed ? rejected : null,
                multiplier,
                method: evidence.method ?? null,
                reason: evidence.reason ?? null
            });
        }

        const gatedFactors = factors.filter(f => f.multiplier === 0).map(f => f.factor);

        const assessment = {
            factors,
            assessedAny: factors.some(f => f.assessed),
            gatedFactors,
            notes: this._buildNotes(factors, enabled)
        };

        if (cacheable) this._assessmentCache.set(analysis, { enabled, assessment });
        return assessment;
    }

    /**
     * Textos em pt-BR explicando o que foi feito com cada fator.
     * @private
     */
    static _buildNotes(factors, enabled) {
        if (!enabled) return ['Ponderação por evidência desativada: pesos padrão mantidos.'];

        const notes = [];
        for (const f of factors) {
            if (!f.assessed) {
                notes.push(`${f.label}: sem teste disponível (${f.reason}) — peso mantido.`);
            } else if (f.multiplier === 0) {
                notes.push(`${f.label}: ${f.reason} — peso zerado.`);
            } else {
                notes.push(`${f.label}: ${f.reason} — peso mantido.`);
            }
        }
        return notes;
    }

    /**
     * Aplica o portão de evidência aos pesos e renormaliza.
     *
     * O resultado é cacheado por identidade do objeto `analysis` (e pelos pesos
     * base), porque esta função é chamada dentro do laço de geração de
     * candidatos — centenas de vezes por lote.
     *
     * @param {Object<string, number>} baseWeights - pesos de partida
     * @param {object} analysis
     * @param {object} [options] - { enabled?: boolean }
     * @returns {{weights: Object<string, number>, report: object}}
     */
    static applyWeights(baseWeights, analysis, options = {}) {
        const enabled = options.enabled !== false;

        // Sem análise não há o que avaliar: devolve os pesos como vieram.
        if (!analysis || typeof analysis !== 'object') {
            return {
                weights: { ...baseWeights },
                report: {
                    applied: false,
                    factors: [],
                    gatedFactors: [],
                    removedWeight: 0,
                    notes: ['Sem análise disponível: pesos padrão mantidos.']
                }
            };
        }

        const assessment = this.assess(analysis, { enabled });
        const weights = { ...baseWeights };
        let removedWeight = 0;
        let claimedWeight = 0;

        for (const f of assessment.factors) {
            const current = Number(weights[f.factor] ?? 0);
            if (current > 0) claimedWeight += current;
            if (f.multiplier === 0 && current > 0) {
                removedWeight += current;
                weights[f.factor] = 0;
            }
        }

        // Renormaliza para somar 1: a decisão passa a ser tomada pelo que restou.
        const total = Object.values(weights).reduce((s, w) => s + (Number(w) || 0), 0);
        let normalized = weights;
        if (total > 0 && Math.abs(total - 1) > 1e-12) {
            normalized = {};
            for (const [k, v] of Object.entries(weights)) {
                normalized[k] = (Number(v) || 0) / total;
            }
        }

        const applied = removedWeight > 0;
        const report = {
            applied,
            method: 'Ponderação por evidência (portão FDR 5%)',
            factors: assessment.factors.map(f => ({
                ...f,
                defaultWeight: Number(baseWeights[f.factor] ?? 0),
                effectiveWeight: Number(normalized[f.factor] ?? 0)
            })),
            gatedFactors: assessment.gatedFactors,
            claimedWeight: Number(claimedWeight.toFixed(6)),
            removedWeight: Number(removedWeight.toFixed(6)),
            notes: assessment.notes,
            summary: applied
                ? `Pesos zerados por falta de evidência: ${assessment.gatedFactors.join(', ')}. Os demais fatores foram renormalizados para somar 1.`
                : 'Todos os fatores testáveis apresentaram evidência suficiente (ou não puderam ser testados): pesos originais preservados.'
        };

        return { weights: normalized, report };
    }

    /**
     * Resumo compacto (para transportar à interface sem o relatório completo).
     * @param {object} report
     * @returns {object|null}
     */
    static summarize(report) {
        if (!report) return null;
        return {
            applied: report.applied === true,
            gatedFactors: [...(report.gatedFactors || [])],
            removedWeight: report.removedWeight ?? 0,
            factors: (report.factors || []).map(f => ({
                factor: f.factor,
                label: f.label,
                assessed: f.assessed,
                defaultWeight: f.defaultWeight,
                effectiveWeight: f.effectiveWeight,
                reason: f.reason
            })),
            summary: report.summary || ''
        };
    }
}
