/**
 * PairCountMatrix — contagem de pares de dezenas sem alocar O(n²) objetos
 *
 * O PROBLEMA
 * ----------
 * A análise estatística precisa saber quantas vezes cada par {a, b} saiu junto.
 * A implementação anterior guardava isso em um objeto aninhado:
 *
 *     pairMatrix[a][b] = contágem        // um objeto JS por par
 *
 * Para 100 dezenas (Lotomania) são **4.950 objetos**; para 80 (Quina), 3.160;
 * para 60 (Mega), 1.770. Um objeto JS custa dezenas de bytes de cabeçalho, mapa
 * oculto e referências — medido neste projeto: o `analyze()` da Lotomania
 * alocava **21,6 MB** de heap para 400 concursos, e boa parte disso era essa
 * matriz de objetos.
 *
 * Pior: `analyzeFast()` — chamado uma vez por concurso em todo backtest — também
 * montava a matriz. Um backtest de 200 concursos da Lotomania alocava ~1 milhão
 * de objetos descartáveis só para jogá-los fora em seguida.
 *
 * A SOLUÇÃO
 * ---------
 * Um único `Int32Array` com (total+1)² posições — 40 KB no pior caso (100
 * dezenas) contra centenas de KB de objetos. `get`/`increment` normalizam a
 * ordem para que `{a,b}` e `{b,a}` sejam a mesma célula, mantendo a semântica
 * anterior (só i < j era armazenado).
 */

export class PairCountMatrix {
    /**
     * @param {number} total - maior dezena possível (índices válidos: 1..total)
     */
    constructor(total) {
        const n = Number(total);
        if (!Number.isInteger(n) || n < 2) {
            throw new RangeError(`total inválido para a matriz de pares: ${total}`);
        }
        this.total = n;
        this.stride = n + 1;
        this.values = new Int32Array(this.stride * this.stride);
        /** Número de pares possíveis: C(total, 2). */
        this.size = (n * (n - 1)) / 2;
    }

    /** Índice linear do par normalizado (a < b). */
    index(a, b) {
        const lo = a < b ? a : b;
        const hi = a < b ? b : a;
        return lo * this.stride + hi;
    }

    /** Contagem do par {a,b}. Dezenas fora de 1..total contam como zero. */
    get(a, b) {
        const x = Number(a);
        const y = Number(b);
        if (x === y || x < 1 || y < 1 || x > this.total || y > this.total) return 0;
        return this.values[this.index(x, y)];
    }

    /** Soma 1 ao par {a,b} e devolve a nova contagem. */
    increment(a, b) {
        const x = Number(a);
        const y = Number(b);
        if (x === y || x < 1 || y < 1 || x > this.total || y > this.total) return 0;
        const i = this.index(x, y);
        const next = this.values[i] + 1;
        this.values[i] = next;
        return next;
    }

    /** Define a contagem do par (usado em testes e importação). */
    set(a, b, value) {
        const x = Number(a);
        const y = Number(b);
        if (x === y || x < 1 || y < 1 || x > this.total || y > this.total) return;
        this.values[this.index(x, y)] = Math.max(0, Math.trunc(Number(value) || 0));
    }

    /** Maior contagem observada (0 se nenhum par saiu junto). */
    maxCount() {
        let max = 0;
        for (let i = 0; i < this.values.length; i++) if (this.values[i] > max) max = this.values[i];
        return max;
    }

    /** Soma de todas as contagens (equivale a Σ C(drawn,2) por concurso). */
    totalCount() {
        let sum = 0;
        for (let i = 0; i < this.values.length; i++) sum += this.values[i];
        return sum;
    }

    /**
     * Os `k` pares mais frequentes, em ordem estável (contagem desc, depois
     * a asc, depois b asc) — a MESMA ordem de um `sort` estável decrescente.
     *
     * Percorre C(total,2) células sem criar um objeto por par: só os `k`
     * escolhidos viram objeto. Era esse `topPairs` completo que duplicava a
     * memória da matriz na implementação anterior (mais 4.950 objetos na
     * Lotomania, guardados apenas para descobrir os 30 primeiros).
     *
     * @param {number} k
     * @returns {{a: number, b: number, count: number}[]}
     */
    topEntries(k = 30) {
        const limit = Math.max(0, Math.floor(k));
        if (limit === 0) return [];
        const out = [];
        for (let a = 1; a <= this.total; a++) {
            const base = a * this.stride;
            for (let b = a + 1; b <= this.total; b++) {
                const count = this.values[base + b];
                if (out.length < limit) {
                    this._insertSorted(out, { a, b, count });
                } else if (count > out[out.length - 1].count) {
                    out.pop();
                    this._insertSorted(out, { a, b, count });
                }
            }
        }
        return out;
    }

    /** Insere mantendo ordem decrescente estável (empate: quem chegou antes fica). */
    _insertSorted(out, entry) {
        out.push(entry);
        let i = out.length - 1;
        while (i > 0 && out[i].count > out[i - 1].count) {
            const tmp = out[i - 1];
            out[i - 1] = out[i];
            out[i] = tmp;
            i--;
        }
    }

    /** Objeto aninhado no formato antigo — só para compatibilidade/inspeção. */
    toNestedObject() {
        const nested = {};
        for (let a = 1; a <= this.total; a++) {
            nested[a] = {};
            for (let b = a + 1; b <= this.total; b++) {
                nested[a][b] = this.values[a * this.stride + b];
            }
        }
        return nested;
    }
}

/**
 * Lê a contagem de um par aceitando tanto `PairCountMatrix` quanto o formato
 * antigo (objeto aninhado), para que consumidores não quebrem com dados
 * serializados de versões anteriores.
 *
 * @param {PairCountMatrix|object|null|undefined} matrix
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function pairCount(matrix, a, b) {
    if (!matrix) return 0;
    if (typeof matrix.get === 'function') return matrix.get(a, b);
    const row = matrix[a];
    if (!row) return 0;
    return row[b] || 0;
}
