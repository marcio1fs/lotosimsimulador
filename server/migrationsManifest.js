/**
 * GERADO por `npm run build:manifest` a partir de `migrations/*.sql`.
 *
 * Não edite à mão: o próximo build sobrescreve e a CI falha se divergir.
 * Serve para o `/api/health` saber o que o código espera do banco sem ler
 * o disco em tempo de requisição — ver `server/health.js`.
 */

export const MIGRATION_MANIFEST = Object.freeze([
    { id: '001_schema_inicial', checksum: 'f10457bb829bf0121d8af23bbac34050d99fb4b910526f5a58ace2e8da1d0b12' },
    { id: '002_recuperacao_de_conta', checksum: '7890ae069304fd6618ec4d5ae1a4a57e2b37b3f4f2e5afde2af36306ddb15272' },
    { id: '003_limite_de_requisicoes', checksum: '5bc87d30c8aeb498f80f298b1e2c8452d10d22d1688c75392025ef1e48281e64' }
]);

/** Quantidade de migrações que o código conhece (atalho para o relatório). */
export const EXPECTED_MIGRATIONS = MIGRATION_MANIFEST.length;
