/**
 * Testes da estratégia "Máxima diversificação" e do motor que a sustenta.
 *
 * O que precisa ficar provado:
 *
 *  - a carteira é válida (tamanho, universo, sem repetição dentro do jogo);
 *  - as dezenas ficam equilibradas e os jogos se sobrepõem menos que um lote
 *    aleatório — é isso que a estratégia promete;
 *  - os filtros da modalidade (par/ímpar, soma) continuam respeitados;
 *  - `fixed` e `excluded` continuam valendo;
 *  - a mesma semente devolve a mesma carteira (reprodutibilidade);
 *  - o histórico **não** influencia: dois históricos diferentes produzem a mesma
 *    carteira. É a prova de que a estratégia não finge prever;
 *  - e o efeito medido existe: com o mesmo número de jogos, a carteira
 *    diversificada contém ao menos um jogo premiado com mais frequência que um
 *    lote aleatório.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DiversificationEngine } from '../js/engine/diversificationEngine.js';
import { GameGenerator } from '../js/engine/gameGenerator.js';
import { StatisticalAnalyzer } from '../js/engine/statisticalAnalyzer.js';
import { LotteryModel } from '../js/models/lottery.js';
import { SeededRandom } from '../js/engine/prng.js';

const LOTOFACIL = {
    name: 'Lotofácil',
    total: 25,
    pick: 15,
    drawn: 15,
    apiName: 'lotofacil',
    minPar: 6,
    maxPar: 9,
    minSum: 165,
    maxSum: 220
};

const MEGA = { name: 'Mega-Sena', total: 60, pick: 6, drawn: 6, apiName: 'megasena' };

function historico(tamanho, seed) {
    const prng = new SeededRandom(seed);
    const desenhos = [];
    for (let i = 0; i < tamanho; i++) {
        const pool = Array.from({ length: 25 }, (_, k) => k + 1);
        const dezenas = [];
        for (let k = 0; k < 15; k++) dezenas.push(pool.splice(Math.floor(prng.next() * pool.length), 1)[0]);
        desenhos.push({ concurso: 3000 - i, dezenas: dezenas.sort((a, b) => a - b) });
    }
    return desenhos;
}

const loteAleatorio = (count, seed = 999) => {
    const prng = new SeededRandom(seed);
    const jogos = [];
    while (jogos.length < count) {
        const pool = Array.from({ length: 25 }, (_, k) => k + 1);
        const jogo = [];
        for (let k = 0; k < 15; k++) jogo.push(pool.splice(Math.floor(prng.next() * pool.length), 1)[0]);
        jogos.push(jogo.sort((a, b) => a - b));
    }
    return jogos;
};

const sobreposicaoMedia = (jogosA, jogosB = jogosA) => {
    let soma = 0;
    let pares = 0;
    for (let i = 0; i < jogosA.length; i++) {
        for (let j = i + 1; j < jogosB.length; j++) {
            const outro = new Set(jogosB[j]);
            soma += jogosA[i].filter(n => outro.has(n)).length;
            pares++;
        }
    }
    return pares ? soma / pares : 0;
};

const frequencias = jogos => {
    const freq = new Map();
    for (const jogo of jogos) for (const n of jogo) freq.set(n, (freq.get(n) || 0) + 1);
    return freq;
};

describe('Diversificação — carteira gerada', () => {
    it('gera a quantidade pedida, com o tamanho exato e sem repetição dentro do jogo', () => {
        const { games } = DiversificationEngine.generate({ config: LOTOFACIL, count: 10, seed: 7 });
        assert.equal(games.length, 10);
        for (const jogo of games) {
            assert.equal(jogo.length, LOTOFACIL.pick);
            assert.equal(new Set(jogo).size, LOTOFACIL.pick, 'dezena repetida dentro do jogo');
            assert.ok(
                jogo.every(n => n >= 1 && n <= LOTOFACIL.total),
                'dezena fora do universo'
            );
        }
        assert.equal(new Set(games.map(j => j.join(','))).size, 10, 'jogos repetidos na carteira');
    });

    it('equilibra a frequência das dezenas', () => {
        const { games, metadata } = DiversificationEngine.generate({ config: LOTOFACIL, count: 10, seed: 7 });
        const freq = frequencias(games);
        assert.equal(freq.size, 25, 'a carteira deve cobrir as 25 dezenas');
        assert.ok(metadata.frequencyMax - metadata.frequencyMin <= 1, JSON.stringify([...freq.entries()]));
    });

    it('espalha mais que um lote aleatório de mesmo tamanho', () => {
        const { games, metadata } = DiversificationEngine.generate({ config: LOTOFACIL, count: 10, seed: 7 });
        const aleatorio = loteAleatorio(10);
        const mediaDiversificada = sobreposicaoMedia(games);
        const mediaAleatoria = sobreposicaoMedia(aleatorio);
        assert.ok(
            mediaDiversificada < mediaAleatoria,
            `sobreposição média: diversificada ${mediaDiversificada.toFixed(2)} vs aleatória ${mediaAleatoria.toFixed(2)}`
        );
        assert.ok(Math.abs(mediaDiversificada - metadata.meanOverlap) < 0.01, 'metadado não bate com a carteira');
    });

    it('respeita par/ímpar e soma da modalidade', () => {
        const { games, metadata } = DiversificationEngine.generate({ config: LOTOFACIL, count: 10, seed: 7 });
        assert.equal(metadata.filterViolations, 0);
        for (const jogo of games) {
            const pares = jogo.filter(n => n % 2 === 0).length;
            const soma = jogo.reduce((a, b) => a + b, 0);
            assert.ok(pares >= LOTOFACIL.minPar && pares <= LOTOFACIL.maxPar, `pares fora da faixa: ${pares}`);
            assert.ok(soma >= LOTOFACIL.minSum && soma <= LOTOFACIL.maxSum, `soma fora da faixa: ${soma}`);
        }
    });

    it('mesma semente devolve a mesma carteira', () => {
        const a = DiversificationEngine.generate({ config: LOTOFACIL, count: 8, seed: 123 });
        const b = DiversificationEngine.generate({ config: LOTOFACIL, count: 8, seed: 123 });
        const c = DiversificationEngine.generate({ config: LOTOFACIL, count: 8, seed: 124 });
        assert.deepEqual(a.games, b.games);
        assert.notDeepEqual(a.games, c.games);
    });

    it('honra dezenas fixas e excluídas', () => {
        const fixed = [5, 10];
        const excluded = [1, 2, 3];
        const { games } = DiversificationEngine.generate({ config: LOTOFACIL, count: 6, fixed, excluded, seed: 11 });
        for (const jogo of games) {
            assert.ok(jogo.includes(5) && jogo.includes(10), 'dezena fixa ausente');
            assert.ok(!jogo.some(n => excluded.includes(n)), 'dezena excluída apareceu');
            assert.equal(jogo.length, LOTOFACIL.pick);
        }
    });

    it('funciona em outra modalidade (Mega-Sena, 6 de 60)', () => {
        const { games, metadata } = DiversificationEngine.generate({ config: MEGA, count: 10, seed: 5 });
        assert.equal(games.length, 10);
        for (const jogo of games) {
            assert.equal(jogo.length, 6);
            assert.ok(jogo.every(n => n >= 1 && n <= 60));
        }
        assert.ok(metadata.frequencyMax - metadata.frequencyMin <= 1);
    });

    it('metadados descrevem a carteira (dezenas, pares e iterações)', () => {
        const { metadata } = DiversificationEngine.generate({ config: LOTOFACIL, count: 10, seed: 7 });
        assert.equal(metadata.strategy, 'diversified');
        assert.equal(metadata.distinctNumbers, 25);
        assert.equal(metadata.totalPairs, 300);
        assert.equal(metadata.pairCoveragePct, 100);
        assert.ok(metadata.iterations > 0);
    });

    it('recusa configuração impossível em vez de devolver carteira inválida', () => {
        assert.throws(() => DiversificationEngine.generate({ config: {}, count: 5 }), /config inválida/);
        assert.throws(() => DiversificationEngine.generate({ config: LOTOFACIL, count: 0 }), /inteiro positivo/);
        assert.throws(
            () =>
                DiversificationEngine.generate({
                    config: LOTOFACIL,
                    count: 2,
                    fixed: Array.from({ length: 16 }, (_, i) => i + 1)
                }),
            /passam do tamanho do jogo/
        );
        assert.throws(
            () => DiversificationEngine.generate({ config: LOTOFACIL, count: 2, fixed: [4], excluded: [4] }),
            /fixa marcada como excluída/
        );
        assert.throws(
            () =>
                DiversificationEngine.generate({
                    config: LOTOFACIL,
                    count: 2,
                    excluded: Array.from({ length: 15 }, (_, i) => i + 1)
                }),
            /insuficientes/
        );
    });
});

describe('Diversificação — efeito medido', () => {
    /** P(≥1 jogo com 11+ acertos) sob sorteio uniforme. */
    const medir = (jogos, sorteios, seed) => {
        const prng = new SeededRandom(seed);
        const sets = jogos.map(j => new Set(j));
        let premiados = 0;
        for (let d = 0; d < sorteios; d++) {
            const pool = Array.from({ length: 25 }, (_, k) => k + 1);
            const sorteados = new Set();
            for (let k = 0; k < 15; k++) sorteados.add(pool.splice(Math.floor(prng.next() * pool.length), 1)[0]);
            let melhor = 0;
            for (const s of sets) {
                let acertos = 0;
                for (const n of sorteados) if (s.has(n)) acertos++;
                if (acertos > melhor) melhor = acertos;
            }
            if (melhor >= 11) premiados++;
        }
        return premiados / sorteios;
    };

    it('com o mesmo orçamento, acerta algum prêmio mais vezes que um lote aleatório', () => {
        const { games } = DiversificationEngine.generate({ config: LOTOFACIL, count: 10, seed: 123456 });
        const aleatorio = loteAleatorio(10);
        const sorteios = 20000;

        const pDiversificada = medir(games, sorteios, 77);
        const pAleatoria = medir(aleatorio, sorteios, 77);

        // Medido em 300 mil sorteios: 78,0% contra 64,8%. A folga de 5 pontos
        // absorve o ruído de 20 mil sorteios (±0,7 ponto) sem mascarar regressão.
        assert.ok(
            pDiversificada > pAleatoria + 0.05,
            `diversificada ${(pDiversificada * 100).toFixed(1)}% vs aleatória ${(pAleatoria * 100).toFixed(1)}%`
        );
        assert.ok(pDiversificada > 0.7, `esperava >70%, veio ${(pDiversificada * 100).toFixed(1)}%`);
    });
});

describe('Diversificação — integração com o app', () => {
    it('GameGenerator.generateBatch devolve jogos pontuados e metadados da carteira', () => {
        const analysis = StatisticalAnalyzer.analyze(historico(50, 1), LOTOFACIL);
        const games = GameGenerator.generateBatch(
            'lotofacil',
            analysis,
            'diversified',
            [],
            [],
            6,
            LOTOFACIL,
            null,
            null,
            42
        );

        assert.equal(games.length, 6);
        assert.ok(games.diversificationMetadata, 'faltou o metadado da carteira');
        for (const jogo of games) {
            assert.ok(Array.isArray(jogo.numbers) && jogo.numbers.length === 15);
            assert.equal(typeof jogo.modelScore, 'number');
            assert.equal(typeof jogo.diversificationScore, 'number');
        }
    });

    it('LotteryModel.generateSmartGames aceita a estratégia (caminho de produção)', () => {
        const games = LotteryModel.generateSmartGames(
            'lotofacil',
            historico(80, 2),
            'diversified',
            [],
            [],
            10,
            'full',
            99
        );
        assert.equal(games.length, 10);
        assert.ok(games.diversificationMetadata);
        assert.ok(games.forecastPolicy, 'a política de projeção precisa continuar anexada');
    });

    it('não depende do histórico: dois históricos diferentes, mesma carteira', () => {
        const a = LotteryModel.generateSmartGames('lotofacil', historico(60, 3), 'diversified', [], [], 8, 'full', 555);
        const b = LotteryModel.generateSmartGames(
            'lotofacil',
            historico(200, 4),
            'diversified',
            [],
            [],
            8,
            'full',
            555
        );
        assert.deepEqual(
            a.map(g => g.numbers),
            b.map(g => g.numbers),
            'a carteira mudou com o histórico — ela deveria ignorá-lo por completo'
        );
    });

    it('a estratégia aparece na tela de simulação', async () => {
        const { readFile } = await import('node:fs/promises');
        const template = await readFile(new URL('../js/views/templates/simulationScreen.js', import.meta.url), 'utf8');
        assert.match(template, /data-strategy="diversified"/, 'falta o botão da estratégia');
        const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
        assert.match(html, /MÁXIMA DIVERSIFICAÇÃO/, 'o index.html não foi regenerado (npm run build:html)');
    });
});
