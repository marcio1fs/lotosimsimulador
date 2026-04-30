import { createClient } from '@supabase/supabase-js';

// ======================================================================
// CONFIGURAÇÃO SUPABASE (BANCO DE DADOS EM NUVEM)
// ======================================================================
// 1. Crie seu projeto em supabase.com
// 2. Rode o script SQL que está no arquivo supabase_setup.md
// 3. Cole suas chaves abaixo:
const SUPABASE_URL = 'https://xzwoohfebuieomyjmsft.supabase.co'; // Ex: 'https://xxxx.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh6d29vaGZlYnVpZW9teWptc2Z0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0MTI3MTQsImV4cCI6MjA5Mjk4ODcxNH0.1Mb6EjHZDPOqXTOIOMeB8kumzmge3foT_yO8Ymzcy-8'; // Ex: 'eyJhbGci...'

const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

/**
 * Model: Database - Híbrido (Supabase / IndexedDB)
 */
export class Database {
    static DB_NAME = 'LotoMaisDB';
    static DB_VERSION = 1;
    static db = null;
    static useSupabase = !!supabase;

    static async init() {
        if (this.useSupabase) {
            console.log("🔥 Backend Nuvem (Supabase) Ativado!");
            return true;
        }

        console.warn("💾 Backend Local (IndexedDB) Ativado. Dados não são persistidos na nuvem.");
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
            request.onerror = () => reject(new Error('Erro ao abrir banco de dados'));
        });
    }

    static async add(store, data) {
        if (this.useSupabase) {
            // Em Supabase, IDs auto_increment devem ser gerados pelo banco
            const payload = { ...data };
            if (store !== 'users' && store !== 'sessions' && payload.id && typeof payload.id === 'number') delete payload.id;
            
            // Corrige pequenas diferenças de nomenclatura entre IndexedDB e o script SQL
            if (store === 'users' && payload.createdAt) {
                payload.created_at = payload.createdAt;
                delete payload.createdAt;
            }
            if (store === 'sessions' && payload.createdAt) {
                delete payload.createdAt; // A tabela sessions no SQL não tem createdAt
            }
            if (store === 'auto_settings' && payload.intervalMinutes !== undefined) {
                delete payload.intervalMinutes; // Coluna ausente no SQL
            }
            
            const { data: result, error } = await supabase.from(store).insert(payload).select().single();
            if (error) {
                console.error('SUPABASE INSERT ERROR no store ' + store + ':', error, payload);
                throw error;
            }
            return result.id || result.userId;
        }

        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).add(data);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }

    static async get(store, id) {
        if (this.useSupabase) {
            const primaryKey = (store === 'user_stats' || store === 'auto_settings') ? 'userId' : 'id';
            const { data, error } = await supabase.from(store).select('*').eq(primaryKey, id).single();
            if (error && error.code !== 'PGRST116') throw error; // PGRST116 é no rows found
            return data || undefined;
        }

        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readonly');
            const req = tx.objectStore(store).get(id);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }

    static async getByIndex(store, indexName, value) {
        if (this.useSupabase) {
            let col = indexName;
            // Adaptação caso o indexName seja camelCase mas no DB esteja com aspas
            const { data, error } = await supabase.from(store).select('*').eq(col, value).single();
            if (error && error.code !== 'PGRST116') {
                console.error('SUPABASE SELECT ERROR:', error);
                throw error;
            }
            return data || undefined;
        }

        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readonly');
            const req = tx.objectStore(store).index(indexName).get(value);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }

    static async getAllByIndex(store, indexName, value) {
        if (this.useSupabase) {
            let col = indexName;
            const { data, error } = await supabase.from(store).select('*').eq(col, value);
            if (error) throw error;
            return data || [];
        }

        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readonly');
            const req = tx.objectStore(store).index(indexName).getAll(value);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }

    static async update(store, data) {
        if (this.useSupabase) {
            const payload = { ...data };
            
            // Corrige nomenclatura
            if (store === 'users' && payload.createdAt) {
                payload.created_at = payload.createdAt;
                delete payload.createdAt;
            }
            if (store === 'sessions' && payload.createdAt) delete payload.createdAt;
            if (store === 'auto_settings' && payload.intervalMinutes !== undefined) delete payload.intervalMinutes;

            const primaryKey = (store === 'user_stats' || store === 'auto_settings') ? 'userId' : 'id';
            
            if (!payload[primaryKey]) {
                const { data: result, error } = await supabase.from(store).insert(payload).select().single();
                if (error) throw error;
                return result;
            } else {
                const { data: result, error } = await supabase.from(store).update(payload).eq(primaryKey, payload[primaryKey]).select().single();
                if (error) throw error;
                return result;
            }
        }

        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).put(data);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }

    static async delete(store, id) {
        if (this.useSupabase) {
            const primaryKey = (store === 'user_stats' || store === 'auto_settings') ? 'userId' : 'id';
            const { error } = await supabase.from(store).delete().eq(primaryKey, id);
            if (error) throw error;
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
        if (this.useSupabase) {
            const { count, error } = await supabase.from(store).select('*', { count: 'exact', head: true });
            if (error) throw error;
            return count;
        }

        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readonly');
            const req = tx.objectStore(store).count();
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }
}

