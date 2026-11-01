/**
 * Política de mesma origem para requisições que mudam estado (item 6.13).
 *
 * O PROBLEMA
 * ----------
 * A sessão vive em um cookie (`HttpOnly; SameSite=Lax`). `Lax` impede que um
 * site terceiro dispare um POST com o cookie anexado, o que já cobre o caso
 * clássico de CSRF por formulário. Ainda assim, `SameSite` é uma única camada:
 * depende do comportamento do navegador, e navegadores antigos (ou clientes que
 * ignoram a flag) não a respeitam.
 *
 * A implementação anterior tentava uma segunda camada, mas **abria a porta**
 * exatamente onde importava:
 *
 *     const origin = req.headers.origin;
 *     if (origin && new URL(origin).host !== req.headers.host) throw 403;
 *
 * Três furos:
 *
 * 1. `if (origin && ...)` — requisição **sem** `Origin` passava. Fail-open.
 * 2. `Origin: null` (iframe sandbox, `file://`, alguns redirects) estourava
 *    `new URL('null')` e virava **500**, não 403.
 * 3. Nada olhava `Sec-Fetch-Site`, o cabeçalho que o navegador preenche e que a
 *    página **não consegue** falsificar (é *forbidden header name*).
 *
 * A REGRA AGORA
 * -------------
 * Requisição que muda estado (POST/PUT/PATCH/DELETE) só passa se:
 *
 * - `Sec-Fetch-Site` não disser `cross-site`; **e**
 * - houver `Origin` (ausência é recusa, não permissão); **e**
 * - o `Origin` for `"null"`-livre, `http(s)` e bater com o host da requisição
 *   ou com a lista explícita de origens permitidas.
 *
 * Isso é *fail-closed*: qualquer coisa que não se prove legítima é recusada com
 * 403 e o motivo. Cliente que não é navegador (curl, integração) precisa mandar
 * `Origin` — o que é o comportamento correto de uma API que aceita cookie.
 *
 * Defesa em profundidade que já existia e continua valendo: só `application/json`
 * é aceito em POST (415 caso contrário). Formulário HTML não consegue emitir
 * esse content-type sem CORS preflight, então um `<form>` malicioso não chega
 * nem a esta checagem.
 */

/** Métodos que mudam estado e, por isso, passam pela verificação. */
export const MUTATING_METHODS = Object.freeze(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Content-Type exigido nas mutações (bloqueia formulário HTML simples). */
export const REQUIRED_CONTENT_TYPE = 'application/json';

export const isMutatingMethod = method => MUTATING_METHODS.includes(String(method || '').toUpperCase());

/**
 * Hosts aceitáveis para a requisição, vindos dos cabeçalhos de proxy.
 * O `Host` é o que o cliente pediu; `X-Forwarded-Host` é o que o proxy repassou
 * (na Vercel são iguais, mas em proxy reverso podem divergir).
 *
 * @param {object} req
 * @returns {string[]}
 */
export function requestHosts(req) {
    const headers = req?.headers || {};
    const hosts = new Set();
    const add = value => {
        if (!value) return;
        for (const part of String(value).split(',')) {
            const host = part.trim().toLowerCase();
            if (host) hosts.add(host);
        }
    };
    add(headers.host);
    add(headers['x-forwarded-host']);
    return [...hosts];
}

/**
 * Normaliza a variável de ambiente com origens permitidas
 * (`ALLOWED_ORIGINS=https://app.exemplo.com,https://preview.exemplo.com`).
 *
 * @param {string|undefined} value
 * @returns {string[]} origens no formato `scheme://host[:port]`
 */
export function parseAllowedOrigins(value) {
    if (!value) return [];
    const out = new Set();
    for (const part of String(value).split(',')) {
        const raw = part.trim();
        if (!raw) continue;
        try {
            const url = new URL(raw);
            if (url.protocol === 'http:' || url.protocol === 'https:') out.add(url.origin.toLowerCase());
        } catch {
            // Entrada inválida no ambiente é ignorada — nunca amplia o acesso.
        }
    }
    return [...out];
}

const allow = reason => ({ allowed: true, checked: true, reason });
const deny = reason => ({ allowed: false, checked: true, reason });

/**
 * Avalia se a requisição pode mudar estado.
 *
 * @param {object} req - objeto de requisição (method, headers)
 * @param {object} [options]
 * @param {string[]} [options.allowedOrigins] - origens extras explicitamente confiadas
 * @returns {{allowed: boolean, checked: boolean, reason: string}}
 */
export function evaluateSameSiteRequest(req, options = {}) {
    const method = String(req?.method || '').toUpperCase();
    if (!isMutatingMethod(method)) {
        return { allowed: true, checked: false, reason: `método ${method || '?'} não altera estado` };
    }

    const headers = req?.headers || {};
    const allowedOrigins = (options.allowedOrigins || []).map(o => String(o).toLowerCase());

    // 1. Cabeçalho que a página não consegue forjar.
    const secFetchSite = String(headers['sec-fetch-site'] || '')
        .trim()
        .toLowerCase();
    if (secFetchSite === 'cross-site') {
        return deny('Sec-Fetch-Site: cross-site');
    }

    // 2. Origin é obrigatório. Ausência não é permissão.
    const rawOrigin = headers.origin;
    if (rawOrigin === undefined || rawOrigin === null) {
        return deny('cabeçalho Origin ausente');
    }
    const origin = String(rawOrigin).trim();
    if (!origin) return deny('cabeçalho Origin vazio');
    if (origin.toLowerCase() === 'null') return deny('Origin: null (contexto isolado)');

    let parsed;
    try {
        parsed = new URL(origin);
    } catch {
        return deny(`Origin inválido: ${origin}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return deny(`esquema de Origin não permitido: ${parsed.protocol}`);
    }

    // 3. Lista explícita (domínio próprio, previews) tem precedência.
    if (allowedOrigins.includes(parsed.origin.toLowerCase())) {
        return allow(`origem autorizada explicitamente: ${parsed.origin}`);
    }

    // 4. Mesma origem: o host do Origin precisa ser o host que recebeu o pedido.
    const hosts = requestHosts(req);
    if (hosts.length === 0) {
        return deny('host da requisição desconhecido');
    }
    if (hosts.includes(parsed.host.toLowerCase())) {
        return allow('mesma origem');
    }

    return deny(`Origin ${parsed.host} não corresponde ao host ${hosts[0]}`);
}

/**
 * O corpo precisa ser JSON. Formulário HTML (`application/x-www-form-urlencoded`,
 * `multipart/form-data`, `text/plain`) é exatamente o que um CSRF simples
 * consegue emitir.
 *
 * @param {object} req
 * @returns {boolean}
 */
export function hasJsonContentType(req) {
    const value = String(req?.headers?.['content-type'] || '');
    return value.toLowerCase().includes(REQUIRED_CONTENT_TYPE);
}
