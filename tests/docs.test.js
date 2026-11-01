/**
 * Testes da documentação (item 6.14 da auditoria).
 *
 * O relatório anterior afirmava "4 suítes passando" e "melhoria observada"
 * enquanto a suíte tinha 113 testes e nenhum teste de significância sustentava a
 * vantagem. A documentação envelheceu em silêncio — e envelhecer em silêncio, num
 * projeto cujo produto é honestidade estatística, é o pior defeito possível.
 *
 * Este arquivo não verifica prosa: verifica o que pode apodrecer sem ninguém ver.
 *
 *  - todo link interno resolve;
 *  - o marcador `<!-- suite: arquivos=N testes=M -->` bate com a realidade;
 *  - nenhum documento promete prever dezenas;
 *  - o mapa de documentos cobre o que existe na raiz.
 *
 * A conferência do número de TESTES roda a suíte inteira num processo filho — é
 * cara, então só acontece com `DOCS_VERIFY_SUITE=1` (a CI define). Sem isso, o
 * teste avisa e valida apenas a contagem de arquivos, que é barata.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = rel => readFile(new URL(rel, import.meta.url), 'utf8');

/** Documentos na raiz do repositório. */
async function markdownDocs() {
    const entries = await readdir(new URL('..', import.meta.url));
    return entries.filter(name => name.endsWith('.md')).sort();
}

/** Arquivos de teste em `tests/`. */
async function testFiles() {
    const entries = await readdir(new URL('.', import.meta.url));
    return entries.filter(name => name.endsWith('.test.js')).sort();
}

describe('Documentação — links e referências', () => {
    it('todo link interno aponta para um arquivo existente', async () => {
        const docs = await markdownDocs();
        assert.ok(docs.length >= 5, `esperava vários documentos, encontrei ${docs.length}`);

        const broken = [];
        for (const doc of docs) {
            const text = await readFile(new URL(`../${doc}`, import.meta.url), 'utf8');
            for (const match of text.matchAll(/\]\(\.\/([^)#]+)(?:#[^)]*)?\)/g)) {
                const target = match[1];
                try {
                    await readFile(new URL(`../${target}`, import.meta.url), 'utf8');
                } catch {
                    broken.push(`${doc} → ${target}`);
                }
            }
        }
        assert.deepEqual(broken, [], 'documentos apontam para arquivos que não existem');
    });

    it('o mapa de documentos em DOCUMENTACAO.md cobre todos os documentos da raiz', async () => {
        const docs = await markdownDocs();
        const map = await read('../DOCUMENTACAO.md');
        const missing = docs.filter(doc => doc !== 'DOCUMENTACAO.md' && !map.includes(`./${doc}`));
        assert.deepEqual(missing, [], 'documento fora do mapa — inclua-o em DOCUMENTACAO.md');
    });

    it('nenhum documento promete prever dezenas, prêmio ou vantagem', async () => {
        const docs = await markdownDocs();
        // Só as promessas de verdade: "a teoria prevê" e "toda previsão N usa o
        // histórico" são uso legítimo da palavra e não devem ser barradas.
        const promises = [
            /\bprev[êe]m?\s+(as?\s+|os\s+)?(dezenas|n[úu]meros|resultados?|sorteios?)\b/gi,
            /\bgarante\s+(o\s+)?(pr[êe]mio|acerto|resultado|vit[óo]ria)/gi,
            /\baumenta\s+(a\s+)?(chance|probabilidade)\s+de\s+(ganhar|acertar)/gi
        ];
        const offenders = [];

        for (const doc of docs) {
            const text = await readFile(new URL(`../${doc}`, import.meta.url), 'utf8');
            for (const pattern of promises) {
                for (const match of text.matchAll(pattern)) {
                    const before = text.slice(Math.max(0, match.index - 45), match.index).toLowerCase();
                    const negated = /n[ãa]o |nunca|jamais|imposs[íi]vel|sem |nenhum/.test(before);
                    if (!negated) {
                        offenders.push(
                            `${doc}: …${text.slice(Math.max(0, match.index - 30), match.index + 30).trim()}…`
                        );
                    }
                }
            }
        }
        assert.deepEqual(offenders, [], 'promessa de previsão sem negação explícita');
    });
});

describe('Documentação — números da suíte', () => {
    it('o marcador existe e a contagem de arquivos bate', async () => {
        const audit = await read('../AUDITORIA_PRECISAO.md');
        const marker = audit.match(/<!--\s*suite:\s*arquivos=(\d+)\s+testes=(\d+)\s*-->/);
        assert.ok(marker, 'marcador <!-- suite: arquivos=N testes=M --> não encontrado em AUDITORIA_PRECISAO.md');

        const declaredFiles = Number(marker[1]);
        const actualFiles = (await testFiles()).length;
        assert.equal(
            declaredFiles,
            actualFiles,
            `AUDITORIA_PRECISAO.md declara ${declaredFiles} arquivos; existem ${actualFiles}. ` + 'Atualize o marcador.'
        );
        assert.ok(Number(marker[2]) > 0, 'o marcador precisa declarar a quantidade de testes');
    });

    it('o número de testes do marcador é o número real', async t => {
        if (process.env.DOCS_VERIFY_SUITE !== '1') {
            t.diagnostic('verificação completa pulada; rode com DOCS_VERIFY_SUITE=1 (a CI faz isso)');
            return;
        }

        const audit = await read('../AUDITORIA_PRECISAO.md');
        const marker = audit.match(/<!--\s*suite:\s*arquivos=(\d+)\s+testes=(\d+)\s*-->/);
        const declared = Number(marker[2]);

        // Roda a suíte sem este arquivo (para não recursar) e soma os casos daqui.
        const files = (await testFiles()).filter(name => name !== 'docs.test.js');
        // `NODE_TEST_CONTEXT` vaza para o filho e faria o runner falar o
        // protocolo interno em vez de TAP — daí a remoção explícita.
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files.map(f => `tests/${f}`)], {
            cwd: ROOT,
            encoding: 'utf8',
            timeout: 300000,
            env
        });
        assert.equal(run.status, 0, `a suíte falhou ao ser executada pela checagem:\n${run.stdout}\n${run.stderr}`);

        const reported = run.stdout.match(/# tests (\d+)/);
        assert.ok(reported, 'não foi possível ler a contagem de testes da suíte');

        const ownSource = await read('../tests/docs.test.js');
        const ownCount = (ownSource.match(/^\s*it\(/gm) || []).length;
        const actual = Number(reported[1]) + ownCount;

        assert.equal(
            declared,
            actual,
            `AUDITORIA_PRECISAO.md declara ${declared} testes; a suíte tem ${actual}. ` +
                'Atualize o marcador e a seção 11.'
        );
    });

    it('o AUDIT_REPORT.md não apresenta números de teste antigos como estado atual', async () => {
        const report = await read('../AUDIT_REPORT.md');
        assert.match(report, /documento hist[óo]rico/i, 'o relatório precisa se declarar histórico');
        // A saída TAP de 4 casos pode ficar como registro, mas rotulada.
        assert.match(report, /sa[íi]da da [ée]poca/i);
        assert.doesNotMatch(
            report,
            /\|\s*\*\*Testes Automatizados\*\*\s*\|\s*4 su[íi]tes passando \(100% de aprova[çc][ãa]o\)\s*\|/i,
            'a tabela de resumo não pode apresentar 4 suítes como estado atual'
        );
    });

    it('o AUDIT_REPORT.md não afirma vantagem sobre o aleatório', async () => {
        const report = await read('../AUDIT_REPORT.md');
        // A frase original pode aparecer — mas só entre aspas, como registro do
        // que o relatório afirmava. Citada como afirmação própria, é reprovada.
        const ownClaims = report
            .split('\n')
            .filter(line => !line.trimStart().startsWith('>'))
            .join('\n');
        assert.doesNotMatch(ownClaims, /\*\*Melhoria Observada\*\*:\s*Demonstrada/i);
        assert.match(
            report,
            /n[ãa]o h[áa] evid[êe]ncia de vantagem|resultado cient[íi]fico honesto|n[ãa]o se sustentaram/i
        );
    });
});
