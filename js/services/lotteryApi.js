import { LotteryModel } from '../models/lottery.js';

export class LotteryAPIService {
    /**
     * Mapeamento de endpoints e mirrors públicos de consulta oficial
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

    /**
     * Busca o último concurso de uma loteria com retries, timeout e validação rigorosa
     * @param {string} type - Modalidade da loteria ('lotofacil', 'mega', 'lotomania', 'quina')
     * @param {number} retriesPerUrl - Quantidade de tentativas por URL
     */
    static async fetchLatest(type, retriesPerUrl = 2) {
        const config = LotteryModel.CONFIG[type];
        if (!config) return null;

        const urls = this.ENDPOINTS[type] || [
            `https://loteriascaixa-api.herokuapp.com/api/${config.apiName}/latest`
        ];

        for (const url of urls) {
            for (let attempt = 0; attempt < retriesPerUrl; attempt++) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout

                    const resp = await fetch(url, {
                        mode: 'cors',
                        headers: { 'Accept': 'application/json' },
                        signal: controller.signal
                    });

                    clearTimeout(timeoutId);

                    if (resp.ok) {
                        const json = await resp.json();
                        const parsed = this.parseAndValidateResult(json, type);
                        if (parsed) {
                            return parsed; // Resposta válida encontrada!
                        }
                    }
                } catch (e) {
                    const isTimeout = e.name === 'AbortError';
                    console.warn(`Tentativa ${attempt + 1} falhou para ${url} (${type}):`, isTimeout ? 'Timeout' : e.message);
                    // Pausa breve antes do retry
                    if (attempt < retriesPerUrl - 1) {
                        await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
                    }
                }
            }
        }

        console.error(`Não foi possível obter dados da API externa para ${type} em nenhuma das URLs.`);
        return null;
    }

    /**
     * Sanitiza e valida estruturalmente o resultado obtido da API externa
     */
    static parseAndValidateResult(apiData, type) {
        if (!apiData || typeof apiData !== 'object') return null;

        const config = LotteryModel.CONFIG[type];
        const expectedDrawnCount = config.drawn || config.pick;

        // Extração flexível do concurso
        const concurso = parseInt(apiData.concurso || apiData.numero) || 0;
        if (concurso <= 0) return null;

        // Extração flexível das dezenas
        let rawDezenas = [];
        if (Array.isArray(apiData.listaDezenas)) rawDezenas = apiData.listaDezenas;
        else if (Array.isArray(apiData.dezenas)) rawDezenas = apiData.dezenas;
        else if (Array.isArray(apiData.dezenasOrdemSorteio)) rawDezenas = apiData.dezenasOrdemSorteio;
        else if (Array.isArray(apiData.dezenasSorteadasOrdemSorteio)) rawDezenas = apiData.dezenasSorteadasOrdemSorteio;

        if (!rawDezenas || rawDezenas.length === 0) return null;

        // Validação e normalização de números
        const numericNumbers = rawDezenas.map(d => parseInt(d, 10)).filter(n => !isNaN(n) && n >= 1 && n <= config.total);
        const uniqueNumbers = [...new Set(numericNumbers)].sort((a, b) => a - b);

        // Valida se a quantidade de dezenas bate com a regra do jogo
        if (uniqueNumbers.length !== expectedDrawnCount) {
            console.warn(`Quantidade de dezenas inválida (${uniqueNumbers.length} vs esperada ${expectedDrawnCount}) para ${type} concurso #${concurso}`);
            return null;
        }

        const formattedDezenas = uniqueNumbers.map(n => String(n).padStart(2, '0'));

        return {
            concurso,
            data: apiData.dataApuracao || apiData.data || new Date().toLocaleDateString('pt-BR'),
            dezenas: formattedDezenas,
            acumulado: Boolean(apiData.acumulado),
            valor: apiData.valorEstimadoProximoConcurso || apiData.valorEstimado || ''
        };
    }
}
