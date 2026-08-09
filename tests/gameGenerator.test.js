import test from 'node:test';
import assert from 'node:assert/strict';
import { StatisticalAnalyzer } from '../js/engine/statisticalAnalyzer.js';
import { GameGenerator } from '../js/engine/gameGenerator.js';

test('GameGenerator - Dezenas Únicas, Fixas, Excluídas e Diversificação', () => {
    const mockHistory = Array.from({ length: 30 }, (_, idx) => ({
        concurso: 30 - idx,
        dezenas: Array.from({ length: 15 }, (_, i) => String((i + (idx % 5)) % 25 + 1).padStart(2, '0'))
    }));

    const config = { name: 'Lotofácil', total: 25, pick: 15, drawn: 15, apiName: 'lotofacil' };
    const analysis = StatisticalAnalyzer.analyze(mockHistory, config);

    const fixed = [1, 2];
    const excluded = [24, 25];
    const count = 10;

    const batch = GameGenerator.generateBatch('lotofacil', analysis, 'adaptive', fixed, excluded, count, config);

    assert.equal(batch.length, count, 'Deve gerar exatamente 10 jogos');

    const seenGames = new Set();

    batch.forEach((game, idx) => {
        // 1. Cada jogo deve ter exatamente 15 dezenas únicas
        assert.equal(game.numbers.length, 15, `Jogo #${idx + 1} deve ter 15 dezenas`);
        const uniqueSet = new Set(game.numbers);
        assert.equal(uniqueSet.size, 15, `Jogo #${idx + 1} não deve ter dezenas duplicadas internamente`);

        // 2. Respeitar dezenas fixas
        fixed.forEach(f => {
            assert.ok(uniqueSet.has(f), `Jogo #${idx + 1} deve incluir a dezena fixa ${f}`);
        });

        // 3. Respeitar dezenas excluídas
        excluded.forEach(ex => {
            assert.ok(!uniqueSet.has(ex), `Jogo #${idx + 1} NÃO deve incluir a dezena excluída ${ex}`);
        });

        // 4. Ausência de jogos duplicados no lote
        const key = game.numbers.join(',');
        assert.ok(!seenGames.has(key), `Jogo #${idx + 1} é duplicado de outro no lote`);
        seenGames.add(key);
    });
});
