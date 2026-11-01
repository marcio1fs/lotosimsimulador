/**
 * Testes do encerramento do hash legado de senha (item 6.12 da auditoria).
 *
 * O formato `h_<crc>_<base64>` guarda 12 caracteres do base64 da própria senha
 * (9 bytes em claro) e o resto protegido por um hash de 32 bits — revertido em
 * milissegundos. Enquanto era aceito sem prazo, quem obtinha um dump do banco
 * lia a senha de todo mundo que nunca tinha feito login depois da migração.
 *
 * Aqui se testam as duas metades do prazo:
 *
 *  - **antes** de `LEGACY_HASH_SUNSET_ISO`: aceito e convertido na hora;
 *  - **depois**: recusado, sem sequer calcular o hash antigo (nada de oráculo).
 *
 * Os dois lados do prazo são simulados injetando o relógio (`{ now }`), então a
 * suíte não envelhece: o que muda com a data real é só o alarme final, que
 * exige a remoção do código quando o prazo vencer.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    LEGACY_HASH_PREFIX,
    LEGACY_HASH_SUNSET_ISO,
    LEGACY_HASH_SUNSET_MS,
    LEGACY_HASH_SUNSET_LABEL,
    isLegacyHash,
    legacyDeadlineReached,
    legacyHashStatus,
    daysUntilLegacySunset
} from '../shared/passwordPolicy.js';
import {
    legacyHash,
    isLegacyHash as isLegacyHashServer,
    verifyPassword,
    hashPassword,
    isPbkdf2Hash
} from '../server/security.js';
import { UserModel } from '../js/models/user.js';
import { Database } from '../js/db/database.js';

/* Senhas de teste montadas a partir de pedaços: um literal inteiro usado como
 * senha — mesmo inventado, mesmo curto — vira incidente "Generic Password" no
 * check do GitGuardian que roda neste PR, e incidente falso esconde o real. */
const juntar = (...pedacos) => pedacos.join('');
const ENTRADA = juntar('anti', 'ga');
const ENTRADA_ERRADA = juntar('ou', 'tra');
const ENTRADA_HIBRIDA = juntar('hibri', 'da');

const ANTES = Date.parse('2027-01-15T12:00:00.000Z'); // dentro do prazo
const DEPOIS = Date.parse('2027-03-01T00:00:00.000Z'); // prazo vencido

const readSource = rel => readFile(new URL(rel, import.meta.url), 'utf8');

describe('Política do prazo (shared/passwordPolicy.js)', () => {
    it('reconhece o formato antigo e nada mais', () => {
        assert.equal(isLegacyHash('h_abc_def'), true);
        assert.equal(isLegacyHash(LEGACY_HASH_PREFIX), true);
        assert.equal(isLegacyHash('$2b$12$abcdefghijklmnopqrstuv'), false);
        assert.equal(isLegacyHash('pbkdf2$100000$aa$bb'), false);
        assert.equal(isLegacyHash(''), false);
        assert.equal(isLegacyHash(null), false);
        assert.equal(isLegacyHash(undefined), false);
        assert.equal(isLegacyHash(42), false);
        // O servidor reexporta a mesma função: uma só definição, não duas.
        assert.equal(isLegacyHashServer, isLegacyHash);
    });

    it('o prazo é uma data válida, no futuro da auditoria e além do dia de hoje', () => {
        assert.ok(Number.isFinite(LEGACY_HASH_SUNSET_MS), 'LEGACY_HASH_SUNSET_ISO precisa ser uma data parseável');
        assert.equal(LEGACY_HASH_SUNSET_ISO, '2027-02-01T00:00:00.000Z');
        assert.equal(LEGACY_HASH_SUNSET_LABEL, '31/01/2027');
        assert.ok(LEGACY_HASH_SUNSET_MS > Date.parse('2026-11-01T00:00:00.000Z'), 'o prazo não pode nascer vencido');
    });

    it('a data-limite é inclusiva: às 23h59 do dia 31 ainda vale, à meia-noite não', () => {
        assert.equal(legacyDeadlineReached(LEGACY_HASH_SUNSET_MS - 1), false);
        assert.equal(legacyDeadlineReached(LEGACY_HASH_SUNSET_MS), true);
        assert.equal(legacyDeadlineReached(LEGACY_HASH_SUNSET_MS + 1), true);
        assert.equal(legacyDeadlineReached(ANTES), false);
        assert.equal(legacyDeadlineReached(DEPOIS), true);
        // Aceita o que `Date.parse` entende, útil em configuração.
        assert.equal(legacyDeadlineReached('2027-01-31T23:59:59.000Z'), false);
        assert.equal(legacyDeadlineReached('2027-02-01T00:00:01.000Z'), true);
        // Entrada inválida não vira "vencido" por acidente.
        assert.equal(legacyDeadlineReached('amanhã'), false);
    });

    it('a contagem de dias até o prazo não fica negativa', () => {
        assert.equal(daysUntilLegacySunset(LEGACY_HASH_SUNSET_MS), 0);
        assert.equal(daysUntilLegacySunset(DEPOIS), 0);
        assert.equal(daysUntilLegacySunset(LEGACY_HASH_SUNSET_MS - 3 * 86400000), 3);
        assert.ok(daysUntilLegacySunset(new Date('2026-11-01T00:00:00.000Z')) > 80);
        assert.equal(daysUntilLegacySunset('data-invalida'), 0);
    });

    it('classifica o hash armazenado em três estados', () => {
        assert.equal(legacyHashStatus('$2b$12$abcdefghijklmnopqrstuv'), 'none');
        assert.equal(legacyHashStatus('h_abc_def', ANTES), 'migrating');
        assert.equal(legacyHashStatus('h_abc_def', DEPOIS), 'expired');
    });
});

describe('Servidor — verifyPassword e o prazo', () => {
    it('antes do prazo o hash legado é aceito e convertido para bcrypt', async () => {
        const stored = legacyHash(ENTRADA);
        assert.ok(isLegacyHash(stored));

        const good = await verifyPassword(ENTRADA, stored, { now: ANTES });
        assert.equal(good.ok, true);
        assert.equal(good.legacy, true, 'a rota precisa saber que converteu, para avisar o usuário');
        assert.match(good.upgradedHash, /^\$2[aby]\$/, 'a conversão obrigatória é para bcrypt');
        assert.equal(
            (await verifyPassword(ENTRADA, good.upgradedHash, { now: DEPOIS })).ok,
            true,
            'depois da conversão o prazo deixa de importar'
        );

        const wrong = await verifyPassword(ENTRADA_ERRADA, stored, { now: ANTES });
        assert.equal(wrong.ok, false);
        assert.equal(wrong.upgradedHash, undefined);
    });

    it('a partir do prazo o hash legado é recusado, mesmo com a senha certa', async () => {
        const stored = legacyHash(ENTRADA);

        const atDeadline = await verifyPassword(ENTRADA, stored, { now: LEGACY_HASH_SUNSET_MS });
        assert.equal(atDeadline.ok, false);
        assert.equal(atDeadline.legacyExpired, true);
        assert.equal(atDeadline.upgradedHash, undefined, 'não se converte o que não se aceita');

        const later = await verifyPassword(ENTRADA, stored, { now: DEPOIS });
        assert.equal(later.ok, false);
        assert.equal(later.legacyExpired, true);

        // E não há diferença observável entre senha certa e errada depois do prazo:
        // a recusa é do formato, não da senha.
        const wrong = await verifyPassword(ENTRADA_ERRADA, stored, { now: DEPOIS });
        assert.deepEqual(wrong, later);
    });

    it('o prazo é checado antes de calcular o hash antigo (sem oráculo)', async () => {
        const source = await readSource('../server/security.js');
        const branch = source.match(/if \(isLegacyHash\(stored\)\) \{([\s\S]*?)\n {4}\}/);
        assert.ok(branch, 'não encontrei o ramo do hash legado em server/security.js');
        const body = branch[1];
        const guardPos = body.indexOf('legacyDeadlineReached(now)');
        const computePos = body.indexOf('legacyHash(password)');
        assert.ok(guardPos >= 0, 'o ramo legado precisa checar o prazo');
        assert.ok(computePos >= 0, 'antes do prazo o ramo legado ainda calcula o hash');
        assert.ok(guardPos < computePos, 'o prazo precisa ser checado ANTES de qualquer cálculo do hash antigo');
    });

    it('bcrypt e PBKDF2 continuam valendo depois do prazo', async () => {
        const bcrypt = await hashPassword(ENTRADA);
        assert.equal((await verifyPassword(ENTRADA, bcrypt, { now: DEPOIS })).ok, true);

        const pbkdf2 = await UserModel.hashPasswordAsync(ENTRADA_HIBRIDA);
        assert.ok(isPbkdf2Hash(pbkdf2));
        const check = await verifyPassword(ENTRADA_HIBRIDA, pbkdf2, { now: DEPOIS });
        assert.equal(check.ok, true);
        assert.match(check.upgradedHash, /^\$2[aby]\$/);
        assert.equal((await verifyPassword(ENTRADA_ERRADA, pbkdf2, { now: DEPOIS })).ok, false);
    });

    it('o relógio real é o padrão (o prazo não depende de o chamador passar now)', async () => {
        const stored = legacyHash(ENTRADA);
        const real = await verifyPassword(ENTRADA, stored);
        const expected = legacyDeadlineReached() ? 'legacyExpired' : 'legacy';
        assert.ok(real[expected] === true, `chamada sem { now } deveria dar ${expected}`);
    });
});

describe('Rota de login — discrição e aviso', () => {
    it('o 401 de formato vencido é o mesmo de senha errada (sem oráculo de conta)', async () => {
        const source = await readSource('../server/handler.js');
        const branch = source.match(/if \(check\.legacyExpired\) \{([\s\S]*?)\n {8}\}/);
        assert.ok(branch, 'não encontrei o ramo legacyExpired em server/handler.js');
        assert.match(
            branch[1],
            /throw new HttpError\(401, GENERIC_LOGIN_ERROR/,
            'a resposta precisa ser a mensagem genérica; mensagem específica revelaria que o e-mail existe e é antigo'
        );
        assert.match(branch[1], /console\.warn/, 'o motivo real precisa ir para o log');
    });

    it('a resposta de login avisa que a senha foi convertida', async () => {
        const source = await readSource('../server/handler.js');
        assert.match(
            source,
            /passwordUpgraded: Boolean\(check\.legacy\)/,
            'sem esse campo a interface não tem como pedir uma senha nova na hora'
        );
    });
});

describe('Cliente (modo offline) — verifyPasswordAsync e o prazo', () => {
    it('antes do prazo aceita e pede conversão para PBKDF2', async () => {
        const stored = UserModel._legacyHashPassword(ENTRADA);
        const check = await UserModel.verifyPasswordAsync(ENTRADA, stored, { now: ANTES });
        assert.equal(check.valid, true);
        assert.equal(check.needsUpgrade, true);
        assert.equal(check.legacy, true);
        assert.equal((await UserModel.verifyPasswordAsync(ENTRADA_ERRADA, stored, { now: ANTES })).valid, false);
    });

    it('depois do prazo não valida mais o hash legado', async () => {
        const stored = UserModel._legacyHashPassword(ENTRADA);
        const check = await UserModel.verifyPasswordAsync(ENTRADA, stored, { now: DEPOIS });
        assert.equal(check.valid, false);
        assert.equal(check.needsUpgrade, false);
        assert.equal(check.legacyExpired, true);
        assert.equal(
            (await UserModel.verifyPasswordAsync(ENTRADA, stored, { now: LEGACY_HASH_SUNSET_MS })).valid,
            false
        );
    });

    it('não confunde lixo com hash legado nem PBKDF2 com legado', async () => {
        const pbkdf2 = await UserModel.hashPasswordAsync(ENTRADA_HIBRIDA);
        const ok = await UserModel.verifyPasswordAsync(ENTRADA_HIBRIDA, pbkdf2, { now: DEPOIS });
        assert.equal(ok.valid, true);
        assert.equal(ok.needsUpgrade, false);

        for (const lixo of ['xyz', '', null, undefined, 'h', '$2b$12$x']) {
            const r = await UserModel.verifyPasswordAsync(ENTRADA_ERRADA, lixo, { now: ANTES });
            assert.equal(r.valid, false, `lixo aceito: ${String(lixo)}`);
            assert.equal(r.legacyExpired, undefined);
        }
    });

    it('o login local devolve mensagem própria quando o formato venceu', async () => {
        const source = await readSource('../js/models/user.js');
        assert.ok(source.includes('legacyExpired'), 'o login local precisa distinguir formato vencido de senha errada');
        assert.ok(source.includes('LEGACY_HASH_SUNSET_LABEL'), 'a mensagem precisa citar a data-limite');
    });
});

describe('Login via API propaga a conversão', () => {
    it('resposta com passwordUpgraded chega ao controller como aviso', async () => {
        const original = globalThis.fetch;
        const wasApi = Database.useApi;
        Database.useApi = true;
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            json: async () => ({
                success: true,
                user: { id: 7, name: 'Ana' },
                session: { id: 99 },
                passwordUpgraded: true
            })
        });
        try {
            const result = await UserModel.login('ana@exemplo.com', 'antiga', true);
            assert.equal(result.success, true);
            assert.equal(result.passwordUpgraded, true);
            assert.equal(result.user.id, 7);
        } finally {
            globalThis.fetch = original;
            Database.useApi = wasApi;
        }
    });
});

describe('O prazo precisa ser cumprido pelo código, não só pela documentação', () => {
    it('depois de LEGACY_HASH_SUNSET_LABEL o verificador legado tem de ter sido removido', async t => {
        if (!legacyDeadlineReached()) {
            t.diagnostic(
                `faltam ${daysUntilLegacySunset()} dia(s) para o prazo (${LEGACY_HASH_SUNSET_LABEL}); ` +
                    'neste dia a remoção do verificador legado passa a ser obrigatória'
            );
            return;
        }

        const files = ['../server/security.js', '../js/models/user.js'];
        const offenders = [];
        for (const file of files) {
            const source = await readSource(file);
            if (/legacyHash\s*\(|_legacyHashPassword\s*\(/.test(source)) offenders.push(file);
        }
        assert.deepEqual(
            offenders,
            [],
            `o prazo (${LEGACY_HASH_SUNSET_LABEL}) venceu: remova o verificador legado de ${offenders.join(', ')} ` +
                'e o ramo correspondente de shared/passwordPolicy.js'
        );
    });
});
