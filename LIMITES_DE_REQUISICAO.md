# Limite de requisições por rota

Quarto item da lista de "o que falta para produção pública" (depois de recuperação de conta,
Chart.js fora do CDN e migrações versionadas).

## 1. O problema — e o furo que estava escondido

O que existia antes:

| Rota | Limite |
| :--- | :--- |
| `login` | 5 falhas / 15 min por IP **ou** e-mail |
| `forgot-password`, `resend-verification` | 3/h por e-mail, 5/h por IP |
| **todo o resto** | **nenhum** |

`register` aceitava criação de conta sem teto, `sync` disparava chamada a API de terceiro e
escrita no banco a cada requisição, e as rotas `db/*` — o coração do app — podiam ser marteladas
por qualquer sessão válida. Com **um** login, um script transformava o banco em alvo de carga.

E havia um furo pior, silencioso: os limites existentes eram contados pela **primeira** entrada de
`X-Forwarded-For`. Esse cabeçalho é montado assim — cada proxy **acrescenta** o endereço de quem
falou com ele **no fim** da lista. A primeira entrada é a que o cliente escreveu. Ou seja: o
limite de login existia no código e não existia na prática; bastava trocar o cabeçalho a cada
tentativa.

Correção em `server/clientIp.js`:

1. `x-real-ip` (a Vercel define na borda e o cliente não consegue forjar);
2. **última** entrada de `x-forwarded-for` (a que o proxy mais próximo acrescentou);
3. `socket.remoteAddress`;
4. valor implausível (espaço, aspas, tamanho absurdo) → balde `unknown`, que é **mais** apertado,
   não mais frouxo.

A suposição está escrita no arquivo: **um** proxy confiável na frente. Com dois encadeados, a
leitura correta seria a penúltima — e isso muda junto com a infraestrutura, não por adivinhação.

## 2. Como conta

Uma linha por `(bucket, chave, início da janela)`, com incremento atômico:

```sql
INSERT INTO rate_limits (bucket, key, window_start, hits) VALUES ($1, $2, $3, 1)
ON CONFLICT (bucket, key, window_start)
DO UPDATE SET hits = rate_limits.hits + 1
RETURNING hits;
```

Nada de contador em memória: função serverless não tem memória entre requisições, e um contador
em processo daria a impressão de proteção sem proteger nada.

**Janela fixa, não deslizante.** O defeito conhecido: quem chega no fim de uma janela e no
começo da seguinte faz o dobro do limite em instantes. Para contenção de abuso é aceitável;
janela deslizante guardaria uma linha por requisição. `Retry-After` é sempre o tempo até o fim da
janela atual — quem estourou sabe quando pode voltar, em vez de tentar no escuro.

## 3. Os números

| Rota | Limite | Janela | Por quê |
| :--- | ---: | :--- | :--- |
| `register` | 5 | 1 hora | uma pessoa cria uma ou duas contas |
| `login` | 20 | 15 min | as 5 falhas por IP/e-mail continuam valendo por cima |
| `change-password` | 10 | 1 hora | cada chamada faz bcrypt custo 12 (CPU) |
| `delete-account` | 5 | 1 hora | destrutiva e também faz bcrypt |
| `reset-password` | 20 | 1 hora | tentativa de adivinhar token (inviável, mas barato conter) |
| `verify-email` | 20 | 1 hora | idem |
| `sync` | 10 | 1 hora | chamada a API de terceiro + escrita no banco |
| `db-read` | 1200 | 1 min | leitura é barata; 20/s é folga sobre o uso real |
| `db-write` | 600 | 1 min | escrita custa mais; 10/s segue muito acima do uso |
| `me` | 300 | 1 min | chamada a cada carregamento de página |
| `health` | 600 | 1 min | monitor externo |

`forgot-password` e `resend-verification` **não** entraram: já têm limite próprio em
`recovery_requests`, mais restritivo (3/h). Dois limitadores sobre a mesma rota dariam mensagem
ambígua ao usuário.

**A chave é o IP, não o usuário.** Limite por usuário exigiria consultar a sessão antes de
contar — uma segunda consulta ao banco em toda requisição autenticada. O abuso que importa aqui é
"um cliente martelando a API", e o IP cobre isso. O custo é o NAT: uma escola inteira atrás do
mesmo endereço divide o limite — por isso os números são generosos. O objetivo é parar script,
não usuário.

## 4. Resposta

Requisição aceita:

```
HTTP/1.1 200 OK
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 2
```

Requisição barrada:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 2712
{"success":false,"error":"Muitas requisições de criação de conta. Tente novamente em instantes.","retryAfter":2712}
```

## 5. A única falha aberta (e por que)

Se a tabela `rate_limits` não existir — código novo em banco sem a migração 003 — o limite é
**ignorado com aviso no log**, em vez de derrubar login e cadastro:

```
[rate-limit] tabela `rate_limits` não existe — limite desativado. Rode `npm run migrate` (migração 003) para ativar.
```

A alternativa (falhar fechado) trocaria um risco por um incidente maior: o app inteiro fora do ar
para todo mundo por causa de uma migração pendente. A falha é aberta **só** nesse caso: qualquer
outro erro do banco sobe, e sem `DATABASE_URL` o limite é pulado (a rota responde o que sabe —
401, 503 — em vez de virar 500 de infraestrutura).

## 6. Banco

Migração **`003_limite_de_requisicoes.sql`**:

```sql
CREATE TABLE IF NOT EXISTS rate_limits (
    bucket VARCHAR(60) NOT NULL,
    key VARCHAR(200) NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    hits INT NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, key, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
```

Limpeza: na **primeira** requisição de cada janela, um `DELETE` fire-and-forget apaga janelas com
mais de um dia. Não roda em toda requisição (teste garante: exatamente um `DELETE` para duas
chamadas na mesma janela).

## 7. Testes

`tests/rateLimit.test.js` — **21 casos**:

- `clientIp`: `x-real-ip` ganha; última entrada de `XFF`; valor inválido → `unknown`; socket;
  `isValidIp` aceitando IPv4/IPv6/porta e recusando texto, aspas e tamanho absurdo;
- mapeamento: cada rota no bucket certo, leitura separada de escrita, rota desconhecida sem
  limite inventado, todo limite com `max`/janela/rótulo coerentes;
- contagem: permite até o limite com `remaining` correto, barra o excedente com `Retry-After`
  dentro da janela, chaves isoladas, virada de janela zera, `DELETE` só na virada, tabela
  ausente degrada com aviso, erro de banco sobe;
- integração com o handler: sexta criação de conta do mesmo IP → **429 com `Retry-After`**, outro
  IP preservado, `/api/health` contando, e sem `DATABASE_URL` a resposta continua sendo 401.

## 8. Limitações honestas

- **Janela fixa** permite até 2× o limite na fronteira entre janelas.
- **Chave por IP**: NAT compartilha o balde; IP rotativo (proxy residencial, 4G) contorna o
  limite. Contra isso só limite por conta + prova de trabalho, que é outro projeto.
- **Sem `pg_advisory_lock`/Redis**: duas instâncias concorrentes contam no mesmo lugar (é o
  banco, então o `ON CONFLICT` resolve), mas a **contagem** é por requisição, não por unidade de
  custo — uma requisição que gera 500 linhas conta igual a uma que gera 1.
- **Não há limite de payload por rota** além dos 512 KB globais do corpo.
- Limite por IP não é defesa contra ataque distribuído — é contra script solto e scraping. DDoS
  se resolve na borda (Cloudflare/Vercel), não aqui.
