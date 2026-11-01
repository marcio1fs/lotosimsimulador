/**
 * Testes da borda CSRF (item 6.13 da auditoria).
 *
 * `SameSite=Lax` já impede o CSRF clássico por formulário, mas é uma camada só.
 * A checagem de `Origin` anterior tinha três furos, e cada um tem teste aqui:
 *
 *  1. `if (origin && ...)` — requisição sem Origin passava (fail-open);
 *  2. `Origin: null` estourava `new URL()` e virava 500 em vez de 403;
 *  3. `Sec-Fetch-Site` era ignorado, mesmo sendo o cabeçalho que a página não
 *     consegue falsificar.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    evaluateSameSiteRequest,
    parseAllowedOrigins,
    requestHosts,
    hasJsonContentType,
    isMutatingMethod,
    MUTATING_METHODS
} from '../server/originPolicy.js';
import { handler } from '../server/handler.js';

const req = (overrides = {}) => ({
    method: 'POST',
    url: '/api/auth/login',
    ...overrides,
    headers: { host: 'app.exemplo.com', origin: 'https://app.exemplo.com', ...(overrides.headers || {}) }
});

/** Resposta falsa: guarda status, cabeçalhos e o corpo já desserializado. */
function fakeRes() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        end(payload) {
            this.body = payload ? JSON.parse(payload) : null;
            this.finished = true;
        }
    };
}

/** Requisição falsa pronta para o handler (corpo já disponível). */
function fakeReq({ method = 'POST', url = '/api/auth/login', headers = {}, body = {} } = {}) {
    return { method, url, headers, body };
}

describe('Política de mesma origem — decisões', () => {
    it('métodos de leitura não passam pela verificação', () => {
        for (const method of ['GET', 'HEAD', 'OPTIONS']) {
            const result = evaluateSameSiteRequest({ method, headers: {} });
            assert.equal(result.allowed, true);
            assert.equal(result.checked, false);
        }
    });

    it('mutação com Origin igual ao host é aceita', () => {
        const result = evaluateSameSiteRequest(req());
        assert.equal(result.allowed, true);
        assert.match(result.reason, /mesma origem/);
    });

    it('mutação com Origin de outro site é recusada', () => {
        const result = evaluateSameSiteRequest(req({ headers: { origin: 'https://atacante.example' } }));
        assert.equal(result.allowed, false);
        assert.match(result.reason, /não corresponde/);
    });

    it('requisição sem Origin é recusada (fail-closed)', () => {
        const result = evaluateSameSiteRequest({ method: 'POST', headers: { host: 'app.exemplo.com' } });
        assert.equal(result.allowed, false);
        assert.match(result.reason, /Origin ausente/);
    });

    it('Origin: null é recusado sem derrubar o servidor', () => {
        const result = evaluateSameSiteRequest(req({ headers: { origin: 'null' } }));
        assert.equal(result.allowed, false);
        assert.match(result.reason, /null/);
    });

    it('Origin malformado é recusado como 403, não como erro interno', () => {
        for (const origin of ['///', 'nao-e-url', '']) {
            const result = evaluateSameSiteRequest(req({ headers: { origin } }));
            assert.equal(result.allowed, false, `origem ${JSON.stringify(origin)} deveria ser recusada`);
        }
    });

    it('esquema não-HTTP é recusado', () => {
        const result = evaluateSameSiteRequest(req({ headers: { origin: 'file://app.exemplo.com' } }));
        assert.equal(result.allowed, false);
        assert.match(result.reason, /esquema/);
    });

    it('porta diferente conta como origem diferente', () => {
        const result = evaluateSameSiteRequest(req({ headers: { origin: 'https://app.exemplo.com:8443' } }));
        assert.equal(result.allowed, false);
    });

    it('Sec-Fetch-Site: cross-site vence até um Origin que bateria', () => {
        const result = evaluateSameSiteRequest(req({ headers: { 'sec-fetch-site': 'cross-site' } }));
        assert.equal(result.allowed, false);
        assert.match(result.reason, /cross-site/);
    });

    it('Sec-Fetch-Site: same-origin com Origin válido é aceito', () => {
        const result = evaluateSameSiteRequest(req({ headers: { 'sec-fetch-site': 'same-origin' } }));
        assert.equal(result.allowed, true);
    });

    it('origem explicitamente permitida passa mesmo em host diferente', () => {
        const result = evaluateSameSiteRequest(
            req({ headers: { origin: 'https://app.dominio.proprio' } }),
            { allowedOrigins: ['https://app.dominio.proprio'] }
        );
        assert.equal(result.allowed, true);
        assert.match(result.reason, /autorizada explicitamente/);
    });

    it('X-Forwarded-Host é considerado quando o proxy repassa outro host', () => {
        const result = evaluateSameSiteRequest({
            method: 'POST',
            headers: {
                host: 'interno:3000',
                'x-forwarded-host': 'app.exemplo.com',
                origin: 'https://app.exemplo.com'
            }
        });
        assert.equal(result.allowed, true);
    });

    it('sem host confiável, a requisição é recusada', () => {
        const result = evaluateSameSiteRequest({ method: 'POST', headers: { origin: 'https://app.exemplo.com' } });
        assert.equal(result.allowed, false);
        assert.match(result.reason, /host/);
    });

    it('PUT, PATCH e DELETE também são verificados', () => {
        for (const method of MUTATING_METHODS) {
            assert.equal(isMutatingMethod(method), true);
            const blocked = evaluateSameSiteRequest({ method, headers: { host: 'app.exemplo.com' } });
            assert.equal(blocked.allowed, false, `${method} sem Origin deveria ser recusado`);
        }
    });
});

describe('Política de mesma origem — utilidades', () => {
    it('ALLOWED_ORIGINS normaliza, ignora inválidas e não amplia acesso', () => {
        const parsed = parseAllowedOrigins('https://a.example, nonsense, ftp://b.example, https://a.example');
        assert.deepEqual(parsed, ['https://a.example']);
        assert.deepEqual(parseAllowedOrigins(undefined), []);
        assert.deepEqual(parseAllowedOrigins(''), []);
    });

    it('requestHosts junta Host e X-Forwarded-Host sem duplicar', () => {
        const hosts = requestHosts({
            headers: { host: 'a.example', 'x-forwarded-host': 'a.example, b.example' }
        });
        assert.deepEqual(hosts.sort(), ['a.example', 'b.example']);
    });

    it('só application/json é aceito como corpo de mutação', () => {
        assert.equal(hasJsonContentType({ headers: { 'content-type': 'application/json; charset=utf-8' } }), true);
        assert.equal(hasJsonContentType({ headers: { 'content-type': 'Application/JSON' } }), true);
        assert.equal(hasJsonContentType({ headers: { 'content-type': 'application/x-www-form-urlencoded' } }), false);
        assert.equal(hasJsonContentType({ headers: { 'content-type': 'text/plain' } }), false);
        assert.equal(hasJsonContentType({ headers: {} }), false);
    });
});

describe('Handler — a borda em funcionamento', () => {
    it('POST cross-site morre em 403 antes de qualquer acesso ao banco', async () => {
        const res = fakeRes();
        await handler(fakeReq({
            headers: {
                host: 'app.exemplo.com',
                origin: 'https://atacante.example',
                'content-type': 'application/json'
            },
            body: { email: 'a@b.com', password: 'x' }
        }), res);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.success, false);
        assert.match(res.body.reason, /não corresponde/);
    });

    it('POST sem Origin morre em 403', async () => {
        const res = fakeRes();
        await handler(fakeReq({
            headers: { host: 'app.exemplo.com', 'content-type': 'application/json' },
            body: {}
        }), res);

        assert.equal(res.statusCode, 403);
        assert.match(res.body.reason, /Origin ausente/);
    });

    it('POST cross-site com Origin: null morre em 403 (não em 500)', async () => {
        const res = fakeRes();
        await handler(fakeReq({
            headers: { host: 'app.exemplo.com', origin: 'null', 'content-type': 'application/json' },
            body: {}
        }), res);

        assert.equal(res.statusCode, 403);
    });

    it('corpo não-JSON é barrado em 415 antes da rota', async () => {
        const res = fakeRes();
        await handler(fakeReq({
            headers: { host: 'app.exemplo.com', origin: 'https://app.exemplo.com', 'content-type': 'application/x-www-form-urlencoded' },
            body: {}
        }), res);

        assert.equal(res.statusCode, 415);
    });

    it('POST de mesma origem atravessa a borda e chega na rota', async () => {
        const res = fakeRes();
        await handler(fakeReq({
            url: '/api/db/get',
            headers: { host: 'app.exemplo.com', origin: 'https://app.exemplo.com', 'content-type': 'application/json' },
            body: { store: 'games', id: 1 }
        }), res);

        // Sem cookie de sessão a rota responde 401 — o que prova que a requisição
        // passou pela verificação de origem e não foi barrada na borda.
        assert.equal(res.statusCode, 401);
        assert.match(res.body.error, /autenticado/i);
    });
});
