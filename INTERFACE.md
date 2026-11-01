# A camada visual, agora verificável

> Item 6.11 do roadmap de [AUDITORIA_PRECISAO.md](./AUDITORIA_PRECISAO.md).
> Implementado em `js/views/templates/` + `scripts/build-html.mjs`, com 20 testes
> (`tests/uiTemplates.test.js`).

---

## 1. O que havia

`index.html` era um arquivo de **34 KB e 555 linhas** contendo, em sequência:
cabeçalho, tela de login/registro, overlay de carregamento, casca do app, as três
telas (simulação, conferência, estatísticas) e três modais.

Uma correção ao diagnóstico original da auditoria: o arquivo **não** tinha lógica
de apresentação embutida no sentido literal — zero `onclick`, zero `<script>`
inline, um único módulo (`js/main.js`) no fim do documento. O problema era outro,
e maior: **116 ids** num único blob, sem nenhuma forma de testar se eles existem,
se estão duplicados ou se o JS ainda encontra o que procura. 44 botões, 6 canvas e
17 campos, todos sem cobertura alguma.

Um teste de "o botão ainda existe" era impossível: não há como importar um
`index.html` em Node.

## 2. O que mudou

O markup foi dividido em **9 módulos puros**, um por seção:

| Módulo | Seção |
|---|---|
| `documentHead.js` | metas, ícone, manifest, fontes e CSS (nenhum script) |
| `authScreen.js` | login e criação de conta |
| `loadingOverlay.js` | overlay de carregamento |
| `appHeader.js` | `<header>`, navegação e abertura do `<main>` |
| `simulationScreen.js` | seletor de loteria, agente, janela, estratégias, filtros |
| `conferenceScreen.js` | último resultado e conferidor |
| `statisticsScreen.js` | abas, gráficos, relatório, benchmark, ranking |
| `modals.js` | perfil, automação, banco de dados |
| `scripts.js` | entrypoint ESM e fechamento |

`js/views/templates/document.js` monta o documento a partir deles, e
`scripts/build-html.mjs` grava o `index.html`.

**O `index.html` virou saída de build.** Ele é gerado — editar à mão é inútil, e o
teste falha apontando para os templates. O conteúdo produzido é **byte a byte
idêntico** ao arquivo anterior à divisão: a refatoração não mudou uma vírgula do
que o navegador recebe.

```bash
npm run build       # gera o HTML e roda o Vite
npm run check:html  # só verifica se o versionado está em dia
```

## 3. O que os testes passaram a garantir

Antes: nada. Agora, 20 verificações, das quais estas não existiam em lugar algum:

- **o `index.html` versionado é exatamente o que os templates geram** (a deriva
  entre fonte e saída é o modo mais silencioso de perder uma tela inteira);
- **todo id procurado pelo JS existe no documento** — 89 referências cruzadas
  contra os 116 ids, com uma única exceção justificada: `printNowBtn` pertence à
  janela de impressão criada em runtime (`win.document`), não ao app;
- **todo `data-action` tem handler, e nenhum handler ficou órfão** — as duas
  direções, para pegar tanto o botão que não faz nada quanto o código morto;
- **toda navegação, aba e estratégia aponta para algo que existe** — `data-screen`
  ↔ `id="screen-*"`, `data-tab` ↔ `id="stat-*"`, e as 9 estratégias contra o
  despacho do motor;
- **as loterias da tela batem com `LotteryModel.CONFIG`** — se uma modalidade for
  removida do modelo e esquecida no markup, o teste acusa;
- **acessibilidade mínima**: todo `<label for>` aponta para id existente, todo
  campo tem id, todo botão tem texto visível, todo canvas tem id;
- **higiene de markup**: nenhum `onclick` inline, um único script de aplicação
  (um módulo) e **nenhum script de terceiro** no documento.

## 4. O que NÃO mudou (e por quê)

O app continua servindo o mesmo HTML estático. Eu **não** troquei para renderização
em runtime (montar o DOM no JS), que seria a versão "mais moderna" da mesma ideia:
a tela ficaria em branco até o módulo executar, e sem JavaScript não sobraria nada —
inclusive o aviso de responsabilidade. Para uma ferramenta que existe justamente
para dizer "isto não prevê o futuro", conteúdo legal que só aparece com JS ligado
é um risco desnecessário.

Também não entrou framework nem biblioteca de teste de DOM: o projeto não tem
dependências de front, e o valor aqui vem de verificar invariantes do markup, não
de simular cliques.

## 4.1 Script de terceiro: saiu o CDN, entrou o bundle

O `index.html` carregava o Chart.js assim:

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
```

Sem `integrity`, dentro do documento, com o CSP liberando `script-src https://cdn.jsdelivr.net`
inteiro. Duas consequências ruins: qualquer comprometimento do CDN (ou do pacote)
executaria código **na origem do app**, com acesso ao cookie de sessão; e liberar o CDN
todo permite qualquer arquivo dele, não só aquele.

Agora o Chart.js é dependência normal (`package.json`) e entra pelo bundle, com **import
dinâmico** na tela de estatísticas:

```js
chartLibPromise = import('chart.js/auto').then(mod => mod.default ?? mod.Chart);
```

O build separa um chunk (`assets/auto-*.js`, ~199 KB / 68 KB gzip) que só é baixado
quando um gráfico é pedido. O carregamento inicial continua com ~233 KB, igual a antes.

Resultado no CSP (`vercel.json`):

```
script-src 'self'          (antes: 'self' https://cdn.jsdelivr.net)
worker-src 'self' blob:    (o worker do motor é asset próprio, servido de /assets)
```

`tests/csp.test.js` (8 casos) trava isso: `script-src` só com `'self'`, sem
`'unsafe-inline'`/`'unsafe-eval'`, sem host externo em `script-src`/`worker-src`/`object-src`,
`connect-src` sem curinga, `frame-ancestors 'none'`, e o `index.html` sem script inline.
Quem colar o CDN de volta vê a CI vermelha com a explicação no nome do teste.

**Dependência externa restante:** o Google Fonts (`fonts.googleapis.com` para o CSS e
`fonts.gstatic.com` para os arquivos). Não executa JavaScript — o risco é outro (rastreio e
disponibilidade). Auto-hospedar as duas famílias é o próximo passo natural e encolheria o
CSP de novo, mas não estava no escopo deste item.

## 5. Como adicionar uma seção

1. Crie `js/views/templates/minhaTela.js` exportando uma função que devolve string.
2. Registre-a em `DOCUMENT_SECTIONS` (`document.js`) na posição desejada.
3. Rode `npm run build:html` e depois `npm test`.

Se a seção introduzir ids novos, o teste de referências cruzadas já verifica que
eles existem. Se introduzir um `data-action`, o teste exige o handler em
`js/main.js`.
