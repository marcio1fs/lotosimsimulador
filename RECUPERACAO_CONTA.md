# Recuperação de conta — redefinição de senha e verificação de e-mail

Primeiro item da lista de "o que falta para produção pública" levantada depois da
auditoria. Era o único **bloqueador funcional**: sem ele, quem esquecia a senha perdia a
conta para sempre — não havia suporte, não havia "esqueci minha senha", e nada provava que
o e-mail cadastrado era de quem se cadastrou.

---

## 1. O problema, sem enfeite

| Antes | Consequência |
| :--- | :--- |
| Nenhuma rota de redefinição | Senha esquecida = conta perdida. O único caminho era criar outra conta e perder jogos, simulações e histórico. |
| `email` aceito como texto, sem confirmação | Qualquer pessoa podia cadastrar o e-mail de outra. E, no dia em que existisse recuperação, o link iria para a caixa de um terceiro — ou seja, o reset *sem* verificação seria pior que não ter reset. |
| Nenhum canal de saída de e-mail | Não dava para provar posse do endereço nem entregar link de redefinição. |

Por isso as duas coisas vieram juntas: **um link de redefinição só prova algo se o endereço
era da pessoa.**

## 2. O que existe agora

### Fluxo de verificação

1. Cadastro (`POST /api/auth/register`) cria a conta e emite um token de verificação.
2. O e-mail com o link `/?verify=<token>` sai pelo canal configurado (ver §5).
3. Abrir o link confirma o endereço (`POST /api/auth/verify-email`), marca
   `users.email_verified` e **apaga** o token.
4. Quem está logado e não confirmou vê um aviso discreto no topo do app, com botão
   **Reenviar e-mail** (`POST /api/auth/resend-verification`).

### Fluxo de redefinição

1. "Esqueci minha senha" → `POST /api/auth/forgot-password` com o e-mail.
2. A resposta é **sempre a mesma**, exista a conta ou não.
3. Se a conta existe, um token de 60 minutos vai para o e-mail como `/?reset=<token>`.
4. Abrir o link mostra o formulário de senha nova (o token sai da URL na hora, ver §4).
5. `POST /api/auth/reset-password` troca a senha em bcrypt, **encerra todas as sessões**,
   marca o token como usado e apaga o cookie de sessão.

### Contrato das rotas

| Rota | Método | Autenticação | Respostas |
| :--- | :--- | :--- | :--- |
| `/api/auth/forgot-password` | POST | não | 200 (sempre o mesmo corpo), 400 e-mail inválido, 429 limite, 503 sem e-mail configurado |
| `/api/auth/reset-password` | POST | não (o token é a credencial) | 200, 400 (token inválido/expirado/usado/senha fraca — mesma mensagem para os quatro casos de token) |
| `/api/auth/verify-email` | POST | não (o token é a credencial) | 200, 400 |
| `/api/auth/resend-verification` | POST | sim | 200, 401, 429, 503 |

## 3. O que este fluxo **não** revela

Um formulário de recuperação mal feito é um verificador de e-mails cadastrados — dado
pessoal de terceiro. Três medidas, cada uma com teste:

1. **Mesma resposta.** `forgot-password` devolve o mesmo `200` e o mesmo texto para conta
   existente e inexistente. O teste compara `status` **e** corpo inteiro.
2. **503 antes da consulta.** "Este servidor não tem envio de e-mail configurado" é
   verificado antes de olhar o banco, então não vira um sinal de "esta conta existe".
3. **Tempo de resposta igual.** O envio do e-mail **não** é aguardado (`void sendEmail(...)`).
   Se fosse, a conta real demoraria uma chamada de rede e a inexistente responderia na hora
   — diferença de tempo que denuncia o cadastro com um cronômetro.

O que continua diferente: o servidor faz uma consulta a mais no caso "conta existe", e o
`429` por limite é aplicado **antes** da consulta justamente para não depender dela. A
diferença de tempo residual é de ordem de microssegundos de Postgres e fica abaixo do ruído
de rede — mas não é zero, e isso está dito aqui em vez de omitido.

## 4. Segurança do token

| Propriedade | Como |
| :--- | :--- |
| Não adivinhável | 32 bytes de `crypto.randomBytes` (256 bits) em hexadecimal |
| Não guardado em claro | Só o `SHA-256` vai para o banco (`password_resets.token`, `email_verifications.token`) |
| Uso único | Redefinição: `used_at` marcado. Verificação: linha apagada |
| Prazo curto | Redefinição **60 min**; verificação **24 h** (`shared/accountRecovery.js`) |
| Sem dois links válidos | Pedir de novo apaga os pendentes daquela conta |
| Sem reutilização após troca | O reset apaga os outros tokens do usuário e todos os de verificação |
| Fora do histórico do navegador | `history.replaceState` remove o token da URL ao carregar |
| Fora do log | `redactEmail` esconde a parte local; o token **nunca** é impresso (ver §5) |
| Sem vazamento por `Referer` | `Referrer-Policy: strict-origin-when-cross-origin` (já configurado em `vercel.json`) |

Trocar a senha sem encerrar as sessões não resolveria nada: se o motivo do reset foi invasão,
o invasor continuaria dentro. Por isso o reset apaga **todas** as sessões da conta.

## 5. E-mail: ou sai de verdade, ou o recurso diz que não está disponível

`server/email.js` tem três transportes:

| Transporte | Quando | Comportamento |
| :--- | :--- | :--- |
| `resend` | `EMAIL_API_KEY` definida | `POST https://api.resend.com/emails` via `fetch` — sem SDK, sem dependência nova |
| `console` | `EMAIL_TRANSPORT=console` **e** `NODE_ENV` ≠ `production` | Imprime a mensagem no log e não envia. Recusado em produção: o log passaria a conter tokens de redefinição |
| `none` | nada configurado | As rotas respondem **503** com instrução. O cadastro continua funcionando e informa `verificationSent: false` |

Configuração mínima:

```bash
EMAIL_API_KEY=re_...            # chave do provedor
EMAIL_FROM=nao-responda@seudominio.com   # domínio verificado no provedor
APP_BASE_URL=https://seudominio.com      # usado nos links (fallback: Host da requisição)
```

**O que não foi feito:** não existe fila, retentativa nem webhook de bounce. Falha de envio
é registrada no log (`[email] provedor recusou o envio para m***@dominio.com: HTTP 500`) e o
usuário pode pedir de novo, respeitando o limite. Seria o próximo passo se o volume crescer.

## 6. Limites de pedido

`recovery_requests` guarda cada pedido (IP, e-mail, tipo, instante):

| Tipo | Por e-mail | Por IP |
| :--- | ---: | ---: |
| Redefinição | 3 por hora | 5 por hora |
| Reenvio de verificação | 3 por hora | 5 por hora |

O limite por IP existe porque o limite por e-mail protege uma caixa; sem ele, um script com
10 mil endereços inundaria 10 mil caixas, cada uma dentro do próprio limite.

## 7. Modo offline: não existe, e o app diz isso

Sem servidor não há e-mail, e a senha (PBKDF2) está no IndexedDB **daquele navegador**.
Ninguém — nem o app — pode provar que o endereço digitado pertence a quem pede. A tela
responde:

> Recuperação por e-mail só funciona com a conta na nuvem. No modo offline a senha fica
> guardada neste navegador e não há como confirmar seu e-mail.

Não há caminho alternativo inventado (pergunta secreta, código de recuperação) porque
qualquer um deles seria mais fraco que a senha e ficaria guardado no mesmo lugar.

## 8. Banco de dados

A migração **`002_recuperacao_de_conta.sql`** (aplicada com `npm run migrate`, ver
[MIGRACOES.md](./MIGRACOES.md)) cria:

- `users.email_verified` e `users.email_verified_at`;
- `email_verifications`, `password_resets` (só hashes) e `recovery_requests`;
- índices por token, por usuário e por (IP/e-mail, instante).

**Contas antigas:** não há como provar o e-mail de quem já estava no banco, e deixá-las "não
verificadas" transformaria um recurso novo em aviso permanente. A migração marca como
verificadas apenas as contas com `created_at` **anterior a 01/11/2026** — o corte é uma data
fixa, então rodar de novo não marca contas novas.

## 9. Testes

`tests/accountRecovery.test.js` — **30 casos**. O banco é substituído por um duplo em
memória que **estoura em qualquer query desconhecida**: um SQL novo nas rotas quebra o teste
em vez de passar despercebido. Cobrem:

- política compartilhada (senha 8–128, formato do token, prazos, `redactEmail`, links);
- transporte de e-mail (sem configuração, console, provedor, 500, falha de rede, `EMAIL_FROM`
  ausente) — e que o log não guarda o endereço inteiro;
- cadastro com e sem e-mail configurado;
- pedido com conta existente × inexistente (**mesma resposta**), invalidação do link anterior,
  `429` no quarto pedido, `503` idêntico nos dois casos;
- redefinição: senha trocada, sessões encerradas, cookie apagado, `email_verified` marcado,
  token consumido, reuso recusado, expirado/inexistente/malformado com a mesma mensagem,
  senha fraca sem queimar o token, bloqueio de força bruta limpo;
- verificação: link válido, expirado e desconhecido com a mesma resposta, reenvio exigindo
  sessão e limitado, `me` devolvendo `emailVerified`.

## 10. Limitações honestas

- **Sem provedor configurado, o recurso fica em 503.** Isso é intencional (nada de fingir
  envio), mas significa que o deploy só entrega recuperação de conta se as variáveis de
  e-mail forem configuradas.
- **Sem bounce/complaint.** Um endereço digitado errado simplesmente nunca verifica, e a
  conta fica com o aviso na tela. Não há limpeza automática de e-mails inválidos.
- **Verificação não bloqueia login.** Foi decisão: bloquear trancaria fora quem já usa o app
  e quem tem e-mail com problema de entrega. O aviso fica visível, mas o acesso não é
  negado — o custo do aviso é menor que o custo de um usuário legítimo sem acesso.
- **Token na query string** aparece em log de proxy/CDN do lado do servidor. A mitigação
  possível (remover o token da URL) já é feita no navegador; log de infraestrutura escaparia
  dela. Vale para qualquer link por e-mail enviado assim.
- **Sem 2FA.** Quem controla a caixa postal controla a conta — exatamente como em qualquer
  recuperação por e-mail.

## 11. Status

Item **concluído** (01/11/2026): rotas, políticas, tokens, transporte, telas e testes acima.
Permanece pendente da mesma lista original: rate limit nas rotas restantes e observabilidade.
(Já resolvidos: Chart.js saiu do CDN — [INTERFACE.md](./INTERFACE.md); migrações versionadas —
[MIGRACOES.md](./MIGRACOES.md).)
