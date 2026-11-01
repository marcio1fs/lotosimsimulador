/**
 * Superfície de script e CSP.
 *
 * POR QUE ISTO É TESTE E NÃO DOCUMENTAÇÃO
 * --------------------------------------
 * O `Content-Security-Policy` mora em `vercel.json` e o `<script>` de terceiro morava
 * num template. Os dois são fáceis de "consertar" de volta sem ninguém notar: basta
 * alguém precisar de uma biblioteca e colar a tag do CDN — gesto comum, que reabre
 * exatamente o risco que este item fechou (código de terceiro executando na origem do
 * app, com acesso ao cookie de sessão).
 *
 * Um `script-src 'self'` sem teste é uma intenção. Com teste, é um contrato: quem
 * colar o CDN de volta vê a CI ficar vermelha e descobre o motivo escrito aqui.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { documentHead } from '../js/views/templates/documentHead.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');

/** Diretivas do CSP declarado em vercel.json, como `{ 'script-src': ["'self'"] }`. */
function cspDirectives() {
    const config = JSON.parse(read('vercel.json'));
    const header = config.headers.flatMap(entry => entry.headers).find(item => item.key === 'Content-Security-Policy');
    assert.ok(header, 'vercel.json precisa declarar Content-Security-Policy');

    const directives = {};
    for (const part of header.value.split(';')) {
        const [name, ...values] = part.trim().split(/\s+/);
        if (name) directives[name] = values;
    }
    return directives;
}

describe('Content-Security-Policy', () => {
    it('script-src é apenas a própria origem', () => {
        const directives = cspDirectives();
        assert.deepEqual(directives['script-src'], ["'self'"], 'script de terceiro ou inline volta a ser permitido');

        const proibidos = ["'unsafe-inline'", "'unsafe-eval'", 'https:', 'http:', '*'];
        for (const valor of proibidos) {
            assert.ok(!directives['script-src'].includes(valor), `script-src não pode conter ${valor}`);
        }
    });

    it('não sobra nenhum host de terceiro em script-src, worker-src ou object-src', () => {
        const directives = cspDirectives();
        const comScript = ['script-src', 'worker-src', 'object-src'];
        for (const nome of comScript) {
            for (const valor of directives[nome] || []) {
                assert.ok(!/^https?:\/\//.test(valor), `${nome} ainda libera origem externa: ${valor}`);
            }
        }
        // `object-src` pode ser omitido (o `default-src 'self'` cobre), mas se existir
        // não pode ser permissivo.
        if (directives['object-src']) assert.deepEqual(directives['object-src'], ["'none'"]);
    });

    it('mantém as travas de enquadramento, base e formulário', () => {
        const directives = cspDirectives();
        assert.deepEqual(directives['default-src'], ["'self'"]);
        assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
        assert.deepEqual(directives['base-uri'], ["'self'"]);
        assert.deepEqual(directives['form-action'], ["'self'"]);
    });

    it('connect-src lista só a própria origem e as fontes de resultado', () => {
        const directives = cspDirectives();
        const hosts = (directives['connect-src'] || []).filter(valor => /^https?:\/\//.test(valor));
        assert.ok(!hosts.includes('*'), 'connect-src não pode ser curinga');
        assert.ok(directives['connect-src'].includes("'self'"));
        for (const host of hosts) {
            assert.match(
                host,
                /^https:\/\/(loteriascaixa-api\.herokuapp\.com|servicebus2\.caixa\.gov\.br)$/,
                `host inesperado em connect-src: ${host}`
            );
        }
    });

    it('as fontes seguem fora do CSP de script (folha de estilo, não código)', () => {
        const directives = cspDirectives();
        // Documentado como dependência externa restante: fonte não executa JS, mas o
        // CSS do Google Fonts é conteúdo de terceiro. Se um dia for auto-hospedado,
        // este teste avisa que o CSP pode encolher de novo.
        assert.deepEqual(directives['style-src'], ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']);
        assert.deepEqual(directives['font-src'], ["'self'", 'https://fonts.gstatic.com']);
    });
});

describe('Dependências de terceiro no navegador', () => {
    it('Chart.js é dependência do projeto, não tag de CDN', () => {
        const pkg = JSON.parse(read('package.json'));
        assert.ok(pkg.dependencies['chart.js'], 'chart.js precisa estar em dependencies para o build resolver');
        assert.match(pkg.dependencies['chart.js'], /^\^?4\./, 'a versão precisa continuar na linha 4.x');

        // O que importa é o HTML gerado (o comentário do módulo pode citar a tag
        // antiga para explicar por que ela saiu).
        const head = documentHead();
        assert.doesNotMatch(head, /<script/i, 'o <head> não deve carregar script nenhum');
        assert.doesNotMatch(head, /jsdelivr|cdn\./i, 'CDN voltou para o <head>');
    });

    it('o Chart.js entra por import dinâmico (não pesa no carregamento inicial)', () => {
        const view = read('js/views/statistics.js');
        assert.match(view, /import\(['"]chart\.js\/auto['"]\)/, 'esperado import dinâmico de chart.js/auto');
        assert.doesNotMatch(view, /window\.Chart/, 'o Chart não pode vir de variável global');

        // Cada `new Chart(` tem de estar ligado a um `Chart` local vindo do bundle.
        const instancias = view.match(/new Chart\(/g) || [];
        const doBundle = view.match(/const Chart = await this\._chart\(\);/g) || [];
        assert.ok(instancias.length > 0, 'esperado pelo menos um gráfico');
        assert.equal(doBundle.length, instancias.length, 'todo `new Chart` precisa vir do import, não de global');
    });

    it('o documento versionado não tem script inline nem handler inline', () => {
        const html = read('index.html');
        assert.doesNotMatch(
            html,
            /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i,
            'script inline no documento'
        );
        assert.doesNotMatch(html, /\son(click|change|submit|input|load|error)=/i);
    });
});
