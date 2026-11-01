/**
 * ESLint (flat config — ESLint 10).
 *
 * Item 6.9 da auditoria. A regra que guiou esta configuração: **pegar o que um
 * teste não pega**. A suíte de 436 testes cobre o comportamento; o que ficava
 * invisível era o código morto — variável que ninguém lê, import que sobrou de
 * um refactor, atribuição que o ramo seguinte sobrescreve, número literal com
 * mais dígitos do que um double guarda. Na primeira execução foram 36 desses,
 * todos reais (ver AUDITORIA_PRECISAO.md, seção 6.9).
 *
 * Deliberadamente **não** há regra de estilo aqui: formato é trabalho do
 * Prettier (`.prettierrc.json`). Linter e formatador com opinião sobre a mesma
 * coisa é como dois relógios: um dos dois vai estar errado.
 */

import js from '@eslint/js';
import globals from 'globals';

export default [
    {
        // Artefatos, não código. `dist/` é saída do Vite: lintar bundle minificado
        // produz milhares de avisos sem sentido.
        ignores: ['dist/**', 'node_modules/**', 'coverage/**']
    },

    js.configs.recommended,

    {
        // Código de navegador: `document`, `fetch`, `crypto.subtle`, IndexedDB.
        // `worker` cobre js/workers/engineWorker.js (roda em Worker).
        files: ['js/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.worker,
                // Vem de <script> externo (cdn.jsdelivr.net, liberado na CSP do
                // vercel.json). Não é bundle, então o linter não a vê.
                Chart: 'readonly',
                // Fallback de `btoa` no modo offline (js/models/user.js): quando
                // btoa não existe, o caminho roda sob Node, onde Buffer existe.
                Buffer: 'readonly'
            }
        }
    },

    {
        // Servidor, funções serverless, scripts e testes: Node.
        files: [
            'server/**/*.js',
            'api/**/*.js',
            'shared/**/*.js',
            'scripts/**/*.mjs',
            'tests/**/*.js',
            'tests/**/*.mjs',
            '*.js',
            '*.mjs'
        ],
        languageOptions: { globals: { ...globals.node } }
    },

    {
        rules: {
            'no-var': 'error',
            // Pegou 5 arrays mutados por push declarados com let em backtestEngine.
            'prefer-const': 'error',
            // `== null` é aceito de propósito: cobre null e undefined de uma vez.
            eqeqeq: ['error', 'smart'],
            'no-unused-vars': [
                'error',
                {
                    args: 'after-used',
                    // Convenção já usada no projeto: `_` marca o que existe por
                    // posição (destructuring para omitir campo, callback com
                    // parâmetro que não interessa).
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrors: 'none',
                    // `const { password: _ignored, ...resto }` é idiomático.
                    ignoreRestSiblings: true
                }
            ],
            // Catch vazio é escolha explícita em vários fallbacks (JSON.parse de
            // dado legado, localStorage indisponível). Bloco vazio fora de catch
            // continua sendo erro.
            'no-empty': ['error', { allowEmptyCatch: true }]
        }
    }
];
