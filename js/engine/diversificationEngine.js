/**
 * Máxima diversificação de carteira — recozimento simulado sobre frequência e sobreposição.
 *
 * O PROBLEMA QUE ESTE MOTOR RESOLVE
 * ---------------------------------
 * Nenhuma estratégia muda a chance de **um** jogo acertar: cada combinação de 15
 * entre 25 tem 1/3.268.760. O que muda, com o mesmo orçamento, é a chance de a
 * **carteira inteira** conter ao menos um jogo premiado. Medido com o próprio
 * código deste projeto (Lotofácil, 10 jogos, 300 mil sorteios simulados):
 *
 *   fechamento (pool de 19 dezenas) ...... 44,3% de chance de ≥1 jogo com 11+ acertos
 *   estratégias estatísticas (21–23) ..... 47,6% a 50,6%
 *   aleatório (25 dezenas) ............... 64,8%
 *   esta carteira (25, espalhada) ........ 77,4%
 *
 * A razão é correlação. Dez jogos que compartilham as mesmas dezenas falham
 * juntos: se o sorteio espalhar números fora do pool, todos erram ao mesmo tempo.
 * Jogos que dividem as dezenas do universo de forma equilibrada erram em momentos
 * diferentes, e a união das chances fica maior que a intuição sugere.
 *
 * O QUE ELE OTIMIZA
 * -----------------
 * Três objetivos ao mesmo tempo, por recozimento simulado **determinístico**
 * (mesma semente, mesma carteira):
 *
 *   1. **frequência** — cada dezena aparece o mais perto possível do alvo
 *      (`count × dezenas livres por jogo / dezenas disponíveis`);
 *   2. **sobreposição** — minimiza a soma dos quadrados das interseções par a
 *      par; é isso que evita jogos "quase iguais", que desperdiçam cobertura;
 *   3. **filtros da modalidade** — par/ímpar e soma dentro da faixa da config,
 *      como restrição dura (penalidade alta), para a carteira continuar coerente
 *      com o resto do app.
 *
 * O QUE ELE NÃO FAZ
 * -----------------
 * Não faz previsão, não olha histórico, não usa Markov, atraso nem frequência
 * histórica. É deliberado: este motor existe justamente porque as previsões não
 * têm evidência, e a diversificação é a única alavanca que sobrevive a essa
 * constatação. E não resolve o que ninguém resolve: o prêmio principal continua
 * 1 em 3.268.760 por jogo, e o ganho medido é em faixa pequena (≥11, ≥12
 * acertos). Números e método em DIVERSIFICACAO.md.
 */

import { SeededRandom } from './prng.js';

/** Peso da frequência no custo. Equilibra a carteira sem impedir as trocas. */
const PESO_FREQUENCIA = 1.5;

/** Penalidade por violar par/ímpar ou soma: restrição dura, não preferência. */
const PENALIDADE_FILTRO = 500;

/** Iterações de annealing por jogo da carteira. */
export const ITERACOES_POR_JOGO = 6000;

/** Teto de iterações — carteira de 35 jogos não precisa de 210 mil passos. */
export const ITERACOES_MAX = 120000;

export class DiversificationEngine {
    /**
     * Gera uma carteira maximamente diversificada.
     *
     * @param {object} options
     * @param {object} options.config        config da modalidade (total, pick, minPar, maxPar, minSum, maxSum)
     * @param {number} [options.count]       quantidade de jogos
     * @param {number[]} [options.fixed]     dezenas obrigatórias (entram em todos os jogos)
     * @param {number[]} [options.excluded]  dezenas proibidas
     * @param {number} [options.seed]        semente — mesma semente, mesma carteira
     * @param {number} [options.iterations]
     * @returns {{games: number[][], metadata: object}}
     */
    static generate({ config, count = 10, fixed = [], excluded = [], seed = 123456, iterations = null } = {}) {
        const total = config?.total;
        const pick = config?.pick;
        if (!Number.isInteger(total) || !Number.isInteger(pick)) {
            throw new Error('config inválida: total e pick precisam ser inteiros');
        }
        if (!Number.isInteger(count) || count < 1) {
            throw new Error('count precisa ser um inteiro positivo');
        }

        const obrigatorias = [...new Set(fixed.filter(n => Number.isInteger(n) && n >= 1 && n <= total))];
        const proibidas = new Set(excluded);
        if (obrigatorias.some(n => proibidas.has(n))) {
            throw new Error('dezena fixa marcada como excluída ao mesmo tempo');
        }
        if (obrigatorias.length > pick) {
            throw new Error(`dezenas fixas (${obrigatorias.length}) passam do tamanho do jogo (${pick})`);
        }

        const universo = [];
        for (let n = 1; n <= total; n++) {
            if (proibidas.has(n) || obrigatorias.includes(n)) continue;
            universo.push(n);
        }
        const livresPorJogo = pick - obrigatorias.length;
        if (universo.length < livresPorJogo) {
            throw new Error('dezenas disponíveis insuficientes para montar um jogo');
        }

        const rng = new SeededRandom(seed ?? 123456);

        // Jogo = [fixas..., livres...]. As posições das fixas nunca mudam; a
        // ordenação para exibição acontece só no fim.
        const games = [];
        for (let g = 0; g < count; g++) {
            const restantes = [...universo];
            const jogo = [...obrigatorias];
            for (let k = 0; k < livresPorJogo; k++) {
                jogo.push(restantes.splice(Math.floor(rng.next() * restantes.length), 1)[0]);
            }
            games.push(jogo);
        }

        const passos = Math.min(ITERACOES_MAX, iterations ?? Math.max(20000, count * ITERACOES_POR_JOGO));
        const estado = this._estadoInicial(games, universo);
        const alvo = new Map(universo.map(n => [n, (count * livresPorJogo) / universo.length]));
        const custoInicial = this._custoTotal(games, estado, alvo, config);

        const resultado = this._anneal({
            games,
            estado,
            alvo,
            passos,
            rng,
            config,
            universo,
            fixas: obrigatorias.length
        });

        const ordenados = resultado.games.map(jogo => [...jogo].sort((a, b) => a - b));
        return {
            games: ordenados,
            metadata: this._metadata({
                games: ordenados,
                total,
                config,
                passos,
                estado: resultado.estado,
                universo,
                fixas: obrigatorias.length,
                custoInicial,
                custoFinal: resultado.custo,
                aceitas: resultado.aceitas
            })
        };
    }

    /** Frequência de cada dezena livre e soma/paridade de cada jogo. */
    static _estadoInicial(games, universo) {
        const freq = new Map(universo.map(n => [n, 0]));
        for (const jogo of games) for (const n of jogo) if (freq.has(n)) freq.set(n, freq.get(n) + 1);
        return {
            freq,
            somas: games.map(jogo => jogo.reduce((a, b) => a + b, 0)),
            pares: games.map(jogo => jogo.filter(n => n % 2 === 0).length)
        };
    }

    static _penalidadeFiltros(soma, pares, config) {
        let p = 0;
        if (typeof config.minPar === 'number' && pares < config.minPar)
            p += PENALIDADE_FILTRO * (config.minPar - pares);
        if (typeof config.maxPar === 'number' && pares > config.maxPar)
            p += PENALIDADE_FILTRO * (pares - config.maxPar);
        if (typeof config.minSum === 'number' && soma < config.minSum) p += PENALIDADE_FILTRO;
        if (typeof config.maxSum === 'number' && soma > config.maxSum) p += PENALIDADE_FILTRO;
        return p;
    }

    static _custoTotal(games, estado, alvo, config) {
        let custo = 0;
        for (const [n, f] of estado.freq) {
            const alvoN = alvo.get(n);
            if (alvoN === undefined) continue;
            custo += PESO_FREQUENCIA * (f - alvoN) ** 2;
        }
        for (let i = 0; i < games.length; i++) {
            for (let j = i + 1; j < games.length; j++) {
                let comuns = 0;
                const outro = new Set(games[j]);
                for (const n of games[i]) if (outro.has(n)) comuns++;
                custo += comuns * comuns;
            }
        }
        for (let g = 0; g < games.length; g++)
            custo += this._penalidadeFiltros(estado.somas[g], estado.pares[g], config);
        return custo;
    }

    /**
     * Recozimento com avaliação incremental.
     *
     * Cada passo troca uma dezena **livre** de um jogo por outra que ele não tem.
     * O custo é atualizado por diferença — interseções daquele jogo com os outros
     * mais as duas frequências afetadas —, o que permite dezenas de milhares de
     * passos em menos de um segundo.
     */
    static _anneal({ games, estado, alvo, passos, rng, config, universo, fixas = 0 }) {
        const n = games.length;
        // As dezenas fixas ocupam as primeiras posições de cada jogo e nunca são
        // trocadas; só o trecho livre participa do recozimento.
        const inicioLivre = fixas;
        const livres = games[0].length - inicioLivre;
        if (livres <= 0) return { games, estado, custo: this._custoTotal(games, estado, alvo, config), aceitas: 0 };

        const presentes = games.map(jogo => new Set(jogo));
        const inter = Array.from({ length: n }, () => new Array(n).fill(0));
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                let comuns = 0;
                for (const v of games[i]) if (presentes[j].has(v)) comuns++;
                inter[i][j] = comuns;
                inter[j][i] = comuns;
            }
        }

        let custo = this._custoTotal(games, estado, alvo, config);
        let aceitas = 0;

        for (let it = 0; it < passos; it++) {
            const g = Math.floor(rng.next() * n);
            const pos = inicioLivre + Math.floor(rng.next() * livres);
            const jogo = games[g];
            const antigo = jogo[pos];
            const novo = universo[Math.floor(rng.next() * universo.length)];
            if (novo === antigo || presentes[g].has(novo)) continue;

            let delta = 0;
            for (let j = 0; j < n; j++) {
                if (j === g) continue;
                const antes = inter[g][j];
                let depois = antes;
                if (presentes[j].has(antigo)) depois--;
                if (presentes[j].has(novo)) depois++;
                delta += depois * depois - antes * antes;
            }

            const fAntigo = estado.freq.get(antigo);
            const fNovo = estado.freq.get(novo);
            delta += PESO_FREQUENCIA * ((fAntigo - 1 - alvo.get(antigo)) ** 2 - (fAntigo - alvo.get(antigo)) ** 2);
            delta += PESO_FREQUENCIA * ((fNovo + 1 - alvo.get(novo)) ** 2 - (fNovo - alvo.get(novo)) ** 2);

            const somaDepois = estado.somas[g] - antigo + novo;
            const paresDepois = estado.pares[g] - (antigo % 2 === 0 ? 1 : 0) + (novo % 2 === 0 ? 1 : 0);
            delta +=
                this._penalidadeFiltros(somaDepois, paresDepois, config) -
                this._penalidadeFiltros(estado.somas[g], estado.pares[g], config);

            const temperatura = Math.max(0.05, 1 - it / passos);
            if (!(delta <= 0 || rng.next() < Math.exp(-delta / (2 * temperatura)))) continue;

            jogo[pos] = novo;
            presentes[g].delete(antigo);
            presentes[g].add(novo);
            for (let j = 0; j < n; j++) {
                if (j === g) continue;
                let valor = inter[g][j];
                if (presentes[j].has(antigo)) valor--;
                if (presentes[j].has(novo)) valor++;
                inter[g][j] = valor;
                inter[j][g] = valor;
            }
            estado.freq.set(antigo, fAntigo - 1);
            estado.freq.set(novo, fNovo + 1);
            estado.somas[g] = somaDepois;
            estado.pares[g] = paresDepois;
            custo += delta;
            aceitas++;
        }

        return { games, estado, custo, aceitas };
    }

    static _metadata({ games, total, config, passos, estado, universo, fixas = 0, custoInicial, custoFinal, aceitas }) {
        const paresCobertos = new Set();
        let somaInter = 0;
        let maxInter = 0;
        let comparacoes = 0;

        for (let i = 0; i < games.length; i++) {
            const a = games[i];
            for (let x = 0; x < a.length; x++) {
                for (let y = x + 1; y < a.length; y++) {
                    const [menor, maior] = a[x] < a[y] ? [a[x], a[y]] : [a[y], a[x]];
                    paresCobertos.add(`${menor}-${maior}`);
                }
            }
            for (let j = i + 1; j < games.length; j++) {
                const comuns = a.filter(v => games[j].includes(v)).length;
                somaInter += comuns;
                comparacoes++;
                if (comuns > maxInter) maxInter = comuns;
            }
        }

        const frequencias = [...estado.freq.values()];
        const violacoes = games.filter((jogo, g) => {
            const p = estado.pares[g];
            const s = estado.somas[g];
            return (
                (typeof config.minPar === 'number' && p < config.minPar) ||
                (typeof config.maxPar === 'number' && p > config.maxPar) ||
                (typeof config.minSum === 'number' && s < config.minSum) ||
                (typeof config.maxSum === 'number' && s > config.maxSum)
            );
        }).length;

        const totalPares = (total * (total - 1)) / 2;
        return {
            strategy: 'diversified',
            iterations: passos,
            acceptedSwaps: aceitas,
            distinctNumbers: new Set(games.flat()).size,
            universeSize: universo.length,
            fixedNumbers: fixas,
            frequencyMin: frequencias.length ? Math.min(...frequencias) : 0,
            frequencyMax: frequencias.length ? Math.max(...frequencias) : 0,
            meanOverlap: comparacoes ? Number((somaInter / comparacoes).toFixed(2)) : 0,
            maxOverlap: maxInter,
            coveredPairs: paresCobertos.size,
            totalPairs: totalPares,
            pairCoveragePct: Number(((paresCobertos.size / totalPares) * 100).toFixed(1)),
            filterViolations: violacoes,
            costFrom: Number(custoInicial.toFixed(2)),
            costTo: Number(custoFinal.toFixed(2))
        };
    }
}
