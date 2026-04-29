import { LotteryModel } from '../models/lottery.js';

export class LotteryAPIService {
    static async fetchLatest(type) {
        const apiName = LotteryModel.CONFIG[type].apiName;
        const urls = [
            `https://loteriascaixa-api.herokuapp.com/api/${apiName}/latest`,
            `https://servicebus2.caixa.gov.br/portaldeloterias/api/${apiName}`
        ];
        for (const url of urls) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s timeout

                const resp = await fetch(url, { 
                    mode: 'cors', 
                    headers: { 'Accept': 'application/json' },
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                if (resp.ok) return await resp.json();
            } catch (e) {
                console.warn(`Failed to fetch from ${url}:`, e.name === 'AbortError' ? 'Timeout' : e);
            }
        }
        return null;
    }

    static parseResult(apiData, type) {
        let dezenas = [];
        if (apiData.listaDezenas) dezenas = apiData.listaDezenas.map(d => String(d).padStart(2, '0'));
        else if (apiData.dezenas) dezenas = apiData.dezenas.map(d => String(d).padStart(2, '0'));
        else if (apiData.dezenasOrdemSorteio) dezenas = apiData.dezenasOrdemSorteio.map(d => String(d).padStart(2, '0'));
        
        return {
            concurso: apiData.concurso || 0,
            data: apiData.data || new Date().toLocaleDateString('pt-BR'),
            dezenas: dezenas.sort((a, b) => a - b),
            acumulado: apiData.acumulado || false,
            valor: apiData.valorEstimadoProximoConcurso || apiData.valorEstimado || ''
        };
    }
}
