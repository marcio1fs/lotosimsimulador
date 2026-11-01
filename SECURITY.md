# Política de Segurança — Loto Mais

## Versões Suportadas

| Versão | Suportada |
| :--- | :--- |
| `1.x` | ✅ Sim |
| `< 1.0` | ❌ Não |

## Arquitetura de Segurança

- **Credenciais isoladas no servidor**: `DATABASE_URL` é lida exclusivamente em funções serverless (`server/handler.js`). Nenhuma variável `VITE_*` deve conter segredos.
- **Autenticação**: Senhas armazenadas com `bcrypt` (custo 12). Sessões em cookies `HttpOnly; SameSite=Lax` (`Secure` em HTTPS), com tokens armazenados no banco apenas como hash `SHA-256`.
- **Proteção contra força bruta**: Limite de 5 falhas em 15 minutos por IP ou e-mail (`login_attempts`), por cima do limite geral de 20 logins/15 min por IP.
- **`/api/health` não vaza diagnóstico**: a rota é pública (é healthcheck) e devolve códigos estáveis (`db_unreachable`, `migrations_pending`, …) em vez de mensagem de erro crua, host de banco ou nome de variável de ambiente. Erro completo só no log do servidor. Ver [OBSERVABILIDADE.md](./OBSERVABILIDADE.md).
- **Limite por rota**: `register` 5/h, `change-password` 10/h, `delete-account` 5/h, `reset-password` e `verify-email` 20/h, `sync` 10/h, `db-read` 1200/min, `db-write` 600/min, `me` 300/min e `health` 600/min — janela fixa com contador atômico em `rate_limits`, resposta 429 com `Retry-After`. A chave é o IP lido de `x-real-ip` / **última** entrada de `X-Forwarded-For` (a primeira é escrita pelo cliente e não servia para nada como limite). Detalhes em [LIMITES_DE_REQUISICAO.md](./LIMITES_DE_REQUISICAO.md).
- **Isolamento de dados**: Whitelist estrita de tabelas e colunas (`server/tables.js`) e escopo automático por `user_id` da sessão autenticada.
- **Borda contra CSRF (`Origin` + `Sec-Fetch-Site`)**: toda requisição de mutação (`POST`, `PUT`, `PATCH`, `DELETE`) passa por `server/originPolicy.js` **antes** de qualquer acesso ao banco. A regra é *fail-closed*: recusa quando `Sec-Fetch-Site: cross-site`, quando falta `Origin` (ou ele vem `null`, vazio ou malformado), quando o esquema não é `http(s)` e quando o host do `Origin` não é o `Host`/`X-Forwarded-Host` da requisição. `ALLOWED_ORIGINS` (lista separada por vírgula, opcional) libera origens extras — útil em domínio de preview. Mutação também exige `Content-Type: application/json` (415 caso contrário), o que impede o envio de formulário HTML simples entre sites. O `SameSite=Lax` do cookie continua sendo a primeira camada; esta é a segunda.
- **Recuperação de conta (redefinição de senha + verificação de e-mail)**: tokens de 32 bytes, gravados apenas como `SHA-256`, de uso único, com prazo (60 min para redefinir, 24 h para verificar). O pedido de redefinição responde **igual** exista ou não a conta, o envio do e-mail não é aguardado (tempo de resposta não denuncia cadastro) e o `503` de servidor sem e-mail configurado é checado antes de consultar o banco. Redefinir senha **encerra todas as sessões** da conta. Limite de 3 pedidos/hora por e-mail e 5/hora por IP. Detalhes e limitações em [RECUPERACAO_CONTA.md](./RECUPERACAO_CONTA.md).
- **E-mail e privacidade**: nenhum token é escrito em log; endereços aparecem apenas como `m***@dominio.com` (`redactEmail`). O transporte de console, que imprimiria o link no log, é recusado quando `NODE_ENV=production`.
- **Cabeçalhos de defesa**: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` e `Referrer-Policy` configurados em `vercel.json`.

## Hash legado de senha: prazo até 31/01/2027

As primeiras versões guardavam a senha como `h_<hash de 32 bits>_<base64 da senha>`. Os 12
caracteres de base64 são **9 bytes da senha em claro** e o hash de 32 bits é revertido por
tentativa em milissegundos: não é um hash fraco, é a senha com um enfeite. Quem obtém um dump
do banco — ou do IndexedDB do navegador — lê a senha.

O formato continuou aceito para migrar contas antigas no login. Isso alcança só quem faz
login: sem prazo, a conta dormente fica com a senha reversível para sempre, e o verificador
fica no código como oráculo para quem tem um dump antigo.

| Fase | O que acontece |
| :--- | :--- |
| Até **31/01/2027** (`LEGACY_HASH_SUNSET_ISO`) | O login com hash legado é aceito, a senha é convertida na mesma requisição (bcrypt na API, PBKDF2 no modo offline) e a interface avisa o usuário. A resposta traz `passwordUpgraded: true`. |
| A partir de **01/02/2027** | A verificação é recusada **sem calcular o hash antigo**. O 401 é o mesmo de senha errada (mensagem específica viraria oráculo de existência de conta); o motivo real vai para o log. |
| No dia do vencimento | `tests/legacyHashSunset.test.js` **falha** se o verificador legado ainda estiver em `server/security.js` ou `js/models/user.js`. Prazo que não quebra nada não é prazo. |

O prazo vive em **`shared/passwordPolicy.js`**, importado pelos dois lados — servidor e
cliente. `change-password` e `delete-account` já autenticados recebem mensagem específica
quando o formato venceu.

**Antes do vencimento, conte as contas ainda no formato antigo:**

```sql
SELECT COUNT(*) AS contas_legadas FROM users WHERE password LIKE 'h\_%' ESCAPE '\';
```

Conta que não fizer login até a data fica sem acesso e precisa de redefinição pelo suporte —
é o custo honesto de encerrar um formato cuja senha já pode ter vazado. O caminho barato é
avisar esses usuários antes.

## Como Reportar uma Vulnerabilidade

Caso encontre uma vulnerabilidade, **não abra uma issue pública**. Entre em contato de forma privada com o mantenedor do repositório informando:
1. Descrição técnica do problema e impacto potencial;
2. Passos mínimos para reprodução;
3. Sugestão de mitigação (opcional).
