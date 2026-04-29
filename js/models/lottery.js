/**
 * Model: Lottery - Configurações, Regras de Negócio e Algoritmos
 */
export class LotteryModel {
    static CONFIG = {
        lotofacil: { name: 'Lotofácil', total: 25, pick: 15, drawn: 15, color: 'lotofacil', icon: '🟣', apiName: 'lotofacil', minPar: 6, maxPar: 9, minSum: 160, maxSum: 220 },
        mega: { name: 'Mega Sena', total: 60, pick: 6, drawn: 6, color: 'mega', icon: '🟢', apiName: 'megasena', minPar: 2, maxPar: 4, minSum: 150, maxSum: 220 },
        lotomania: { name: 'Lotomania', total: 100, pick: 50, drawn: 20, color: 'lotomania', icon: '🔴', apiName: 'lotomania', minPar: 22, maxPar: 28, minSum: 2400, maxSum: 2600 },
        quina: { name: 'Quina', total: 80, pick: 5, drawn: 5, color: 'quina', icon: '🔵', apiName: 'quina', minPar: 2, maxPar: 3, minSum: 150, maxSum: 250 }
    };

    static PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];

    /**
     * Analisa a frequência das dezenas nos resultados fornecidos
     */
    static analyzeFrequencies(results, type) {
        const cfg = this.CONFIG[type];
        const freq = {};
        const atraso = {};
        
        // Inicializa contadores
        for (let i = 1; i <= cfg.total; i++) {
            freq[i] = 0;
            atraso[i] = -1; // -1 indica que ainda não foi encontrado
        }

        // Processa resultados em uma única passada
        results.forEach((r, idx) => {
            if (r.dezenas) {
                // Converte para números uma única vez por concurso se necessário
                const numbers = Array.isArray(r.dezenas) ? r.dezenas.map(Number) : [];
                
                numbers.forEach(num => {
                    if (freq[num] !== undefined) {
                        freq[num]++;
                        // Se é a primeira vez que vemos este número (mais recente), define o atraso
                        if (atraso[num] === -1) {
                            atraso[num] = idx;
                        }
                    }
                });
            }
        });

        // Define atraso máximo para números que nunca saíram no set atual
        for (let i = 1; i <= cfg.total; i++) {
            if (atraso[i] === -1) atraso[i] = results.length;
        }

        return { freq, atraso };
    }

    /**
     * Valida se um jogo segue padrões estatísticos saudáveis
     */
    static validateGame(numbers, type) {
        const cfg = this.CONFIG[type];
        const evens = numbers.filter(n => n % 2 === 0).length;
        const odds = numbers.length - evens;
        const sum = numbers.reduce((a, b) => a + b, 0);
        const primes = numbers.filter(n => this.PRIMES.includes(n)).length;

        // Regras básicas de equilíbrio
        const parOK = evens >= cfg.minPar && evens <= cfg.maxPar;
        const sumOK = sum >= (cfg.minSum || 0) && sum <= (cfg.maxSum || 9999);
        
        return { 
            valid: parOK && sumOK,
            stats: { evens, odds, sum, primes }
        };
    }

    /**
     * Gera um jogo inteligente usando pesos e filtros
     */
    static generateSmartGame(type, analysis, strategy, fixed = [], excluded = []) {
        const cfg = this.CONFIG[type];
        const { freq, atraso } = analysis;
        
        const freqs = Object.values(freq);
        const maxFreq = Math.max(...freqs) || 1;
        const minFreq = Math.min(...freqs) || 0;
        const range = maxFreq - minFreq || 1;

        const maxAtraso = Math.max(...Object.values(atraso)) || 1;

        let pool = [];
        for (let i = 1; i <= cfg.total; i++) {
            if (excluded.includes(i)) continue;
            if (fixed.includes(i)) continue;

            const f = freq[i] || 0;
            const a = atraso[i] || 0;
            
            let weight = 1;
            switch (strategy) {
                case 'weighted': 
                    weight = (f - minFreq + 1) / (range + 1); 
                    break;
                case 'hot': 
                    weight = Math.pow((f - minFreq + 1) / (range + 1), 2); 
                    break;
                case 'cold': 
                    weight = 1 - (f - minFreq) / (range + 1); 
                    break;
                case 'ai': 
                    // IA combina frequência alta com dezenas que estão "amadurecendo" (atraso moderado)
                    const freqWeight = (f - minFreq) / range;
                    const atrasoWeight = a / maxAtraso;
                    weight = (freqWeight * 0.4) + (atrasoWeight * 0.4) + (Math.random() * 0.2);
                    break;
            }
            pool.push({ num: i, weight });
        }

        // Tentar gerar um jogo válido até 50 vezes
        for (let attempt = 0; attempt < 50; attempt++) {
            let selected = [...fixed];
            let currentPool = [...pool].sort((a, b) => b.weight - a.weight);
            
            // Seleciona as melhores dezenas baseado no peso + um fator aleatório
            while (selected.length < cfg.pick && currentPool.length > 0) {
                const topN = Math.min(5, currentPool.length);
                const idx = Math.floor(Math.random() * topN);
                selected.push(currentPool[idx].num);
                currentPool.splice(idx, 1);
            }

            // Se ainda faltar números (ex: muitos excluídos), completa aleatoriamente
            while (selected.length < cfg.pick) {
                const n = Math.floor(Math.random() * cfg.total) + 1;
                if (!selected.includes(n) && !excluded.includes(n)) selected.push(n);
            }

            selected.sort((a, b) => a - b);
            const validation = this.validateGame(selected, type);
            
            if (validation.valid || attempt === 49) {
                return { numbers: selected, stats: validation.stats };
            }
        }
    }

    /**
     * Calcula um score de confiança para o jogo (0-100)
     */
    static calculateScore(game, type, analysis) {
        const { freq } = analysis;
        const cfg = this.CONFIG[type];
        const validation = this.validateGame(game, type);
        
        // Média de frequência das dezenas do jogo
        const avgFreq = game.reduce((s, n) => s + (freq[n] || 0), 0) / game.length;
        const maxF = Math.max(...Object.values(freq)) || 1;
        
        let score = (avgFreq / maxF) * 70; // 70% baseado na frequência
        if (validation.valid) score += 30; // 30% bônus por equilíbrio estatístico
        
        return Math.min(score, 99.9).toFixed(1);
    }
}

