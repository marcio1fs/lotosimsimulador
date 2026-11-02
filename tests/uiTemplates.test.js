/**
 * Testes da camada visual (item 6.11 da auditoria).
 *
 * O `index.html` era um arquivo de 34 KB com cabeçalho, login, overlay, casca,
 * três telas e três modais. Nada disso tinha teste — não por falta de vontade,
 * mas porque markup dentro de um `.html` não pode ser importado por Node.
 *
 * Agora cada seção é um módulo puro, o documento é montado por eles, e este
 * arquivo cobre o que antes era invisível:
 *
 *  - o `index.html` versionado é exatamente o que os templates geram;
 *  - todo `id` que o JS procura existe no documento;
 *  - toda intenção declarada no HTML (`data-action`, `data-screen`, `data-tab`,
 *    `data-strategy`) tem um destino real no código;
 *  - acessibilidade mínima (labels, botões com texto, canvas com id);
 *  - um único script de aplicação, sem lógica inline.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { buildIndexHtml, DOCUMENT_SECTIONS } from '../js/views/templates/document.js';
import { LotteryModel } from '../js/models/lottery.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = rel => readFile(new URL(rel, import.meta.url), 'utf8');

/** Percorre `js/` coletando arquivos .js. */
async function jsFiles(dir = new URL('../js/', import.meta.url)) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
        if (entry.isDirectory()) out.push(...(await jsFiles(child)));
        else if (entry.name.endsWith('.js')) out.push(fileURLToPath(child));
    }
    return out;
}

const HTML = buildIndexHtml();
const htmlIds = [...HTML.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);

describe('Montagem do documento', () => {
    it('o index.html versionado é exatamente o que os templates geram', async () => {
        const onDisk = await read('../index.html');
        assert.equal(
            onDisk,
            HTML,
            'index.html divergiu dos templates. Ele é GERADO: edite js/views/templates/*.js ' +
                'e rode `node scripts/build-html.mjs`.'
        );
    });

    it('o documento tem começo, meio e fim', () => {
        assert.ok(HTML.startsWith('<!DOCTYPE html>'), 'falta o doctype');
        assert.ok(HTML.trimEnd().endsWith('</html>'), 'documento não fecha');
        assert.equal((HTML.match(/<body>/g) || []).length, 1);
        assert.equal((HTML.match(/<\/body>/g) || []).length, 1);
        assert.equal((HTML.match(/<head>/g) || []).length, 1);
    });

    it('cada seção devolve markup não vazio e na ordem esperada', () => {
        const positions = DOCUMENT_SECTIONS.map(section => {
            const markup = section.render();
            assert.ok(typeof markup === 'string' && markup.length > 0, `seção ${section.id} vazia`);
            const at = HTML.indexOf(markup);
            assert.ok(at >= 0, `seção ${section.id} não aparece no documento`);
            return at;
        });
        for (let i = 1; i < positions.length; i++) {
            assert.ok(positions[i] > positions[i - 1], `seção ${DOCUMENT_SECTIONS[i].id} fora de ordem`);
        }
    });

    it('os templates são puros: sem DOM, sem estado, sem imports internos', async () => {
        const files = (await jsFiles()).filter(f => f.includes('/views/templates/'));
        assert.ok(files.length >= 9, `esperava os módulos de template, encontrei ${files.length}`);
        for (const file of files) {
            const src = await readFile(file, 'utf8');
            assert.doesNotMatch(src, /\bdocument\.|window\.|globalThis\./, `${file} toca no DOM`);
            assert.doesNotMatch(src, /Math\.random/, `${file} não é determinístico`);
            const imports = [...src.matchAll(/^import .*from '([^']+)';$/gm)].map(m => m[1]);
            for (const spec of imports) {
                assert.ok(spec.startsWith('./'), `${file} importa ${spec}: a camada visual deve ser sintética`);
            }
        }
        assert.equal(buildIndexHtml(), buildIndexHtml());
    });
});

describe('Integridade estrutural do HTML', () => {
    it('não há id duplicado', () => {
        const seen = new Set();
        const dups = [];
        for (const id of htmlIds) {
            if (seen.has(id)) dups.push(id);
            seen.add(id);
        }
        assert.deepEqual(dups, []);
    });

    it('todo id procurado pelo JS existe no documento', async () => {
        const referenced = new Map();
        for (const file of await jsFiles()) {
            const src = await readFile(file, 'utf8');
            for (const m of src.matchAll(/document\.getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
                // `win.document.getElementById` é o documento da janela de
                // impressão, gerado em runtime — não faz parte deste HTML.
                if (src.slice(m.index - 4, m.index) === 'win.') continue;
                referenced.set(m[1], file);
            }
            for (const m of src.matchAll(/document\.querySelector(?:All)?\(\s*['"]#([A-Za-z0-9_-]+)['"]\s*\)/g)) {
                referenced.set(m[1], file);
            }
        }
        assert.ok(referenced.size > 50, `esperava muitas referências, encontrei ${referenced.size}`);

        const ids = new Set(htmlIds);
        const missing = [...referenced].filter(([id]) => !ids.has(id));
        assert.deepEqual(
            missing.map(([id, file]) => `${id} (${file.replace(ROOT, '')})`),
            [],
            'o JS procura elementos que não existem no HTML'
        );
    });

    it('todo data-action do HTML tem tratamento, e não sobra handler órfão', async () => {
        const htmlActions = new Set([...HTML.matchAll(/data-action="([^"]+)"/g)].map(m => m[1]));
        const main = await read('../js/main.js');

        const handled = new Set([
            ...[...main.matchAll(/action\s*===\s*'([^']+)'/g)].map(m => m[1]),
            ...[...main.matchAll(/\[data-action="([^"]+)"\]/g)].map(m => m[1])
        ]);

        assert.deepEqual(
            [...htmlActions].filter(a => !handled.has(a)),
            [],
            'ações sem handler em main.js'
        );
        assert.deepEqual(
            [...handled].filter(a => !htmlActions.has(a)),
            [],
            'handlers sem elemento correspondente'
        );
    });

    it('toda navegação aponta para uma tela que existe', () => {
        const screens = new Set([...HTML.matchAll(/data-screen="([^"]+)"/g)].map(m => m[1]));
        const screenIds = new Set([...HTML.matchAll(/id="screen-([^"]+)"/g)].map(m => m[1]));
        assert.deepEqual([...screens].sort(), [...screenIds].sort());
        assert.equal(screens.size, 3);
    });

    it('toda aba de estatística tem seu painel', () => {
        const tabs = [...HTML.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]);
        const panels = new Set([...HTML.matchAll(/id="stat-([^"]+)"/g)].map(m => m[1]));
        assert.ok(tabs.length >= 4);
        for (const tab of tabs) assert.ok(panels.has(tab), `aba ${tab} sem painel #stat-${tab}`);
    });

    it('toda estratégia da tela existe no motor', async () => {
        const strategies = [...HTML.matchAll(/data-strategy="([^"]+)"/g)].map(m => m[1]);
        // A tela e o motor precisam concordar: cada botão aqui tem de existir no
        // `gameGenerator`. `diversified` é a estratégia de carteira espalhada
        // (ver DIVERSIFICACAO.md) — ela também não usa histórico, e é justamente
        // por isso que o teste não pode deixá-la cair num limbo.
        const expected = [
            'wheeling',
            'diversified',
            'maximum_precision',
            'anti_crowd',
            'markov',
            'best_game',
            'adaptive',
            'weighted',
            'hot',
            'cold'
        ];
        assert.deepEqual([...strategies].sort(), [...expected].sort());

        const engine = await read('../js/engine/gameGenerator.js');
        for (const strategy of strategies) {
            assert.ok(engine.includes(`'${strategy}'`), `estratégia ${strategy} não aparece no motor`);
        }
    });

    it('as janelas temporais e os tamanhos de carteira são números válidos', () => {
        const windows = [...HTML.matchAll(/data-window="([^"]+)"/g)].map(m => m[1]);
        assert.deepEqual(windows, ['20', '50', '100', '200', '500', 'full']);
        const counts = [...HTML.matchAll(/data-count="([^"]+)"/g)].map(m => Number(m[1]));
        assert.ok(counts.length >= 2);
        for (const c of counts) assert.ok(Number.isInteger(c) && c > 0, `tamanho de carteira inválido: ${c}`);
    });

    it('as loterias da tela existem na configuração do modelo', () => {
        const types = [...HTML.matchAll(/data-type="([^"]+)"/g)].map(m => m[1]);
        assert.deepEqual([...types].sort(), Object.keys(LotteryModel.CONFIG).sort());
        for (const type of types) {
            assert.ok(LotteryModel.CONFIG[type], `loteria ${type} sem configuração`);
        }
    });
});

describe('Acessibilidade e higiene do markup', () => {
    it('todo label aponta para um id existente', () => {
        const ids = new Set(htmlIds);
        const orphans = [...HTML.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map(m => m[1]).filter(id => !ids.has(id));
        assert.deepEqual(orphans, []);
    });

    it('todo campo de formulário tem id (é como o JS o encontra)', () => {
        const fields = [...HTML.matchAll(/<(input|select|textarea)([^>]*)>/g)];
        assert.ok(fields.length > 10);
        const withoutId = fields.filter(f => !/\sid="/.test(f[2])).map(f => f[0]);
        assert.deepEqual(withoutId, []);
    });

    it('todo botão tem texto visível', () => {
        const buttons = [...HTML.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)];
        assert.ok(buttons.length > 20);
        const empty = buttons.filter(b => {
            const text = b[2].replace(/<[^>]*>/g, '').trim();
            return text === '' && !/aria-label=/.test(b[1]);
        });
        assert.deepEqual(
            empty.map(b => b[0].slice(0, 60)),
            []
        );
    });

    it('todo canvas tem id, para o Chart.js achar o alvo', () => {
        const canvases = [...HTML.matchAll(/<canvas([^>]*)>/g)];
        assert.ok(canvases.length >= 6);
        assert.deepEqual(
            canvases.filter(c => !/\sid="/.test(c[1])).map(c => c[0]),
            []
        );
    });

    it('há um único script de aplicação, e ele é um módulo', () => {
        const scripts = [...HTML.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
        const inline = scripts.filter(s => !/\ssrc=/.test(s[1]) && s[2].trim() !== '');
        assert.deepEqual(
            inline.map(s => s[0]),
            [],
            'markup não deve carregar lógica inline'
        );

        const app = scripts.filter(s => /js\/main\.js/.test(s[1]));
        assert.equal(app.length, 1);
        assert.match(app[0][1], /type="module"/);
    });

    it('nenhum script de terceiro no documento', () => {
        // Antes existia um `<script src="https://cdn.jsdelivr.net/...">` sem
        // `integrity`, dentro do documento e com acesso ao cookie de sessão.
        // Agora toda dependência entra pelo bundle (`package.json`), então o único
        // script é o entrypoint da aplicação — e o CSP pode ser `script-src 'self'`.
        const externos = [...HTML.matchAll(/<script[^>]*src="([^"]+)"/g)]
            .map(m => m[1])
            .filter(url => !url.startsWith('js/'));
        assert.deepEqual(externos, [], `script de terceiro no documento: ${externos.join(', ')}`);

        const scriptsSrc = [...HTML.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
        assert.deepEqual(scriptsSrc, ['js/main.js'], 'só o entrypoint da aplicação pode ser carregado');
    });

    it('nenhum handler inline (onclick, onchange, onsubmit)', () => {
        assert.doesNotMatch(HTML, /\son(click|change|submit|input|load|error)=/i);
    });

    it('o aviso de responsabilidade continua na tela', () => {
        assert.match(HTML, /class="disclaimer"/);
        assert.match(HTML, /jogos de azar/i);
        assert.match(HTML, /moderação/i);
    });
});
