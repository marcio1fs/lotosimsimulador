#!/usr/bin/env node
/**
 * Gera o `schema.sql` a partir das migrações.
 *
 * O `schema.sql` é **foto**, não fonte: ele é a soma de `migrations/*.sql` na ordem
 * de aplicação, útil para criar um banco do zero colando no SQL Editor do Neon.
 * Editar à mão é inútil — o próximo build sobrescreve, e a CI falha se divergir.
 *
 * Uso:
 *   node scripts/build-schema.mjs            # grava schema.sql
 *   node scripts/build-schema.mjs --check    # não grava; sai com 1 se divergir
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadMigrations, renderSchemaSnapshot } from '../server/migrations.js';

const target = fileURLToPath(new URL('../schema.sql', import.meta.url));
const checkOnly = process.argv.includes('--check');

const migrations = await loadMigrations();
const generated = renderSchemaSnapshot(migrations);
const current = await readFile(target, 'utf8').catch(() => '');

if (current === generated) {
    console.log(`schema.sql já está atualizado (${migrations.length} migrações, ${generated.length} bytes).`);
    process.exit(0);
}

if (checkOnly) {
    // Um arquivo pode ser prefixo do outro (linha removida no fim): aí não existe
    // "diferença no meio", e o ponto que separa os dois é o tamanho do menor.
    const limite = Math.min(generated.length, current.length);
    let firstDiff = limite;
    for (let i = 0; i < limite; i++) {
        if (generated[i] !== current[i]) {
            firstDiff = i;
            break;
        }
    }
    console.error(
        `schema.sql divergiu das migrações (primeira diferença no caractere ${firstDiff}; ` +
            `arquivo com ${current.length} bytes, esperado ${generated.length}).\n` +
            'Ele é gerado: edite migrations/*.sql e rode `node scripts/build-schema.mjs`.'
    );
    process.exit(1);
}

await writeFile(target, generated);
console.log(`schema.sql gerado a partir de ${migrations.length} migrações (${generated.length} bytes).`);
