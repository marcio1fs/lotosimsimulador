/**
 * Migrações versionadas do banco.
 *
 * O PROBLEMA
 * ----------
 * Até aqui o banco era criado colando `schema.sql` no SQL Editor do Neon. Isso
 * funciona uma vez e falha a partir da segunda: não há registro do que já foi
 * aplicado, a ordem depende de quem colou, e mudar uma tabela existente vira uma
 * instrução manual cujo texto só existe no histórico do chat de quem fez. É o
 * jeito mais comum de derrubar produção no primeiro mês — não por bug, por
 * esquecimento.
 *
 * O MODELO
 * --------
 * - `migrations/NNN_nome.sql`, aplicados em ordem crescente de `NNN`.
 * - `schema_migrations (id, checksum, applied_at)` guarda o que já rodou e o hash
 *   do conteúdo aplicado.
 * - Cada migração roda **em uma transação** junto com o registro — ou as duas
 *   coisas acontecem, ou nenhuma.
 * - Se o arquivo de uma migração já aplicada mudar, o runner **para** e aponta
 *   qual mudou. Banco e arquivos divergirem em silêncio é pior que falhar: a
 *   próxima migração seria escrita em cima de um schema que não é o real.
 *
 * `schema.sql` continua existindo, mas como **foto gerada** da soma das migrações
 * (`npm run build:schema`). Ele é o que se cola no SQL Editor para criar um banco
 * do zero, e a CI falha se divergir.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Tabela de controle. Nome curto e sem prefixo: é infraestrutura, não domínio. */
export const MIGRATIONS_TABLE = 'schema_migrations';

/** `001_criar_usuarios.sql` — três dígitos, nome em snake_case, extensão `.sql`. */
export const MIGRATION_FILE_PATTERN = /^(\d{3})_([a-z0-9_]+)\.sql$/;

/** Erro de migração: separado de erro genérico para o CLI poder sair com código próprio. */
export class MigrationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MigrationError';
    }
}

/** Caminho absoluto de `migrations/` (independente do diretório de execução). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

// ------------------------------------------------------------------ arquivos

/** Valida o nome do arquivo e devolve `{ id, version, name }`. */
export function parseMigrationFile(filename) {
    const match = MIGRATION_FILE_PATTERN.exec(filename);
    if (!match) {
        throw new MigrationError(
            `nome de migration inválido: "${filename}". Use NNN_nome_em_snake_case.sql (ex.: 003_adicionar_indice.sql).`
        );
    }
    return { id: filename.replace(/\.sql$/, ''), version: Number(match[1]), name: match[2] };
}

/** Conteúdo normalizado: fim de linha único e sem espaço sobrando nas pontas. */
export const normalizeSql = text =>
    String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .trim();

/** Hash do conteúdo normalizado — é o que detecta migração editada depois de aplicada. */
export const migrationChecksum = text => createHash('sha256').update(normalizeSql(text)).digest('hex');

/**
 * Ordena e valida a lista de migrações.
 *
 * Buraco na numeração (001, 003) é erro, não escolha: quase sempre significa que
 * um arquivo foi renomeado ou perdido no caminho, e aplicar 003 sem 002 produz um
 * schema que ninguém previu.
 *
 * @param {{filename: string, sql: string}[]} entries
 */
export function buildMigrations(entries) {
    const migrations = entries.map(entry => {
        const meta = parseMigrationFile(entry.filename);
        return { ...meta, filename: entry.filename, sql: entry.sql, checksum: migrationChecksum(entry.sql) };
    });

    const seen = new Map();
    for (const migration of migrations) {
        if (seen.has(migration.version)) {
            throw new MigrationError(
                `duas migrations com a numeração ${String(migration.version).padStart(3, '0')}: ` +
                    `"${seen.get(migration.version)}" e "${migration.filename}"`
            );
        }
        seen.set(migration.version, migration.filename);
    }

    migrations.sort((a, b) => a.version - b.version);

    for (let i = 0; i < migrations.length; i++) {
        const expected = i + 1;
        if (migrations[i].version !== expected) {
            throw new MigrationError(
                `numeração de migrations com buraco: esperava ${String(expected).padStart(3, '0')}, ` +
                    `encontrei ${String(migrations[i].version).padStart(3, '0')} (${migrations[i].filename})`
            );
        }
    }

    return migrations;
}

/** Lê `migrations/` do disco e devolve a lista validada. */
export async function loadMigrations(dir = MIGRATIONS_DIR) {
    const filenames = (await readdir(dir))
        .filter(name => name.endsWith('.sql'))
        .filter(name => !name.startsWith('.'))
        .sort();

    const entries = [];
    for (const filename of filenames) {
        entries.push({ filename, sql: await readFile(`${dir}/${filename}`, 'utf8') });
    }
    return buildMigrations(entries);
}

// ------------------------------------------------------------------- SQL

/** Ainda não apareceu nenhum caractere de SQL (só espaço e comentário). */
const isBlank = text => text.trim().length === 0;

/**
 * Divide um arquivo SQL em comandos.
 *
 * `split(';')` não serve: `;` dentro de string, de comentário ou de corpo
 * dollar-quoted (`$$ … $$`) quebraria o comando no meio. Aqui o scanner respeita
 * os três casos. Comentários são preservados dentro do comando (ajudam no log de
 * erro do Postgres) e descartados quando o pedaço é só comentário.
 */
export function splitStatements(text) {
    const src = String(text ?? '');
    const statements = [];
    let current = '';
    let hasSql = false;
    let i = 0;

    const flush = () => {
        if (hasSql && !isBlank(current)) statements.push(current.trim());
        current = '';
        hasSql = false;
    };

    while (i < src.length) {
        const ch = src[i];
        const next = src[i + 1];

        if (ch === '-' && next === '-') {
            const end = src.indexOf('\n', i);
            const stop = end === -1 ? src.length : end;
            current += src.slice(i, stop);
            i = stop;
            continue;
        }

        if (ch === '/' && next === '*') {
            const end = src.indexOf('*/', i + 2);
            const stop = end === -1 ? src.length : end + 2;
            current += src.slice(i, stop);
            i = stop;
            continue;
        }

        if (ch === "'") {
            let j = i + 1;
            current += ch;
            while (j < src.length) {
                const c = src[j];
                current += c;
                if (c === "'" && src[j + 1] === "'") {
                    current += src[j + 1];
                    j += 2;
                    continue;
                }
                j++;
                if (c === "'") break;
            }
            hasSql = true;
            i = j;
            continue;
        }

        if (ch === '$') {
            const tagMatch = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(src.slice(i));
            if (tagMatch) {
                const tag = tagMatch[0];
                const end = src.indexOf(tag, i + tag.length);
                const stop = end === -1 ? src.length : end + tag.length;
                current += src.slice(i, stop);
                hasSql = true;
                i = stop;
                continue;
            }
        }

        if (ch === ';') {
            flush();
            i++;
            continue;
        }

        current += ch;
        if (!/\s/.test(ch)) hasSql = true;
        i++;
    }

    flush();
    return statements;
}

// -------------------------------------------------------------- execução

/** Cria a tabela de controle se ainda não existir. */
export async function ensureMigrationsTable(sql) {
    await sql.query(
        `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
            id VARCHAR(200) PRIMARY KEY,
            checksum VARCHAR(64) NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`
    );
}

/**
 * A tabela de controle já existe?
 *
 * Consulta o catálogo em vez de tentar `SELECT` e capturar o erro: o comando
 * `migrate:status` promete **não alterar nada**, e criar a tabela para poder ler
 * seria uma escrita disfarçada de leitura.
 */
export async function migrationsTableExists(sql) {
    const rows = await sql.query(
        `SELECT EXISTS (
             SELECT 1 FROM information_schema.tables
              WHERE table_schema = current_schema() AND table_name = '${MIGRATIONS_TABLE}'
         ) AS exists`
    );
    return Boolean(rows?.[0]?.exists);
}

/** Migrações já registradas no banco. */
export async function readApplied(sql) {
    const rows = await sql.query(`SELECT id, checksum, applied_at FROM ${MIGRATIONS_TABLE} ORDER BY id`);
    return rows.map(row => ({ id: row.id, checksum: row.checksum, appliedAt: row.applied_at }));
}

/**
 * Compara arquivos com banco.
 *
 * @returns {{pending: object[], drifted: object[], unknown: string[], applied: string[]}}
 *   `drifted`: já aplicadas cujo arquivo mudou (aborta);
 *   `unknown`: registradas no banco que não existem mais em `migrations/` (aborta).
 */
export function planMigrations(migrations, appliedRows = []) {
    const appliedById = new Map(appliedRows.map(row => [row.id, row]));
    const pending = [];
    const drifted = [];
    const applied = [];

    for (const migration of migrations) {
        const row = appliedById.get(migration.id);
        if (!row) {
            pending.push(migration);
            continue;
        }
        appliedById.delete(migration.id);
        applied.push(migration.id);
        if (row.checksum !== migration.checksum) {
            drifted.push({ ...migration, appliedChecksum: row.checksum });
        }
    }

    return { pending, drifted, unknown: [...appliedById.keys()], applied };
}

/**
 * Aplica as migrações pendentes.
 *
 * Antes de tocar em qualquer coisa, valida o plano inteiro: migração editada ou
 * arquivo removido abortam tudo. Aplicar "o que der" deixaria o banco num estado
 * que não corresponde a nenhum commit — e a próxima pessoa tentaria consertar a
 * partir de uma ficção.
 *
 * Cada migração vai em **uma** transação com o próprio registro de controle.
 */
export async function applyMigrations(sql, migrations, { dryRun = false, log = console } = {}) {
    if (dryRun) {
        // Em `--dry-run` o banco pode nem estar acessível: o plano vale como lista.
        const plan = { pending: migrations, drifted: [], unknown: [], applied: [] };
        return { ...plan, appliedNow: [], dryRun: true };
    }

    await ensureMigrationsTable(sql);
    const appliedRows = await readApplied(sql);
    const plan = planMigrations(migrations, appliedRows);

    if (plan.drifted.length) {
        throw new MigrationError(
            'migração já aplicada foi editada depois:\n' +
                plan.drifted.map(m => `  - ${m.id} (arquivo mudou; o banco tem o conteúdo antigo)`).join('\n') +
                '\nNão edite migração aplicada. Crie uma nova com a correção.'
        );
    }
    if (plan.unknown.length) {
        throw new MigrationError(
            `o banco registra migrações que não existem em migrations/: ${plan.unknown.join(', ')}. ` +
                'Arquivo removido é estado imprevisível — restaure o arquivo ou limpe o registro.'
        );
    }

    const appliedNow = [];
    for (const migration of plan.pending) {
        const statements = splitStatements(migration.sql);
        if (!statements.length) throw new MigrationError(`migração vazia (nenhum comando): ${migration.id}`);

        log.info?.(`→ aplicando ${migration.id} (${statements.length} comando${statements.length > 1 ? 's' : ''})`);

        const queries = statements.map(statement => sql.query(statement));
        queries.push(
            sql.query(`INSERT INTO ${MIGRATIONS_TABLE} (id, checksum) VALUES ($1, $2)`, [
                migration.id,
                migration.checksum
            ])
        );
        await sql.transaction(queries);
        appliedNow.push(migration.id);
    }

    return { ...plan, appliedNow, dryRun: false };
}

// ------------------------------------------------------------- foto (schema)

const SNAPSHOT_HEADER = `-- ======================================================================
-- SCHEMA DO BANCO — ARQUIVO GERADO. NÃO EDITE À MÃO.
-- ======================================================================
-- Este arquivo é a foto das migrações de migrations/*.sql, na ordem em que são
-- aplicadas. Serve para criar um banco do zero colando no SQL Editor do Neon.
--
-- Para mudar o schema: crie migrations/NNN_nome.sql e rode
--     npm run build:schema     (regenera este arquivo)
--     npm run check:schema     (a CI falha se este arquivo divergir)
--
-- Em banco que já existe, o caminho é só:
--     npm run migrate
-- ======================================================================

`;

/**
 * Texto do `schema.sql` a partir das migrações.
 * Determinístico: mesma entrada, mesma saída byte a byte.
 */
export function renderSchemaSnapshot(migrations) {
    const parts = migrations.map(migration => `-- ===== ${migration.filename} =====\n${normalizeSql(migration.sql)}\n`);
    return SNAPSHOT_HEADER + parts.join('\n');
}
