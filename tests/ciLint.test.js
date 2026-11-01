/**
 * Testes da fiação de lint e formatação (item 6.9 da auditoria).
 *
 * O item 6.9 pedia ESLint no CI. Um linter que existe mas não roda em lugar
 * nenhum é decoração — e uma configuração que cobre `js/` mas esquece `server/`
 * dá a mesma sensação falsa de proteção que um teste que passa por não testar
 * nada. Este arquivo não roda o ESLint (a CI roda, e rodar de novo aqui só
 * dobraria o tempo): ele verifica que a fiação continua ligada.
 *
 *  - os scripts existem e chamam as ferramentas certas;
 *  - o workflow executa os scripts;
 *  - todo diretório com código-fonte está coberto pelo ESLint;
 *  - o `.prettierignore` não exclui código-fonte por conveniência;
 *  - o Prettier continua sendo a única fonte de formato (sem config duplicada).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';

const read = rel => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');

/** Diretórios de código-fonte na raiz (o que deve passar pelo linter). */
const SOURCE_DIRS = ['js', 'server', 'api', 'shared', 'scripts', 'tests'];

const isDirectory = async rel => {
    try {
        return (await stat(new URL(`../${rel}`, import.meta.url))).isDirectory();
    } catch {
        return false;
    }
};

describe('Lint e formatação — fiação', () => {
    it('o package.json tem os scripts de lint e de formato', async () => {
        const pkg = JSON.parse(await read('package.json'));
        const scripts = pkg.scripts || {};
        assert.match(scripts.lint || '', /\beslint\b/, 'falta o script `lint` chamando o ESLint');
        assert.match(scripts['format:check'] || '', /prettier\s+--check/, 'falta `format:check` com prettier --check');
        assert.match(scripts.format || '', /prettier\s+--write/, 'falta `format` com prettier --write');
        assert.ok(scripts.test, 'o script de teste continua obrigatório');
    });

    it('ESLint, Prettier e globals estão nas dependências de desenvolvimento', async () => {
        const pkg = JSON.parse(await read('package.json'));
        const dev = pkg.devDependencies || {};
        // Não podem chegar em `dependencies`: são ferramentas, não runtime.
        for (const name of ['eslint', '@eslint/js', 'prettier', 'globals']) {
            assert.ok(dev[name], `${name} precisa estar em devDependencies`);
            assert.equal((pkg.dependencies || {})[name], undefined, `${name} não pertence a dependencies`);
        }
    });

    it('a CI executa o lint e o check de formatação', async () => {
        const workflow = await read('.github/workflows/ci.yml');
        assert.match(workflow, /npm run lint\b/, 'o workflow não roda `npm run lint`');
        assert.match(workflow, /npm run format:check\b/, 'o workflow não roda `npm run format:check`');
        // Roda depois de instalar as dependências: sem `npm ci`, o eslint não existe.
        assert.ok(
            workflow.indexOf('npm ci') < workflow.indexOf('npm run lint'),
            'o lint precisa rodar depois de `npm ci`'
        );
    });

    it('todo diretório com código-fonte está coberto pelo ESLint', async () => {
        const config = await read('eslint.config.js');
        for (const dir of SOURCE_DIRS) {
            if (!(await isDirectory(dir))) continue;
            assert.ok(config.includes(`${dir}/**`), `eslint.config.js não cobre ${dir}/ — código sem linter`);
        }

        // Arquivos .js na raiz (vite.config.js, eslint.config.js) também contam.
        const rootEntries = await readdir(new URL('../', import.meta.url));
        for (const file of rootEntries.filter(name => name.endsWith('.js'))) {
            assert.ok(config.includes('*.js'), `${file} na raiz ficaria fora do lint`);
        }
    });

    it('o ESLint ignora artefatos, não código', async () => {
        const config = await read('eslint.config.js');
        const block = config.match(/ignores:\s*\[([\s\S]*?)\]/);
        assert.ok(block, 'eslint.config.js deveria declarar uma lista de `ignores`');

        const ignored = [...block[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
        assert.ok(ignored.length > 0, 'a lista de `ignores` está vazia');
        for (const artifact of ['dist/**', 'node_modules/**']) {
            assert.ok(ignored.includes(artifact), `o ESLint deveria ignorar ${artifact}`);
        }
        for (const dir of SOURCE_DIRS) {
            assert.ok(
                !ignored.some(pattern => pattern.startsWith(`${dir}/`)),
                `o ESLint está ignorando ${dir}/ — código-fonte não se ignora`
            );
        }
    });

    it('o .prettierignore exclui saída de build e prosa, não código', async () => {
        const ignore = await read('.prettierignore');
        const lines = ignore
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));

        for (const artifact of ['dist/', 'node_modules/', 'index.html']) {
            assert.ok(lines.includes(artifact), `.prettierignore precisa excluir ${artifact}`);
        }
        for (const dir of SOURCE_DIRS) {
            assert.ok(
                !lines.some(line => line === `${dir}/` || line === `${dir}`),
                `.prettierignore está excluindo código-fonte (${dir}/)`
            );
        }
    });

    it('não existe config duplicada de ESLint ou Prettier', async () => {
        const entries = await readdir(new URL('../', import.meta.url));
        const eslintConfigs = entries.filter(name => /^\.eslintrc|^eslint\.config\./.test(name));
        const prettierConfigs = entries.filter(name => /^\.prettierrc|^prettier\.config\./.test(name));
        assert.deepEqual(eslintConfigs, ['eslint.config.js'], `configs de ESLint ambíguas: ${eslintConfigs}`);
        assert.deepEqual(prettierConfigs, ['.prettierrc.json'], `configs de Prettier ambíguas: ${prettierConfigs}`);
    });
});

describe('Dependabot — configuração versionada', () => {
    /** Linhas de um bloco YAML: a chave e tudo que estiver mais indentado que ela. */
    const blocoDe = (texto, chave) => {
        const linhas = texto.split('\n');
        const inicio = linhas.findIndex(linha => linha.trim().startsWith(`${chave}:`));
        assert.notEqual(inicio, -1, `falta a chave \`${chave}\` no dependabot.yml`);
        const indentacao = linhas[inicio].search(/\S/);
        const bloco = [];
        for (let i = inicio + 1; i < linhas.length; i++) {
            const linha = linhas[i];
            if (linha.trim() === '') continue;
            if (linha.search(/\S/) <= indentacao) break;
            // `- minor` vira `minor`: o teste olha o valor, não o marcador de lista.
            bloco.push(linha.trim().replace(/^-\s+/, ''));
        }
        return bloco;
    };

    /** Blocos `- package-ecosystem: X`, com as linhas de cada um (sem o marcador de lista). */
    const ecossistemas = texto => {
        const blocos = [];
        let atual = null;
        for (const linha of texto.split('\n')) {
            const inicio = /^\s*-\s*package-ecosystem:\s*(\S+)/.exec(linha);
            if (inicio) {
                atual = { nome: inicio[1], linhas: [] };
                blocos.push(atual);
                continue;
            }
            if (atual) atual.linhas.push(linha.trim().replace(/^-\s+/, ''));
        }
        return blocos;
    };

    it('existe, é versionado e cobre npm na raiz com janela semanal', async () => {
        const config = await read('.github/dependabot.yml');
        assert.match(config, /^version:\s*2\s*$/m, 'o dependabot.yml precisa declarar version: 2');
        assert.match(config, /package-ecosystem:\s*npm\s*$|package-ecosystem:\s*"npm"/m, 'falta o ecossistema npm');
        // Prettier escreve `directory: '/'` com aspas simples; aceite as duas formas.
        assert.match(config, /directory:\s*['"]?\/['"]?\s*$/m, 'o manifest é o da raiz');
        assert.match(config, /interval:\s*weekly\s*$/m, 'a janela combinada é semanal');

        // Config viva nas settings do GitHub não é revisável — foi assim que o PR
        // do `ws` envelheceu cinco meses sem ninguém notar que o alvo sumira.
        assert.match(
            config,
            /open-pull-requests-limit:\s*\d+/m,
            'falta o equilíbrio entre manter em dia e não inundar de PRs'
        );
    });

    it('major fica fora do grupo de minor/patch (bump de major é PR próprio)', async () => {
        const config = await read('.github/dependabot.yml');
        const grupo = blocoDe(config, 'minor-e-patch');
        assert.ok(grupo.includes('minor') && grupo.includes('patch'), 'o grupo precisa cobrir minor e patch');
        assert.ok(!grupo.includes('major'), 'major não pode entrar no grupo: precisa de leitura própria');
        assert.ok(
            grupo.some(linha => linha.startsWith('applies-to: version-updates')),
            'o grupo é de atualização de versão, não de segurança'
        );
    });

    it('atualização de segurança tem grupo próprio e não espera a janela semanal', async () => {
        const config = await read('.github/dependabot.yml');
        const grupo = blocoDe(config, 'seguranca');
        assert.ok(
            grupo.some(linha => linha.startsWith('applies-to: security-updates')),
            'sem `security-updates`, a correção de vulnerabilidade entra na fila semanal'
        );
        // Cooldown é para adoção de versão nova, não para corrigir falha conhecida.
        const cooldown = blocoDe(config, 'cooldown');
        assert.ok(
            cooldown.length > 0,
            'o cooldown contra versão recém-publicada (supply chain) precisa estar declarado'
        );
    });

    it('cobre também as GitHub Actions, com major em PR separado', async () => {
        const config = await read('.github/dependabot.yml');
        const bloco = ecossistemas(config).find(item => item.nome === 'github-actions');
        assert.ok(bloco, 'falta o bloco `package-ecosystem: github-actions`');

        const linhas = bloco.linhas;
        assert.ok(linhas.includes("directory: '/'"), 'as actions vivem em .github/workflows (raiz)');
        assert.ok(linhas.includes('interval: weekly'), 'a janela acompanha a do npm');

        // Mesma regra do npm: `v4` recebe correção sozinho, `v5` muda runtime e
        // precisa de leitura — por isso major fica fora do grupo.
        assert.ok(linhas.includes('minor') && linhas.includes('patch'), 'o grupo cobre minor e patch');
        assert.ok(!linhas.includes('major'), 'major de action não pode entrar no grupo');
        assert.ok(
            linhas.some(linha => linha.startsWith('applies-to: version-updates')),
            'o grupo é de atualização de versão'
        );
    });
});
