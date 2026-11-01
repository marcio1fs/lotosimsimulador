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
- **Cabeçalhos de defesa**: `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` e `Referrer-Policy` configurados em `vercel.json`.

## Como Reportar uma Vulnerabilidade

Caso encontre uma vulnerabilidade, **não abra uma issue pública**. Entre em contato de forma privada com o mantenedor do repositório informando:
1. Descrição técnica do problema e impacto potencial;
2. Passos mínimos para reprodução;
3. Sugestão de mitigação (opcional).
