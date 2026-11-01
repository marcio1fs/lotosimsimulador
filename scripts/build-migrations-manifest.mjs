#!/usr/bin/env node
/**
 * Gera `server/migrationsManifest.js` a partir de `migrations/*.sql`.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * ---------------------------
 * O `/api/health` precisa comparar o que o **banco** tem aplicado com o que o
 * **código** espera. Ler `migrations/` do disco durante a requisição não serve:
 * na Vercel a função é empacotada a partir das importações, e um `readdir` em
 * caminho relativo ao source só funciona por sorte. Arquivo `.sql` não é
 * importação, então ele nem sempre viaja junto com o bundle.
 *
 * A saída é esta lista — JavaScript puro, importado normalmente, portanto
 * empacotado junto com o handler. Ela é **gerada**, como o `schema.sql`:
 *
 *   node scripts/build-migrations-manifest.mjs           # grava o manifesto
 *   node scripts/build-migrations-manifest.mjs --check   # sai com 1 se divergir
 *
 * Um teste (`tests/migrations.test.js`) confere que o manifesto é exatamente a
 * lista de arquivos, então uma migração nova sem regenerar quebra a suíte mesmo
 * para quem não roda o `--check`.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadMigrations } from '../server/migrations.js';

const target = fileURLToPath(new URL('../server/migrationsManifest.js', import.meta.url));
const checkOnly = process.argv.includes('--check');

/** Mesmo formato de saída do `schema.sql`: gerado, avisado, estável. */
export function renderManifest(migrations) {
    // Sem vírgula final: é o formato que o Prettier (`trailingComma: none`)
    // produz. A saída precisa sair pronta daqui — se dependesse do Prettier, o
    // `--check` da CI reprovaria um manifesto recém-gerado.
    const linhas = migrations.map(
        (m, i) => `    { id: '${m.id}', checksum: '${m.checksum}' }${i === migrations.length - 1 ? '' : ','}`
    );
    return [
        '/**',
        ' * GERADO por `npm run build:manifest` a partir de `migrations/*.sql`.',
        ' *',
        ' * Não edite à mão: o próximo build sobrescreve e a CI falha se divergir.',
        ' * Serve para o `/api/health` saber o que o código espera do banco sem ler',
        ' * o disco em tempo de requisição — ver `server/health.js`.',
        ' */',
        '',
        'export const MIGRATION_MANIFEST = Object.freeze([',
        ...linhas,
        ']);',
        '',
        '/** Quantidade de migrações que o código conhece (atalho para o relatório). */',
        'export const EXPECTED_MIGRATIONS = MIGRATION_MANIFEST.length;',
        ''
    ].join('\n');
}

const migrations = await loadMigrations();
const generated = renderManifest(migrations);
const current = await readFile(target, 'utf8').catch(() => '');

if (current === generated) {
    console.log(`manifesto já está atualizado (${migrations.length} migrações).`);
    process.exit(0);
}

if (checkOnly) {
    console.error(
        'server/migrationsManifest.js divergiu das migrações. Ele é gerado: ' +
            'rode `node scripts/build-migrations-manifest.mjs`.'
    );
    process.exit(1);
}

await writeFile(target, generated);
console.log(`manifesto gerado a partir de ${migrations.length} migrações.`);
