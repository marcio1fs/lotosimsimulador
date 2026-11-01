/**
 * Testes das migrações versionadas.
 *
 * Por que isto merece teste próprio: migração é a única operação do projeto que
 * pode **destruir dado**. Um bug aqui não aparece na tela — aparece meses depois,
 * num banco que não corresponde a nenhum commit.
 *
 * As três garantias centrais, cada uma com teste:
 *  1. o plano é validado **antes** de executar (migração editada ou arquivo
 *     removido abortam tudo, nada é aplicado "pela metade");
 *  2. cada migração roda em transação junto com o próprio registro de controle;
 *  3. o `schema.sql` versionado é exatamente a soma das migrações — se alguém
 *     editar a foto sem editar a fonte, a CI falha.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    MIGRATION_FILE_PATTERN,
    MIGRATIONS_DIR,
    MigrationError,
    applyMigrations,
    buildMigrations,
    loadMigrations,
    migrationChecksum,
    migrationsTableExists,
    normalizeSql,
    parseMigrationFile,
    planMigrations,
    renderSchemaSnapshot,
    splitStatements
} from '../server/migrations.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Duplo de banco: registra chamadas e simula a tabela de controle. */
function fakeSql({ applied = [] } = {}) {
    const calls = [];
    return {
        calls,
        transactions: () => calls.filter(c => c.kind === 'transaction').length,
        executed: () => calls.filter(c => c.kind === 'query').map(c => c.text),
        async query(text, params = []) {
            const normalized = String(text).replace(/\s+/g, ' ').trim();
            calls.push({ kind: 'query', text: normalized, params });
            if (normalized.includes('FROM schema_migrations')) return applied;
            return [];
        },
        async transaction(queries) {
            calls.push({ kind: 'transaction', count: queries.length });
            await Promise.all(queries);
            return [];
        }
    };
}

const migracao = (filename, sql) => ({ filename, sql });

describe('Nomes e ordenação de migrations', () => {
    it('aceita NNN_nome_em_snake_case.sql e extrai versão e nome', () => {
        assert.deepEqual(parseMigrationFile('001_schema_inicial.sql'), {
            id: '001_schema_inicial',
            version: 1,
            name: 'schema_inicial'
        });
        assert.equal(parseMigrationFile('042_indice_de_email.sql').version, 42);
        assert.ok(MIGRATION_FILE_PATTERN.test('999_a.sql'));
    });

    it('recusa nome fora do padrão com mensagem útil', () => {
        for (const nome of [
            '1_curto.sql',
            '001-Nome.sql',
            '001_NomeComMaiuscula.sql',
            '001_.sql',
            'migration.sql',
            '001_a.txt'
        ]) {
            assert.throws(() => parseMigrationFile(nome), MigrationError, `deveria recusar ${nome}`);
        }
    });

    it('ordena por versão, não por nome de arquivo', () => {
        const migrations = buildMigrations([
            migracao('002_segunda.sql', 'SELECT 2;'),
            migracao('001_primeira.sql', 'SELECT 1;')
        ]);
        assert.deepEqual(
            migrations.map(m => m.id),
            ['001_primeira', '002_segunda']
        );
    });

    it('recusa numeração duplicada e numeração com buraco', () => {
        assert.throws(
            () => buildMigrations([migracao('001_a.sql', 'SELECT 1;'), migracao('001_b.sql', 'SELECT 2;')]),
            /duas migrations com a numeração 001/
        );
        assert.throws(
            () => buildMigrations([migracao('001_a.sql', 'SELECT 1;'), migracao('003_c.sql', 'SELECT 3;')]),
            /buraco/
        );
    });
});

describe('Checksum do conteúdo', () => {
    it('ignora fim de linha e espaço nas pontas', () => {
        const lf = 'CREATE TABLE a (id INT);\n';
        const crlf = 'CREATE TABLE a (id INT);\r\n';
        assert.equal(migrationChecksum(lf), migrationChecksum(crlf));
        assert.equal(migrationChecksum(`  ${lf}  `), migrationChecksum(lf));
        assert.equal(normalizeSql('a\r\nb'), 'a\nb');
    });

    it('muda quando o conteúdo muda de verdade', () => {
        assert.notEqual(migrationChecksum('SELECT 1;'), migrationChecksum('SELECT 2;'));
        assert.match(migrationChecksum('SELECT 1;'), /^[a-f0-9]{64}$/);
    });
});

describe('Divisão de comandos SQL', () => {
    it('separa por ponto e vírgula e ignora o final vazio', () => {
        assert.deepEqual(splitStatements('CREATE TABLE a (id INT); CREATE INDEX i ON a (id);'), [
            'CREATE TABLE a (id INT)',
            'CREATE INDEX i ON a (id)'
        ]);
        assert.deepEqual(splitStatements('SELECT 1'), ['SELECT 1']);
        assert.deepEqual(splitStatements('SELECT 1;;;'), ['SELECT 1']);
    });

    it('não quebra dentro de string, de comentário nem de bloco dollar-quoted', () => {
        assert.deepEqual(splitStatements("INSERT INTO t VALUES ('a;b');"), ["INSERT INTO t VALUES ('a;b')"]);
        assert.deepEqual(splitStatements("SELECT 'aspas '' internas; aqui';"), ["SELECT 'aspas '' internas; aqui'"]);
        assert.deepEqual(splitStatements('-- comentário; com ponto e vírgula\nSELECT 1;'), [
            '-- comentário; com ponto e vírgula\nSELECT 1'
        ]);
        assert.deepEqual(splitStatements('/* bloco; inteiro */ SELECT 1;'), ['/* bloco; inteiro */ SELECT 1']);

        const funcao = 'CREATE FUNCTION f() RETURNS INT AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;';
        assert.equal(splitStatements(funcao).length, 1, 'o ; dentro de $$ … $$ não separa comando');
        assert.match(splitStatements(funcao)[0], /RETURN 1; END;/);

        const comTag = 'CREATE FUNCTION g() RETURNS INT AS $corpo$ SELECT 1; $corpo$ LANGUAGE sql;';
        assert.equal(splitStatements(comTag).length, 1);
    });

    it('arquivo vazio ou só de comentários não produz comando', () => {
        assert.deepEqual(splitStatements(''), []);
        assert.deepEqual(splitStatements('   \n\n'), []);
        assert.deepEqual(splitStatements('-- só isso\n/* e isso */'), []);
    });
});

describe('Tabela de controle', () => {
    it('descobre se já existe sem tentar criá-la', async () => {
        const comTabela = {
            async query() {
                return [{ exists: true }];
            }
        };
        const semTabela = {
            async query() {
                return [{ exists: false }];
            }
        };
        assert.equal(await migrationsTableExists(comTabela), true);
        assert.equal(await migrationsTableExists(semTabela), false);
        assert.equal(
            await migrationsTableExists({
                async query() {
                    return [];
                }
            }),
            false
        );
    });
});

describe('Plano: arquivo × banco', () => {
    const migrations = buildMigrations([migracao('001_a.sql', 'SELECT 1;'), migracao('002_b.sql', 'SELECT 2;')]);

    it('lista pendentes e aplicadas', () => {
        const plano = planMigrations(migrations, [
            { id: '001_a', checksum: migrations[0].checksum, appliedAt: '2026-01-01' }
        ]);
        assert.deepEqual(
            plano.pending.map(m => m.id),
            ['002_b']
        );
        assert.deepEqual(plano.applied, ['001_a']);
        assert.deepEqual(plano.drifted, []);
        assert.deepEqual(plano.unknown, []);
    });

    it('detecta migração editada depois de aplicada', () => {
        const plano = planMigrations(migrations, [{ id: '001_a', checksum: 'hash-antigo', appliedAt: '2026-01-01' }]);
        assert.deepEqual(
            plano.drifted.map(m => m.id),
            ['001_a']
        );
    });

    it('detecta registro no banco sem arquivo correspondente', () => {
        const plano = planMigrations(migrations, [
            { id: '001_a', checksum: migrations[0].checksum, appliedAt: '2026-01-01' },
            { id: '002_b', checksum: migrations[1].checksum, appliedAt: '2026-01-02' },
            { id: '003_fantasma', checksum: 'x', appliedAt: '2026-01-03' }
        ]);
        assert.deepEqual(plano.unknown, ['003_fantasma']);
        assert.deepEqual(plano.pending, []);
    });
});

describe('Aplicação', () => {
    it('aplica na ordem, em transação, registrando checksum', async () => {
        const sql = fakeSql();
        const migrations = buildMigrations([
            migracao('001_a.sql', 'CREATE TABLE a (id INT); CREATE INDEX i ON a (id);'),
            migracao('002_b.sql', 'SELECT 2;')
        ]);

        const resultado = await applyMigrations(sql, migrations, { log: { info() {} } });

        assert.deepEqual(resultado.appliedNow, ['001_a', '002_b']);
        assert.equal(sql.transactions(), 2, 'uma transação por migração');
        const inserts = sql.calls.filter(c => c.kind === 'query' && c.text.startsWith('INSERT INTO schema_migrations'));
        assert.equal(inserts.length, 2);
        assert.deepEqual(
            inserts.map(c => c.params),
            [
                ['001_a', migrations[0].checksum],
                ['002_b', migrations[1].checksum]
            ]
        );
    });

    it('não reaplica o que já está registrado', async () => {
        const migrations = buildMigrations([migracao('001_a.sql', 'SELECT 1;')]);
        const sql = fakeSql({ applied: [{ id: '001_a', checksum: migrations[0].checksum, appliedAt: '2026-01-01' }] });

        const resultado = await applyMigrations(sql, migrations, { log: { info() {} } });
        assert.deepEqual(resultado.appliedNow, []);
        assert.equal(sql.transactions(), 0);
    });

    it('aborta tudo quando uma migração aplicada foi editada', async () => {
        const migrations = buildMigrations([migracao('001_a.sql', 'SELECT 1;'), migracao('002_b.sql', 'SELECT 2;')]);
        const sql = fakeSql({ applied: [{ id: '001_a', checksum: 'hash-de-antes', appliedAt: '2026-01-01' }] });

        await assert.rejects(() => applyMigrations(sql, migrations, { log: { info() {} } }), /editada depois/);
        assert.equal(sql.transactions(), 0, 'nada pode ser aplicado antes da validação');
    });

    it('aborta quando o banco tem migração sem arquivo', async () => {
        const migrations = buildMigrations([migracao('001_a.sql', 'SELECT 1;')]);
        const sql = fakeSql({ applied: [{ id: '009_sumiu', checksum: 'x', appliedAt: '2026-01-01' }] });

        await assert.rejects(
            () => applyMigrations(sql, migrations, { log: { info() {} } }),
            /não existem em migrations/
        );
        assert.equal(sql.transactions(), 0);
    });

    it('--dry-run não executa nada e não precisa de banco', async () => {
        const migrations = buildMigrations([migracao('001_a.sql', 'SELECT 1;')]);
        const resultado = await applyMigrations({}, migrations, { dryRun: true, log: { info() {} } });

        assert.equal(resultado.dryRun, true);
        assert.deepEqual(
            resultado.pending.map(m => m.id),
            ['001_a']
        );
        assert.deepEqual(resultado.appliedNow, []);
    });

    it('migração sem nenhum comando é erro, não sucesso silencioso', async () => {
        const migrations = buildMigrations([migracao('001_vazia.sql', '-- nada aqui\n')]);
        await assert.rejects(() => applyMigrations(fakeSql(), migrations, { log: { info() {} } }), /migração vazia/);
    });
});

describe('Migrações reais do repositório', () => {
    it('carregam, estão numeradas em sequência e têm cabeçalho explicando o porquê', async () => {
        const migrations = await loadMigrations();
        assert.ok(migrations.length >= 1, 'não há nenhuma migração');
        for (const migration of migrations) {
            const primeiraLinha = migration.sql.split('\n').find(line => line.trim());
            assert.match(primeiraLinha, /^--/, `${migration.filename} começa sem comentário de contexto`);
            assert.ok(splitStatements(migration.sql).length > 0, `${migration.filename} não tem comando`);
        }
    });

    it('nenhuma migração é destrutiva sem aviso', () => {
        for (const nome of readdirSync(MIGRATIONS_DIR).filter(n => n.endsWith('.sql'))) {
            const sql = readFileSync(join(MIGRATIONS_DIR, nome), 'utf8');
            assert.doesNotMatch(sql, /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i, `${nome} derruba estrutura`);
            assert.doesNotMatch(sql, /\bTRUNCATE\b/i, `${nome} apaga dados`);
        }
    });

    it('a tabela de controle é criada pelo runner, não pelas migrações', async () => {
        const migrations = await loadMigrations();
        for (const migration of migrations) {
            assert.doesNotMatch(migration.sql, /CREATE TABLE IF NOT EXISTS schema_migrations/i, migration.filename);
        }
    });

    it('o schema.sql versionado é exatamente a soma das migrações', async () => {
        const migrations = await loadMigrations();
        const esperado = renderSchemaSnapshot(migrations);
        const atual = readFileSync(join(root, 'schema.sql'), 'utf8');
        assert.equal(
            atual,
            esperado,
            'schema.sql divergiu das migrações. Ele é gerado: rode `npm run build:schema` (não edite à mão).'
        );
    });

    it('o schema.sql gerado contém as tabelas que o código usa', async () => {
        const migrations = await loadMigrations();
        const snapshot = renderSchemaSnapshot(migrations);
        for (const tabela of [
            'users',
            'sessions',
            'games',
            'lottery_results',
            'password_resets',
            'recovery_requests'
        ]) {
            assert.match(snapshot, new RegExp(`CREATE TABLE IF NOT EXISTS ${tabela}\\b`), `falta ${tabela}`);
        }
        assert.match(snapshot, /email_verified/);
    });
});
