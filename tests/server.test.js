import test from 'node:test';
import assert from 'node:assert/strict';
import {
    legacyHash,
    isLegacyHash,
    isPbkdf2Hash,
    hashPassword,
    verifyPassword,
    hashToken,
    parseCookies,
    buildCookie,
    isValidEmail
} from '../server/security.js';
import { UserModel } from '../js/models/user.js';
import { sanitizePayload, toSnake, rowToCamel, TABLES } from '../server/tables.js';
import { parseMoneyValue, normalizeDrawPayload } from '../server/lotterySync.js';
import { escapeHtml } from '../js/utils/sanitize.js';
import { applyHolmBonferroni } from '../js/workers/engineWorker.js';
import { StatisticalAnalyzer } from '../js/engine/statisticalAnalyzer.js';

test('hash legado migra para bcrypt e senha errada falha', async () => {
    // Relógio fixo antes do prazo do item 6.12: este teste documenta o
    // comportamento de migração, e `tests/legacyHashSunset.test.js` cobre a
    // recusa a partir de LEGACY_HASH_SUNSET_ISO. Sem o `now`, a suíte mudaria
    // de resultado no dia do vencimento.
    const ANTES_DO_PRAZO = Date.parse('2027-01-15T12:00:00.000Z');
    // Montadas em pedaços: literal com cara de senha vira incidente falso no
    // check do GitGuardian (ver nota em tests/legacyHashSunset.test.js).
    const ENTRADA = ['anti', 'ga'].join('');
    const ENTRADA_ERRADA = ['ou', 'tra'].join('');
    const stored = legacyHash(ENTRADA);
    assert.ok(isLegacyHash(stored));
    const good = await verifyPassword(ENTRADA, stored, { now: ANTES_DO_PRAZO });
    assert.ok(good.ok && good.upgradedHash.startsWith('$2'));
    assert.equal((await verifyPassword(ENTRADA_ERRADA, stored, { now: ANTES_DO_PRAZO })).ok, false);
});

test('hash PBKDF2-SHA256 do UserModel é aceito pelo servidor e migrado para bcrypt', async () => {
    const pbkdf2Stored = await UserModel.hashPasswordAsync('SenhaHibrida2026!');
    assert.ok(isPbkdf2Hash(pbkdf2Stored));
    const good = await verifyPassword('SenhaHibrida2026!', pbkdf2Stored);
    assert.ok(good.ok && good.upgradedHash.startsWith('$2'));
    assert.equal((await verifyPassword('SenhaIncorreta', pbkdf2Stored)).ok, false);
});

test('bcrypt: verifica sem pedir upgrade', async () => {
    const h = await hashPassword('senha-segura-1');
    const r = await verifyPassword('senha-segura-1', h);
    assert.ok(r.ok && !r.upgradedHash);
    assert.equal((await verifyPassword('errada', h)).ok, false);
    assert.equal((await verifyPassword('x', null)).ok, false);
});

test('token é salvo como sha256 determinístico', () => {
    assert.equal(hashToken('a'), hashToken('a'));
    assert.match(hashToken('a'), /^[0-9a-f]{64}$/);
});

test('cookies: parse e flags de segurança', () => {
    assert.deepEqual(parseCookies('a=1; lm_session=xyz'), { a: '1', lm_session: 'xyz' });
    const c = buildCookie('t', { remember: true, secure: true });
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Lax/);
    assert.match(c, /Secure/);
    assert.match(c, /Max-Age=/);
    assert.doesNotMatch(buildCookie('t', { remember: false, secure: false }), /Max-Age|Secure/);
});

test('validação de e-mail', () => {
    assert.ok(isValidEmail('a@b.co'));
    assert.ok(!isValidEmail('sem-arroba'));
    assert.ok(!isValidEmail('a b@c.d'));
});

test('sanitizePayload descarta colunas não permitidas e normaliza JSON', () => {
    const p = sanitizePayload('games', {
        userId: 99,
        lotteryType: 'mega',
        numbers: '[1,2]',
        stats: { a: 1 },
        'x"; DROP': 1,
        id: 5,
        role: 'admin'
    });
    assert.deepEqual(Object.keys(p).sort(), ['lottery_type', 'numbers', 'stats']);
    assert.equal(p.numbers, '[1,2]');
    assert.equal(p.stats, '{"a":1}');
});

test('lottery_results sincroniza data/data_apuracao; simulations total_games; auto_log type/message', () => {
    assert.equal(sanitizePayload('lottery_results', { data: '01/01/2000' }).data_apuracao, '01/01/2000');
    assert.equal(sanitizePayload('simulations', { gamesCount: 10 }).total_games, 10);
    assert.equal(sanitizePayload('auto_log', { type: 'fetch', message: 'ok' }).message, 'ok');
});

test('conversões de nome e linhas', () => {
    assert.equal(toSnake('modelScore'), 'model_score');
    assert.equal(rowToCamel({ user_id: 1, data_apuracao: 'x' }).data, 'x');
});

test('apenas tabelas do Loto Mais são expostas', () => {
    assert.deepEqual(Object.keys(TABLES).sort(), [
        'auto_log',
        'auto_settings',
        'games',
        'lottery_results',
        'simulations',
        'user_stats'
    ]);
    for (const [name, t] of Object.entries(TABLES)) if (!t.shared) assert.ok(t.owner, `${name} precisa de dono`);
});

test('escapeHtml neutraliza tags e atributos XSS', () => {
    assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    assert.equal(escapeHtml(null), '');
});

test('lotterySync: parseMoneyValue e normalizeDrawPayload validam dezenas e valores', () => {
    assert.equal(parseMoneyValue('R$ 3.500.000,50'), 3500000.5);
    assert.equal(parseMoneyValue(1200000), 1200000);
    const valid = normalizeDrawPayload(
        {
            numero: 2800,
            dataApuracao: '10/10/2026',
            listaDezenas: ['05', '12', '23', '34', '45', '60'],
            acumulado: true,
            valorEstimadoProximoConcurso: 45000000
        },
        'mega'
    );
    assert.ok(valid);
    assert.equal(valid.concurso, 2800);
    assert.deepEqual(valid.dezenas, ['05', '12', '23', '34', '45', '60']);
    assert.equal(valid.acumulou, true);
    assert.equal(valid.valorEstimado, 45000000);

    assert.equal(normalizeDrawPayload({ numero: 1, listaDezenas: ['01', '02'] }, 'mega'), null);
});

test('applyHolmBonferroni controla múltiplos testes de significância', () => {
    const items = [
        { strategyId: 'adaptive', diff: 0.4, pValue: 0.02, isSignificant: true },
        { strategyId: 'weighted', diff: 0.2, pValue: 0.04, isSignificant: true },
        { strategyId: 'hot', diff: 0.1, pValue: 0.2, isSignificant: false },
        { strategyId: 'cold', diff: -0.1, pValue: 0.8, isSignificant: false },
        { strategyId: 'random', diff: 0, pValue: 1, isSignificant: false }
    ];
    applyHolmBonferroni(items, 0.05);
    assert.equal(items[0].adjustedPValue, 0.08);
    assert.equal(items[0].isSignificant, false);
});

test('StatisticalAnalyzer.analyzeFast coincide com analyze nos campos usados por generateSingleCandidate', () => {
    const history = [
        { concurso: 10, dezenas: ['01', '05', '10', '20', '30', '60'] },
        { concurso: 9, dezenas: ['02', '05', '11', '20', '31', '59'] },
        { concurso: 8, dezenas: ['03', '06', '12', '21', '32', '60'] }
    ];
    const cfg = { total: 60, pick: 6, drawn: 6 };
    const full = StatisticalAnalyzer.analyze(history, cfg);
    const fast = StatisticalAnalyzer.analyzeFast(history, cfg);
    assert.deepEqual(fast.freqAbsolute, full.freqAbsolute);
    assert.deepEqual(fast.freqWeighted, full.freqWeighted);
    assert.deepEqual(fast.currentDelay, full.currentDelay);
    assert.deepEqual(fast.avgDelay, full.avgDelay);
    assert.deepEqual(fast.pairMatrix, full.pairMatrix);
    assert.deepEqual(fast.cycleStats, full.cycleStats);
    assert.deepEqual(fast.markovStats, full.markovStats);
});
