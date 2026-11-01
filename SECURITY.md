# Política de Segurança — Loto Mais

## Versões Suportadas

| Versão | Suportada |
| :--- | :--- |
| `1.x` | ✅ Sim |
| `< 1.0` | ❌ Não |

## Arquitetura de Segurança

- **Credenciais isoladas no servidor**: `DATABASE_URL` é lida exclusivamente em funções serverless (`server/handler.js`). Nenhuma variável `VITE_*` deve conter segredos.
- **Autenticação**: Senhas armazenadas com `bcrypt` (custo 12). Sessões em cookies `HttpOnly; SameSite=Lax` (`Secure` em HTTPS), com tokens armazenados no banco apenas como hash `SHA-256`.
- **Proteção contra força bruta**: Limite de 5 falhas em 15 minutos por IP ou e-mail (`login_attempts`).
- **Isolamento de dados**: Whitelist estrita de tabelas e colunas (`server/tables.js`) e escopo automático por `user_id` da sessão autenticada.
- **Borda contra CSRF (`Origin` + `Sec-Fetch-Site`)**: toda requisição de mutação (`POST`, `PUT`, `PATCH`, `DELETE`) passa por `server/originPolicy.js` **antes** de qualquer acesso ao banco. A regra é *fail-closed*: recusa quando `Sec-Fetch-Site: cross-site`, quando falta `Origin` (ou ele vem `null`, vazio ou malformado), quando o esquema não é `http(s)` e quando o host do `Origin` não é o `Host`/`X-Forwarded-Host` da requisição. `ALLOWED_ORIGINS` (lista separada por vírgula, opcional) libera origens extras — útil em domínio de preview. Mutação também exige `Content-Type: application/json` (415 caso contrário), o que impede o envio de formulário HTML simples entre sites. O `SameSite=Lax` do cookie continua sendo a primeira camada; esta é a segunda.
- **Cabeçalhos de defesa**: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` e `Referrer-Policy` configurados em `vercel.json`.

## Como Reportar uma Vulnerabilidade

Caso encontre uma vulnerabilidade, **não abra uma issue pública**. Entre em contato de forma privada com o mantenedor do repositório informando:
1. Descrição técnica do problema e impacto potencial;
2. Passos mínimos para reprodução;
3. Sugestão de mitigação (opcional).
