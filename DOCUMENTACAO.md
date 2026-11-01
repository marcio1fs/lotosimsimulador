# A documentação, e como ela é mantida honesta

> Item 6.14 do roadmap de [AUDITORIA_PRECISAO.md](./AUDITORIA_PRECISAO.md).
> Verificado por `tests/docs.test.js`.

---

## 1. O problema

`AUDIT_REPORT.md` afirmava, sem ressalva:

- "**4 suítes passando** (100% de aprovação)";
- "**12 de 12 problemas resolvidos** (100%)";
- "o Modelo Adaptativo apresentou o **melhor alinhamento multifatorial**";
- "**Melhoria Observada**: demonstrada de forma empírica".

Quando a segunda auditoria começou, a suíte tinha 113 testes — e 11 defeitos
adicionais, um deles fabricando resultados de loteria. Uma suíte de 4 casos não
sustentava nenhuma daquelas frases; duas delas, aliás, nunca tiveram medição
por trás.

Um relatório desatualizado é pior que nenhum. Um relatório que **afirma vantagem
inexistente** é pior que os dois, porque dirige decisões.

## 2. O que foi feito

### O `AUDIT_REPORT.md` virou registro histórico datado, não estado atual

O conteúdo original foi preservado — apagá-lo destruiria a evidência de que uma
suíte de 4 casos sustentava afirmações grandes. O que mudou:

- o cabeçalho diz o que o documento é (**v1.1, estado da época**) e qual é o
  estado real hoje;
- a saída TAP de 4 testes está rotulada como **saída da época**, com o comando
  atual logo abaixo;
- o resumo declara explicitamente que **não há vantagem sobre o aleatório**, com
  as medições (item 5);
- as duas frases sem sustentação foram substituídas pelos números medidos:
  sem ponderação **+0,95%** (p = 0,194), com ponderação **−0,98%** (p = 0,799),
  permutação **z = −0,19, p = 0,59**.

### Os números de teste passaram a ter um lugar só

`AUDITORIA_PRECISAO.md` carrega o marcador:

```html
<!-- suite: arquivos=36 testes=574 -->
```

e a **seção 11 (Estado atual)** lista cada item do roadmap com status e onde ele
está documentado. Nenhum outro documento deve repetir contagens absolutas como
se fossem estado presente.

## 3. O mapa dos documentos

| Documento | Assunto | Item |
| :--- | :--- | :--- |
| [AUDITORIA_PRECISAO.md](./AUDITORIA_PRECISAO.md) | auditoria de precisão + roadmap + estado atual | 6.x |
| [AUDIT_REPORT.md](./AUDIT_REPORT.md) | reengenharia original (histórico, v1.1) | — |
| [FREQUENCIAS.md](./FREQUENCIAS.md) | frequências com encolhimento bayesiano | 6.3 |
| [PROJECOES.md](./PROJECOES.md) | projeção do processo (não de dezenas) | módulo extra |
| [INFERENCIA_SEQUENCIAL.md](./INFERENCIA_SEQUENCIAL.md) | p-valores always-valid e orçamento de α | 6.2 |
| [DESEMPENHO_ANALISE.md](./DESEMPENHO_ANALISE.md) | memória e custo da análise | 6.10 |
| [INTERFACE.md](./INTERFACE.md) | templates e testes da camada visual | 6.11 |
| [SECURITY.md](./SECURITY.md) | postura de segurança (borda CSRF em `server/originPolicy.js`, prazo do hash legado em `shared/passwordPolicy.js`) | 6.13, 6.12 |
| [ANTICROWD_CALIBRACAO.md](./ANTICROWD_CALIBRACAO.md) | veredito da calibração do Anti-Crowd: por que não há dado brasileiro, sensibilidade dos priors, pipeline de ingestão | 6.8 |
| [RECUPERACAO_CONTA.md](./RECUPERACAO_CONTA.md) | redefinição de senha e verificação de e-mail: tokens, anti-enumeração, transporte de e-mail, limites | produção |
| [MIGRACOES.md](./MIGRACOES.md) | migrações versionadas do banco, `npm run migrate`, detecção de deriva e `schema.sql` gerado | produção |
| [LIMITES_DE_REQUISICAO.md](./LIMITES_DE_REQUISICAO.md) | limite por rota: chave de IP não forjável, janela fixa, 429 com `Retry-After` | produção |
| [OBSERVABILIDADE.md](./OBSERVABILIDADE.md) | `/api/health` com estado real: banco, migrações e e-mail, com `200`/`503` e códigos estáveis | produção |
| [DOCUMENTACAO.md](./DOCUMENTACAO.md) | este arquivo | 6.14 |

## 4. O que o teste verifica

`tests/docs.test.js` roda em toda execução de `npm test` e checa, de forma
barata:

- **todo link interno resolve** (nenhum documento aponta para arquivo que não existe);
- o **número de arquivos de teste** do marcador bate com `tests/*.test.js`;
- todo documento listado no mapa da seção 3 existe;
- nenhum documento **promete prever dezenas** — a frase só é aceita em negação
  ("não prevê dezenas"), porque é assim que o projeto precisa falar.

E, na CI (`DOCS_VERIFY_SUITE=1`), a verificação cara: **roda a suíte inteira e
compara o total real** com o número do marcador. Localmente esse passo é pulado
para não dobrar o tempo de `npm test`; na CI ele é obrigatório — que é onde a
deriva precisa ser pega.

## 5. Código: lint e formato

Duas ferramentas rodam na CI (job de guardas) e podem ser rodadas localmente:

```bash
npm run lint          # ESLint (recommended + prefer-const, no-var, eqeqeq)
npm run format        # Prettier --write em tudo
npm run format:check  # o que a CI roda: só verifica
```

O que é **deliberadamente** excluído do Prettier está escrito no `.prettierignore`,
com o motivo ao lado: `index.html` (é saída de build — formatá-lo quebraria
`npm run check:html`) e os `.md` (prosa revisada à mão). Código-fonte não se
ignora; `tests/ciLint.test.js` reprova se alguém tentar.

O `package.json` carrega um `overrides` de `minimatch` para 11.0.3: o ESLint
traz `minimatch` 10 transitivamente, e a versão 10 tem um DoS de amplificação de
glob (moderado, só em ferramenta de desenvolvimento). O `npm audit fix` não
resolve — ele propõe *rebaixar* o ESLint para a 4.0.0 —, então o override fixa a
versão corrigida e o lint é exercitado na CI para provar que continua funcionando.

A passada de formatação mora num commit só, registrado em
`.git-blame-ignore-revs`. Para o `git blame` local não apontar para ele:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

(GitHub e GitLab já respeitam o arquivo automaticamente.)

## 6. Como atualizar

Ao adicionar ou remover testes:

```bash
npm test                                   # quantos testes existem agora
# edite o marcador em AUDITORIA_PRECISAO.md (e a seção 11, se for um item novo)
DOCS_VERIFY_SUITE=1 node --test tests/docs.test.js   # confere como a CI fará
```

Se você esquecer, a CI falha dizendo qual número está no documento e qual é o
real. Esse é o ponto: a documentação não pode envelhecer em silêncio.
