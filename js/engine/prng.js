/**
 * PRNG - Gerador Pseudo-Aleatório com Seed para Reprodutibilidade
 * Implementa Mulberry32 para geração determinística de números.
 */

export class SeededRandom {
    /**
     * @param {number} [seed] - Semente. Se não fornecida, usa Date.now()
     */
    constructor(seed) {
        this.seed = seed ?? Date.now();
        this._state = this.seed | 0;
    }

    /** Retorna float em [0, 1) */
    next() {
        let t = (this._state += 0x6D2B79F5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Retorna inteiro em [min, max] inclusive */
    nextInt(min, max) {
        return min + Math.floor(this.next() * (max - min + 1));
    }

    /** Embaralha array in-place (Fisher-Yates) */
    shuffle(array) {
        const arr = [...array];
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    /** Amostra k elementos sem reposição */
    sample(array, k) {
        return this.shuffle(array).slice(0, k);
    }

    /** Seleção por roleta ponderada */
    weightedSelect(items, weights) {
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let rand = this.next() * totalWeight;
        for (let i = 0; i < items.length; i++) {
            rand -= weights[i];
            if (rand <= 0) return items[i];
        }
        return items[items.length - 1];
    }
}
