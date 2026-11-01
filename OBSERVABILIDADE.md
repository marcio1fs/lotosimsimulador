# Observabilidade: o que o `/api/health` responde (e o que ele não é)

Item 5 da lista de "o que falta para produção pública". Os itens 1–4 (recuperação de conta,
Chart.js fora do CDN, migrações versionadas, limite por rota) estão em
[RECUPERACAO_CONTA.md](./RECUPERACAO_CONTA.md), [INTERFACE.md](./INTERFACE.md),
[MIGRACOES.md](./MIGRACOES.md) e [LIMITES_DE_REQUISICAO.md](./LIMITES_DE_REQUISICAO.md).

---

## 1. O problema

A rota era uma linha:

```js
await getSql().query('SELECT 1');
return send(res, 200, { ok: true });
```

Ela provava que o banco respondia `SELECT 1`. Nada além disso. Três coisas ficavam
invisíveis, e a terceira foi real neste projeto:

1. **Banco fora virava `500 {"error":"Erro interno do servidor"}`** — o mesmo corpo de
   qualquer bug no handler. Quem monitorava não sabia se o problema era banco, código,
   `DATABASE_URL` ausente ou uma consulta ruim.
2. **Migração pendente era invisível.** O app subia, o `/api/health` dizia `ok`, e a
   primeira escrita numa tabela nova falhava em produção — sem que nada apontasse para a
   migração que faltou.
3. **E-mail não configurado era invisível.** Recuperação de senha e verificação de e-mail
   respondem `503` ao usuário final; nada no servidor dizia por quê.

O caso 2 aconteceu de verdade: a migração `003` (tabela `rate_limits`) é uma **falha
aberta** por desenho — sem a tabela, o limite por rota é pulado com um `warn` no log. Um
banco sem `003` teria o app funcionando normalmente **com o limite desligado**, e o health
continuaria dizendo `ok`. Uma falha aberta sem sinal é um limite que não existe.

---

## 2. O que a rota responde

```jsonc
{
  "ok": true,                                  // "dá para servir"
  "status": "degraded",                        // ok | degraded | down
  "checkedAt": "2026-11-01T22:40:00.000Z",
  "durationMs": 41,
  "expectedMigrations": 3,
  "commit": "4092478",                         // só quando a Vercel informa
  "environment": "preview",                    // idem
  "checks": [
    { "id": "database", "status": "ok", "durationMs": 38, "detail": "consulta de verificação respondeu" },
    {
      "id": "migrations",
      "status": "fail",
      "code": "migrations_pending",
      "detail": "banco e código divergem: 1 pendente(s). Rode `npm run migrate:status` para o detalhe.",
      "pending": ["003_limite_de_requisicoes"],
      "drifted": [],
      "orphan": []
    },
    {
      "id": "email",
      "status": "warn",
      "code": "email_not_configured",
      "detail": "sem EMAIL_API_KEY: recuperação de senha e verificação de e-mail respondem 503"
    }
  ]
}
```

| campo | significa |
| :--- | :--- |
| `ok` | **dá para servir**? É o campo que o cliente usa (`js/db/database.js`) para escolher entre API e IndexedDB local. |
| `status` | `ok` (tudo verde), `degraded` (serve, com capacidade a menos), `down` (não serve). |
| `checks[].status` | `ok` · `warn` · `fail` · `unknown`. `unknown` é honesto: não deu para verificar. |
| `checks[].code` | Código estável, para alerta automático. A lista está na seção 5. |
| `checkedAt` / `durationMs` | Quando e em quanto tempo **esta** resposta foi medida. Nada de média histórica inventada. |
| `commit` / `environment` | Identificam o deploy quando a plataforma expõe `VERCEL_GIT_COMMIT_SHA` / `VERCEL_ENV`. Ausentes fora da Vercel. |

---

## 3. Código HTTP: por que `degraded` continua `200`

| `status` | HTTP | efeito |
| :--- | :--- | :--- |
| `ok` | **200** | nada a fazer |
| `degraded` | **200** | serve; falta e-mail ou migração. **Alerta tem que olhar o corpo.** |
| `down` | **503** | banco inacessível ou não configurado |

A escolha não é cosmética. `503` derruba o monitor **e** faz o cliente cair para o banco
local (`js/db/database.js` só usa a API quando `res.ok && data.ok`). Se um e-mail não
configurado — que é o estado normal de um ambiente de desenvolvimento — devolvesse `503`,
o app trocaria de banco de dados em silêncio e o usuário acharia que perdeu os dados.
Trocar um aviso por um incidente é o oposto de observabilidade.

O custo dessa escolha é declarado: **um monitor que olha só o código HTTP não vê
`degraded`**. Quem quiser ser avisado de migração pendente precisa ler `status` (ou
`checks[*].status`) no corpo. A seção 7 mostra como.

---

## 4. As verificações

### 4.1 Banco

`SELECT 1` com prazo de **3 s** (`HEALTH_DB_TIMEOUT_MS`). O prazo existe porque um banco que
aceita a conexão e não responde deixaria o health pendurado até o timeout da plataforma —
e monitor sem resposta é pior que monitor recebendo `503` em três segundos.

O prazo é **abandono, não cancelamento**: a consulta segue no servidor do Neon até
terminar, o processo só para de esperar. `Promise.race` é o mecanismo, e ele já registra
handler na promessa original, então uma rejeição que chegue depois do prazo não vira
unhandled rejection. O timer **não** é `unref()`: se o prazo fosse o único trabalho
pendente, um timer "solto" nunca dispararia — exatamente o que ele existe para evitar.

Sem `DATABASE_URL`, a verificação nem tenta: devolve `db_not_configured`. Antes, esse caso
subia como `HttpError` e virava `500` genérico.

### 4.2 Migrações

Compara o que o **banco** diz estar aplicado (`schema_migrations`) com o que o **código**
espera (`server/migrationsManifest.js`), em três eixos:

| eixo | significado | consequência |
| :--- | :--- | :--- |
| **pendente** | arquivo existe no código, registro não existe no banco | falta `npm run migrate` |
| **divergente** | aplicado, mas o checksum mudou | o arquivo foi editado depois de aplicado; o banco não é o que o código descreve |
| **órfã** | banco tem registro que o código não tem | arquivo removido/renomeado: o schema real não tem dono |

Essa verificação **nunca lança**: qualquer falha vira `unknown` com código próprio. Um
health que estoura por não conseguir ler o próprio controle de migrações é pior que um
health que admite não saber.

Se o banco já falhou, a leitura de migrações **não é tentada** — perguntar duas vezes a um
banco que não responde só gasta o prazo de quem está monitorando.

### 4.3 E-mail

Só **configuração**, não rede: testar o provedor a cada healthcheck transformaria o health
em dependência de terceiro (e um provedor lento derrubaria o monitor do app inteiro).

| transporte | `status` | código |
| :--- | :--- | :--- |
| `resend` (`EMAIL_API_KEY` definida) | `ok` | — |
| `console` (fora de produção) | `warn` | `email_console_transport` |
| `none` | `warn` | `email_not_configured` |

---

## 5. O manifesto de migrações

`server/migrationsManifest.js` é **gerado** a partir de `migrations/*.sql`:

```bash
npm run build:manifest   # grava server/migrationsManifest.js
npm run check:manifest   # não grava; sai com 1 se divergir (a CI roda)
```

Por que não ler `migrations/` do disco durante a requisição: na Vercel a função é
empacotada a partir das **importações**. Arquivo `.sql` não é importação, então ele pode
simplesmente não viajar junto com o bundle — `readdir` num caminho relativo ao source
funciona por sorte, não por contrato. A lista vira JavaScript importável, portanto
empacotada junto com o handler.

O manifesto leva os **checksums**, então editar uma migração já aplicada também aparece no
health — não só adicionar uma nova. Um teste (`tests/health.test.js`) compara o manifesto
com `loadMigrations()`, então esquecer `npm run build:manifest` quebra a suíte mesmo para
quem não roda `check:manifest`.

---

## 6. O que sai e o que não sai

A rota **não é autenticada** — é isso que permite usá-la como healthcheck. Por isso a
resposta não pode ser um despejo de diagnóstico:

- **não sai** mensagem de erro crua (mensagem de driver costuma trazer host, porta e às
  vezes a URL de conexão), nome de variável secreta, `DATABASE_URL`, chave de API, e-mail
  de usuário ou token;
- **sai** um código estável e um texto que já está nesta documentação. O erro completo vai
  para o log do servidor (`console.error`), onde quem opera pode ver — e onde ninguém de
  fora alcança.

Códigos possíveis:

| código | onde | significa |
| :--- | :--- | :--- |
| `db_not_configured` | database | falta `DATABASE_URL` |
| `db_unreachable` | database | o banco recusou ou não completou a consulta |
| `db_timeout` | database | não respondeu dentro do prazo |
| `migrations_not_checked` | migrations | banco fora: não deu para ler o controle |
| `migrations_table_missing` | migrations | banco sem `schema_migrations` (criado à mão ou nunca migrado) |
| `migrations_timeout` | migrations | o controle não respondeu dentro do prazo |
| `migrations_unreadable` | migrations | erro de leitura |
| `migrations_pending` | migrations | falta aplicar migração |
| `migrations_drifted` | migrations | migração aplicada foi editada |
| `migrations_orphan` | migrations | registro no banco sem arquivo no código |
| `email_not_configured` | email | sem `EMAIL_API_KEY` |
| `email_console_transport` | email | transporte que imprime no log em vez de enviar |

---

## 7. Como usar

```bash
# veredito legível
curl -s https://seu-dominio/api/health | jq '{status, checks: [.checks[] | {id, status, code}]}'

# falha o script se o serviço não estiver servindo (down = 503)
curl -fsS https://seu-dominio/api/health > /dev/null

# alerta que também pega degradação (o que o código HTTP sozinho não pega)
curl -s https://seu-dominio/api/health | jq -e '.status == "ok"' > /dev/null
```

- **Monitor externo (uptime):** use `200` como "de pé" e `503` como "fora". É o que dá para
  pedir de um monitor que só olha status.
- **Alerta de configuração/schema:** use o corpo. `.status == "ok"` é a condição que pega
  migração pendente e e-mail ausente.
- **Após deploy:** uma chamada no fim do pipeline confirma que a migração foi aplicada —
  antes, isso só aparecia quando alguém usava a função que dependia da tabela nova.

A rota tem limite de **600 requisições por minuto por IP** (mesmo balde do limite por rota,
ver [LIMITES_DE_REQUISICAO.md](./LIMITES_DE_REQUISICAO.md)): monitor a cada 30 s custa 2
requisições por minuto, então o teto só incomoda quem abusa.

---

## 8. O que ele **não** é

- **Não é `/metrics`.** Não há contadores, histogramas nem exportador Prometheus. Também
  não é tracing distribuído, nem agregador de log.
- **Não guarda histórico.** Cada resposta descreve o instante da chamada. "Está pior que
  ontem?" é pergunta para um serviço de monitoração, não para esta rota.
- **Não alerta.** Quem compara e avisa é o monitor externo (seção 7).
- **Não mede desempenho de verdade.** `durationMs` é o tempo da verificação, não latência
  p95 de tráfego real.
- **Não testa o envio de e-mail.** Verifica configuração; se a chave estiver revogada, o
  health não sabe.
- **Não prova que o app funciona.** Banco respondendo, migração aplicada e e-mail
  configurado não impedem um bug de lógica — isso é o que os 578 testes cobrem.

---

## 9. Testes

`tests/health.test.js` — **33 casos**:

- banco: resposta ok com duração, recusa (`db_unreachable`), sem configuração
  (`db_not_configured`), demora (`db_timeout`), rejeição tardia que não vaza;
- migrações: tudo aplicado, pendente, divergente, órfã, tabela ausente, erro de leitura,
  timeout, e a conferência do manifesto contra `loadMigrations()`;
- e-mail: `resend`, nada configurado, `console`, `console` recusado em produção;
- veredito: `ok`/`degraded`/`down` e a conversão para `200`/`503`;
- relatório: as três verificações juntas, **nenhum segredo no JSON**, `commit`/`environment`
  só quando existem, migração não consultada quando o banco está fora, `checkedAt` com
  relógio injetado;
- pela rota: `200` com `ok:true` e `Cache-Control: no-store`, sem exigir sessão, `503` (não
  `500`) com banco fora, `503` quando falta `DATABASE_URL`, duplo que não conhece
  `schema_migrations` degradando em vez de derrubar, e o contador do limite por rota
  funcionando.

---

## 10. Limitações honestas

1. **Não há Postgres neste ambiente.** Toda a lógica roda contra duplos. O `SELECT 1`, o
   `SELECT id, checksum FROM schema_migrations` e o prazo de 3 s nunca foram exercitados
   contra um banco real daqui. O que os testes provam é a lógica de decisão, não o driver.
2. **`degraded` não aparece em monitor que só olha o código HTTP.** É consequência
   deliberada da seção 3; a alternativa (derrubar o `ok` do cliente) causaria perda de
   dados silenciosa.
3. **O manifesto precisa ser regenerado.** Adicionar migração sem `npm run build:manifest`
   deixa o health mentindo para baixo (ele espera uma migração a menos). A CI pega pela
   suíte e pelo `check:manifest`, mas o deploy feito à mão não.
4. **Prazo é abandono.** A consulta lenta continua no banco depois do `503`.
5. **Verificação de e-mail é configuração, não conectividade** (seção 8).
6. **Sem amostragem nem agregação.** Um health chamado a cada 5 min vê 5 min de nada.

---

## 11. Resumo de uma linha

O `/api/health` deixou de responder "o banco respondeu `SELECT 1`" e passou a responder
"**dá para servir, e o que está faltando**" — com código estável, `503` só quando não serve,
e nenhum segredo na resposta.
