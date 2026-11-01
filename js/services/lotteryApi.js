import { LotteryModel } from '../models/lottery.js';
import { SeededRandom } from '../engine/prng.js';
import { resolveLatest, resolveHistory, validateDraw, DRAW_SOURCES } from './drawSourcePolicy.js';

export class LotteryAPIService {
    /**
     * Mapeamento de endpoints e mirrors públicos de consulta oficial (histórico completo e último concurso)
     */
    static ENDPOINTS = {
        lotofacil: [
            'https://loteriascaixa-api.herokuapp.com/api/lotofacil/latest',
            'https://servicebus2.caixa.gov.br/portaldeloterias/api/lotofacil'
        ],
        mega: [
            'https://loteriascaixa-api.herokuapp.com/api/megasena/latest',
            'https://servicebus2.caixa.gov.br/portaldeloterias/api/megasena'
        ],
        lotomania: [
            'https://loteriascaixa-api.herokuapp.com/api/lotomania/latest',
            'https://servicebus2.caixa.gov.br/portaldeloterias/api/lotomania'
        ],
        quina: [
            'https://loteriascaixa-api.herokuapp.com/api/quina/latest',
            'https://servicebus2.caixa.gov.br/portaldeloterias/api/quina'
        ]
    };

    static HISTORY_ENDPOINTS = {
        lotofacil: 'https://loteriascaixa-api.herokuapp.com/api/lotofacil',
        mega: 'https://loteriascaixa-api.herokuapp.com/api/megasena',
        lotomania: 'https://loteriascaixa-api.herokuapp.com/api/lotomania',
        quina: 'https://loteriascaixa-api.herokuapp.com/api/quina'
    };

    /**
     * Busca histórico recente em lote (até maxDraws concursos) para garantir base estatística robusta (>= 100 concursos)
     */
    static async fetchHistoryBatch(type, maxDraws = 150) {
        const config = LotteryModel.CONFIG[type];
        if (!config) return [];

        // O histórico completo só existe no espelho comunitário — a API oficial
        // publica apenas o último concurso. A política de fontes torna essa
        // dependência explícita (supportsHistory) em vez de escondida numa URL.
        try {
            const result = await resolveHistory({ type, timeoutMs: 8000, retries: 1, maxDraws });

            this.lastResolution = this.lastResolution || {};
            this.lastResolution[`${type}:history`] = {
                sourceId: result.sourceId,
                degraded: result.degraded,
                rejected: result.rejected.length,
                sourcesTried: result.sourcesTried
            };

            if (result.rejected.length > 0) {
                console.warn(
                    `${result.rejected.length} concurso(s) de ${type} rejeitado(s) na validação de esquema:`,
                    result.rejected.slice(0, 3)
                );
            }

            if (result.draws.length > 0) {
                return result.draws.map(d => ({
                    concurso: d.concurso,
                    data: d.data,
                    dezenas: d.dezenas,
                    acumulado: d.acumulou,
                    valor: d.valorEstimado ?? ''
                }));
            }
        } catch (e) {
            console.warn(`Aviso ao buscar histórico completo de ${type}, tentando fallback:`, e.message);
        }

        // Fallback: busca o último concurso e garante série histórica mínima para calibração
        const latest = await this.fetchLatest(type);
        return latest ? [latest] : [];
    }

    /**
     * Preenche a série até `minCount` concursos quando a API de lote está indisponível.
     *
     * ⚠️ INTEGRIDADE: os concursos gerados aqui são SINTÉTICOS (não oficiais) e por isso
     * são marcados com `synthetic: true`. Eles existem apenas para evitar estados vazios
     * na interface — NUNCA devem sustentar afirmações de inferência estatística
     * (p-value, backtest, chi-quadrado). `ForecastPolicy` bloqueia essas afirmações
     * automaticamente quando detecta registros sintéticos.
     */
    static countSynthetic(draws) {
        if (!Array.isArray(draws)) return 0;
        return draws.filter(d => d && d.synthetic === true).length;
    }

    static ensureMinimumHistoryDepth(existingDraws, type, minCount = 120) {
        if (existingDraws && existingDraws.length >= minCount) {
            return existingDraws;
        }

        const config = LotteryModel.CONFIG[type];
        if (!config) return existingDraws || [];

        const currentList = [...(existingDraws || [])].sort((a, b) => b.concurso - a.concurso);
        const latestConcurso = currentList[0]?.concurso || (type === 'lotofacil' ? 3250 : type === 'mega' ? 2800 : type === 'quina' ? 6600 : 2700);
        const existingConcursos = new Set(currentList.map(d => d.concurso));
        const drawnCount = config.drawn || config.pick;

        // Semente determinística baseada no tipo de loteria
        const typeSeeds = { lotofacil: 251501, mega: 600602, quina: 800503, lotomania: 1005004 };
        const rng = new SeededRandom(typeSeeds[type] || 123456);

        let cursorConcurso = latestConcurso - 1;
        while (currentList.length < minCount && cursorConcurso > 0) {
            if (!existingConcursos.has(cursorConcurso)) {
                const nums = new Set();
                while (nums.size < drawnCount) {
                    nums.add(rng.nextInt(1, config.total));
                }
                const sorted = [...nums].sort((a, b) => a - b).map(n => String(n).padStart(2, '0'));
                currentList.push({
                    lotteryType: type,
                    concurso: cursorConcurso,
                    data: 'Sintético (não oficial)',
                    dezenas: sorted,
                    synthetic: true,
                    fetchedAt: new Date().toISOString()
                });
                existingConcursos.add(cursorConcurso);
            }
            cursorConcurso--;
        }

        currentList.sort((a, b) => b.concurso - a.concurso);
        return currentList;
    }

    /**
     * Busca o último concurso, tentando as fontes em ORDEM DE PRIORIDADE.
     *
     * Oficial (Caixa) primeiro, espelho depois — sequencial, não em corrida:
     * quem responde primeiro não é quem é mais confiável. No navegador a fonte
     * oficial costuma falhar por CORS; essa falha é imediata e cai para o
     * espelho sem custo perceptível (ver `drawSourcePolicy.js`).
     *
     * @param {string} type
     * @param {number} retriesPerUrl - tentativas por fonte
     * @returns {Promise<object|null>}
     */
    static async fetchLatest(type, retriesPerUrl = 2) {
        const config = LotteryModel.CONFIG[type];
        if (!config) return null;

        const result = await resolveLatest({
            type,
            timeoutMs: 6000,
            retries: Math.max(1, retriesPerUrl)
        });

        this.lastResolution = this.lastResolution || {};
        this.lastResolution[type] = result;

        if (!result.draw) {
            console.error(
                `Não foi possível obter dados oficiais para ${type}. Tentativas: ` +
                result.errors.map(e => `${e.source}: ${e.error}`).join(' | ')
            );
            return null;
        }

        const { draw } = result;
        return {
            concurso: draw.concurso,
            data: draw.data,
            dezenas: draw.dezenas,
            acumulado: draw.acumulou,
            valor: draw.valorEstimado ?? '',
            source: result.sourceId
        };
    }

    /** Fontes disponíveis e suas capacidades (para diagnóstico/UI). */
    static getSources() {
        return DRAW_SOURCES.map(s => ({ ...s }));
    }

    /**
     * Sanitiza e valida estruturalmente o resultado obtido da API externa
     */
    static parseAndValidateResult(apiData, type) {
        const validation = validateDraw(apiData, type);
        if (!validation.ok) return null;
        const { draw } = validation;
        return {
            concurso: draw.concurso,
            data: draw.data || new Date().toLocaleDateString('pt-BR'),
            dezenas: draw.dezenas,
            acumulado: draw.acumulou,
            valor: draw.valorEstimado ?? ''
        };
    }
}
