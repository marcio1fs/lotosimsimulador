import { neon } from '@neondatabase/serverless';

// ======================================================================
// CONFIGURAÇÃO BANCO DE DADOS (HÍBRIDO: NEON POSTGRESQL / INDEXEDDB LOCAL)
// ======================================================================
// Para conectar ao Neon na nuvem, adicione VITE_NEON_DATABASE_URL no seu .env
// ou preencha a constante NEON_URL abaixo:
const NEON_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_NEON_DATABASE_URL)
    ? import.meta.env.VITE_NEON_DATABASE_URL
    : 'postgresql://neondb_owner:npg_tVidcF3Xq5bH@ep-wispy-sunset-avmm8hw8.c-11.us-east-1.aws.neon.tech/neondb?sslmode=require';

let sqlClient = null;

function getSqlClient() {
    if (!sqlClient && NEON_URL) {
        sqlClient = neon(NEON_URL);
    }
    return sqlClient;
}

// Helpers para conversão de camelCase <-> snake_case
function toSnakeCase(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function toCamelCase(str) {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function mapObjectToSnake(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const mapped = {};
    for (const [k, v] of Object.entries(obj)) {
        mapped[toSnakeCase(k)] = v;
    }
    return mapped;
}

function mapObjectToCamel(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const mapped = {};
    for (const [k, v] of Object.entries(obj)) {
        mapped[toCamelCase(k)] = v;
    }
    return mapped;
}

/**
 * Model: Database - Híbrido (Neon PostgreSQL / IndexedDB Local)
 */
export class Database {
    static DB_NAME = 'LotoMaisDB';
    static DB_VERSION = 1;
    static db = null;
    static useNeon = Boolean(NEON_URL && NEON_URL.startsWith('postgres'));

    static async init() {
        if (this.useNeon) {
            try {
                const sql = getSqlClient();
                const testResult = await sql`SELECT NOW() as now`;
                console.log("🔥 Backend Nuvem (Neon PostgreSQL) Conectado com Sucesso!", testResult[0]?.now);
                return true;
            } catch (err) {
                console.error("⚠️ Falha ao conectar no Neon PostgreSQL. Alternando para IndexedDB local:", err);
                this.useNeon = false;
            }
        }

        console.log("💾 Backend Local (IndexedDB) Ativado.");
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                const stores = {
                    users: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'email', keyPath: 'email', unique: true }, { name: 'name', keyPath: 'name' }] },
                    sessions: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'userId', keyPath: 'userId' }, { name: 'token', keyPath: 'token', unique: true }, { name: 'expiresAt', keyPath: 'expiresAt' }] },
                    games: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'userId', keyPath: 'userId' }, { name: 'lotteryType', keyPath: 'lotteryType' }, { name: 'createdAt', keyPath: 'createdAt' }] },
                    lottery_results: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'lotteryType', keyPath: 'lotteryType' }, { name: 'concurso', keyPath: 'concurso' }, { name: 'fetchedAt', keyPath: 'fetchedAt' }] },
                    simulations: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'userId', keyPath: 'userId' }, { name: 'createdAt', keyPath: 'createdAt' }] },
                    user_stats: { keyPath: 'userId' },
                    auto_settings: { keyPath: 'userId' },
                    auto_log: { keyPath: 'id', autoIncrement: true, indexes: [{ name: 'userId', keyPath: 'userId' }, { name: 'timestamp', keyPath: 'timestamp' }] }
                };
                for (const [name, cfg] of Object.entries(stores)) {
                    if (!db.objectStoreNames.contains(name)) {
                        const store = db.createObjectStore(name, { keyPath: cfg.keyPath, autoIncrement: cfg.autoIncrement || false });
                        cfg.indexes?.forEach(idx => store.createIndex(idx.name, idx.keyPath, { unique: idx.unique || false }));
                    }
                }
            };
            request.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
            request.onerror = () => reject(new Error('Erro ao abrir banco de dados local'));
        });
    }

    static async add(store, data) {
        if (this.useNeon) {
            const sql = getSqlClient();
            const payload = mapObjectToSnake(data);
            if (payload.id && typeof payload.id === 'number') delete payload.id;

            const cols = Object.keys(payload);
            const values = Object.values(payload).map(v => (typeof v === 'object' && v !== null) ? JSON.stringify(v) : v);

            const colNames = cols.map(c => `"${c}"`).join(', ');
            const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

            const query = `INSERT INTO "${store}" (${colNames}) VALUES (${placeholders}) RETURNING *;`;
            const rows = await sql.query(query, values);
            const res = mapObjectToCamel(rows[0]);
            return res.id || res.userId;
        }

        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).add(data);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }

    static async get(store, id) {
        if (this.useNeon) {
            const sql = getSqlClient();
            const pk = (store === 'user_stats' || store === 'auto_settings') ? 'user_id' : 'id';
            const query = `SELECT * FROM "${store}" WHERE "${pk}" = $1 LIMIT 1;`;
            const rows = await sql.query(query, [id]);
            return rows.length > 0 ? mapObjectToCamel(rows[0]) : undefined;
        }

        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readonly');
            const req = tx.objectStore(store).get(id);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }

    static async getByIndex(store, indexName, value) {
        if (this.useNeon) {
            const sql = getSqlClient();
            const col = toSnakeCase(indexName);
            const query = `SELECT * FROM "${store}" WHERE "${col}" = $1 LIMIT 1;`;
            const rows = await sql.query(query, [value]);
            return rows.length > 0 ? mapObjectToCamel(rows[0]) : undefined;
        }

        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readonly');
            const req = tx.objectStore(store).index(indexName).get(value);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }

    static async getAllByIndex(store, indexName, value) {
        if (this.useNeon) {
            const sql = getSqlClient();
            const col = toSnakeCase(indexName);
            const query = `SELECT * FROM "${store}" WHERE "${col}" = $1 ORDER BY id DESC;`;
            const rows = await sql.query(query, [value]);
            return rows.map(r => mapObjectToCamel(r));
        }

        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readonly');
            const req = tx.objectStore(store).index(indexName).getAll(value);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }

    static async update(store, data) {
        if (this.useNeon) {
            const sql = getSqlClient();
            const payload = mapObjectToSnake(data);
            const pk = (store === 'user_stats' || store === 'auto_settings') ? 'user_id' : 'id';
            const pkVal = payload[pk];

            if (!pkVal) {
                return await this.add(store, data);
            }

            const cols = Object.keys(payload).filter(c => c !== pk);
            const values = cols.map(c => {
                const v = payload[c];
                return (typeof v === 'object' && v !== null) ? JSON.stringify(v) : v;
            });
            values.push(pkVal);

            const setClause = cols.map((c, i) => `"${c}" = $${i + 1}`).join(', ');
            const query = `UPDATE "${store}" SET ${setClause} WHERE "${pk}" = $${values.length} RETURNING *;`;
            const rows = await sql.query(query, values);
            return rows.length > 0 ? mapObjectToCamel(rows[0]) : undefined;
        }

        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).put(data);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }

    static async delete(store, id) {
        if (this.useNeon) {
            const sql = getSqlClient();
            const pk = (store === 'user_stats' || store === 'auto_settings') ? 'user_id' : 'id';
            const query = `DELETE FROM "${store}" WHERE "${pk}" = $1;`;
            await sql.query(query, [id]);
            return;
        }

        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).delete(id);
            req.onsuccess = () => res();
            req.onerror = () => rej(req.error);
        });
    }

    static async count(store) {
        if (this.useNeon) {
            const sql = getSqlClient();
            const query = `SELECT COUNT(*)::int as count FROM "${store}";`;
            const rows = await sql.query(query);
            return rows[0]?.count || 0;
        }

        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readonly');
            const req = tx.objectStore(store).count();
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }
}
