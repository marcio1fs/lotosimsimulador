// ======================================================================
// BANCO DE DADOS HÍBRIDO: API SERVERLESS (/api -> Neon PostgreSQL) / INDEXEDDB LOCAL
// ======================================================================
// Segurança: Nenhuma credencial sensível ou driver SQL é incluído no bundle do cliente.
// Toda comunicação com o Neon PostgreSQL ocorre exclusivamente via funções serverless (/api/*)
// autenticadas com cookies HttpOnly + SameSite=Lax.

const ALLOWED_STORES = new Set([
    'users',
    'sessions',
    'games',
    'lottery_results',
    'simulations',
    'user_stats',
    'auto_settings',
    'auto_log'
]);

function assertValidStore(store) {
    if (!ALLOWED_STORES.has(store)) {
        throw new Error(`Store/tabela inválida bloqueada por segurança: ${store}`);
    }
}

async function apiPost(path, body) {
    const res = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(json.error || `Erro HTTP ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return json;
}

export class Database {
    static DB_NAME = 'LotoMaisDB';
    static DB_VERSION = 1;
    static db = null;
    static mode = 'local';
    static useApi = false;

    /** Alias retrocompatível para exibição de status na UI */
    static get useNeon() {
        return this.useApi;
    }

    static async init() {
        if (typeof fetch === 'function') {
            try {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 4500);
                const res = await fetch('/api/health', {
                    method: 'GET',
                    credentials: 'include',
                    signal: ctrl.signal
                });
                clearTimeout(timer);
                if (res.ok) {
                    const data = await res.json().catch(() => ({}));
                    if (data && data.ok) {
                        this.useApi = true;
                        this.mode = 'api';
                        return true;
                    }
                }
            } catch (_) {
                this.useApi = false;
                this.mode = 'local';
            }
        }

        this.useApi = false;
        this.mode = 'local';

        if (typeof indexedDB === 'undefined') {
            return null;
        }

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
        assertValidStore(store);
        if (this.useApi) {
            const r = await apiPost('/api/db/add', { store, data });
            return r.result;
        }
        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).add(data);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }

    static async addMany(store, items) {
        assertValidStore(store);
        if (!Array.isArray(items) || items.length === 0) return [];
        if (this.useApi) {
            const r = await apiPost('/api/db/addMany', { store, items });
            return r.result || [];
        }
        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readwrite');
            const os = tx.objectStore(store);
            const ids = [];
            for (const item of items) {
                const req = os.add(item);
                req.onsuccess = () => ids.push(req.result);
            }
            tx.oncomplete = () => res(ids);
            tx.onerror = () => rej(tx.error);
        });
    }

    static async incrementStats(deltas) {
        if (this.useApi) {
            const r = await apiPost('/api/db/incrementStats', deltas);
            return r.result;
        }
        return null;
    }

    static async syncLotteries(types) {
        if (!this.useApi) return null;
        return apiPost('/api/lottery/sync', { types });
    }

    static async get(store, id) {
        assertValidStore(store);
        if (this.useApi) {
            const r = await apiPost('/api/db/get', { store, id });
            return r.result ?? undefined;
        }
        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readonly');
            const req = tx.objectStore(store).get(id);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }

    static async getByIndex(store, indexName, value) {
        assertValidStore(store);
        if (this.useApi) {
            const r = await apiPost('/api/db/getByIndex', { store, index: indexName, value });
            return r.result ?? undefined;
        }
        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readonly');
            const req = tx.objectStore(store).index(indexName).get(value);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }

    static async getAllByIndex(store, indexName, value) {
        assertValidStore(store);
        if (this.useApi) {
            const r = await apiPost('/api/db/getAllByIndex', { store, index: indexName, value });
            return r.result || [];
        }
        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readonly');
            const req = tx.objectStore(store).index(indexName).getAll(value);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }

    static async update(store, data) {
        assertValidStore(store);
        if (this.useApi) {
            const r = await apiPost('/api/db/update', { store, data });
            return r.result ?? undefined;
        }
        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readwrite');
            const req = tx.objectStore(store).put(data);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }

    static async delete(store, id) {
        assertValidStore(store);
        if (this.useApi) {
            await apiPost('/api/db/delete', { store, id });
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
        assertValidStore(store);
        if (this.useApi) {
            const r = await apiPost('/api/db/count', { store });
            return r.result || 0;
        }
        return new Promise((res, rej) => {
            const tx = this.db.transaction(store, 'readonly');
            const req = tx.objectStore(store).count();
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    }
}
