import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { UserModel } from '../js/models/user.js';
import { Database } from '../js/db/database.js';

describe('Production Readiness: Cryptographic PBKDF2 Auth & Database SQL Injection Guard', () => {
    it('UserModel.hashPasswordAsync generates irreversible salted PBKDF2-SHA256 hashes and verifies them accurately', async () => {
        const hash1 = await UserModel.hashPasswordAsync('MinhaSenhaForte123!');
        const hash2 = await UserModel.hashPasswordAsync('MinhaSenhaForte123!');

        assert.ok(hash1.startsWith('pbkdf2$100000$'), 'Hash should use pbkdf2$100000$ format');
        assert.notEqual(hash1, hash2, 'Two hashes of the same password must have different random salts');
        assert.ok(!hash1.includes(Buffer.from('MinhaSenhaForte123!').toString('base64')), 'Must NOT contain base64 of plaintext password');

        const verifyCorrect = await UserModel.verifyPasswordAsync('MinhaSenhaForte123!', hash1);
        const verifyWrong = await UserModel.verifyPasswordAsync('SenhaErrada999', hash1);

        assert.equal(verifyCorrect.valid, true);
        assert.equal(verifyCorrect.needsUpgrade, false);
        assert.equal(verifyWrong.valid, false);
    });

    it('UserModel.verifyPasswordAsync transparently detects and flags legacy hashes for automatic PBKDF2 migration', async () => {
        const legacyHash = UserModel._legacyHashPassword('senhaAntiga123');
        const check = await UserModel.verifyPasswordAsync('senhaAntiga123', legacyHash);

        assert.equal(check.valid, true);
        assert.equal(check.needsUpgrade, true);
    });

    it('Database rejects unauthorized table/store names to prevent SQL injection', async () => {
        await assert.rejects(
            async () => {
                await Database.get('users; DROP TABLE users; --', 1);
            },
            /Store\/tabela inválida bloqueada por segurança/
        );
    });
});
