#!/usr/bin/env node
/**
 * Aplica as migrações de `migrations/` no banco apontado por `DATABASE_URL`.
 *
 * Uso:
 *   npm run migrate              # aplica o que estiver pendente
 *   npm run migrate:status       # mostra o estado, não altera nada
 *   npm run migrate -- --dry-run # mostra o que faria (não precisa de banco)
 *
 * Por que não migrar automático no deploy: migração é a única operação deste
 * projeto que pode destruir dado. Deixá-la rodando dentro do build significa que
 * um deploy de rollback também roda SQL — e aí não existe rollback. A ordem
 * correta é: `npm run migrate` (conferindo a saída) e só então o deploy.
 */

import { neon } from '@neondatabase/serverless';
import {
    loadMigrations,
    applyMigrations,
    migrationsTableExists,
    readApplied,
    planMigrations
} from '../server/migrations.js';

const args = process.argv.slice(2);
const statusOnly = args.includes('--status');
const dryRun = args.includes('--dry-run');

function fail(message) {
    console.error(message);
    process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url && !dryRun) {
    fail(
        'DATABASE_URL não configurada.\n' +
            'Defina no .env (local) ou nas variáveis de ambiente da hospedagem.\n' +
            'Para só ver o que seria aplicado, use: npm run migrate -- --dry-run'
    );
}

const migrations = await loadMigrations();
console.log(`${migrations.length} migrações encontradas em migrations/.`);

const sql = url ? neon(url) : null;

if (dryRun) {
    const resultado = await applyMigrations(sql ?? {}, migrations, { dryRun: true });
    if (!resultado.pending.length) {
        console.log('Nada pendente: todas as migrações já foram aplicadas.');
        process.exit(0);
    }
    console.log('\nSeriam aplicadas (em ordem):');
    for (const migration of resultado.pending) console.log(`  ${migration.id}`);
    console.log('\nNada foi executado (--dry-run).');
    process.exit(0);
}

try {
    if (statusOnly) {
        // `status` não cria nada: se a tabela de controle não existe, o banco nunca
        // recebeu migração e a lista inteira está pendente.
        const aplicadas = (await migrationsTableExists(sql)) ? await readApplied(sql) : [];
        const plano = planMigrations(migrations, aplicadas);
        console.log('');
        for (const migration of migrations) {
            const linha = aplicadas.find(row => row.id === migration.id);
            const estado = !linha
                ? 'pendente'
                : plano.drifted.some(d => d.id === migration.id)
                  ? 'EDITADA (banco divergente)'
                  : `aplicada em ${new Date(linha.appliedAt).toISOString().slice(0, 19).replace('T', ' ')}`;
            console.log(`  ${migration.id.padEnd(34)} ${estado}`);
        }
        if (plano.unknown.length) console.log(`\n  registradas no banco sem arquivo: ${plano.unknown.join(', ')}`);
        console.log('');
        const problema = plano.drifted.length > 0 || plano.unknown.length > 0;
        console.log(
            problema
                ? 'Banco e migrations/ divergiram — resolva antes de aplicar qualquer coisa.'
                : plano.pending.length
                  ? `${plano.pending.length} migração(ões) pendente(s). Rode: npm run migrate`
                  : 'Banco em dia com migrations/.'
        );
        process.exit(problema ? 1 : 0);
    }

    const resultado = await applyMigrations(sql, migrations, { log: console });
    if (!resultado.appliedNow.length) {
        console.log('Nada pendente: o banco já está em dia.');
    } else {
        console.log(`\nAplicadas: ${resultado.appliedNow.join(', ')}`);
    }
} catch (error) {
    fail(`\nFalha na migração: ${error.message}`);
}
