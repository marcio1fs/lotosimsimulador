-- 002 — recuperação de conta (redefinição de senha + verificação de e-mail).
--
-- Idempotente: pode ser aplicada num banco que já a recebeu sem duplicar nada.
--
-- Por que a verificação de e-mail veio junto com o reset: um link de redefinição
-- só prova algo se o endereço era da pessoa. Sem verificação, o "esqueci minha
-- senha" entrega o controle da conta para quem digitou o e-mail errado.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Tokens de verificação de e-mail: guarda só o SHA-256.
CREATE TABLE IF NOT EXISTS email_verifications (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(128) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tokens de redefinição de senha: guarda só o SHA-256, e marca quando foi usado
-- (linha consumida não é apagada: fica o rastro de que o link existiu e foi usado).
CREATE TABLE IF NOT EXISTS password_resets (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(128) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Limite de pedidos por e-mail e por IP: sem isso, "esqueci minha senha" vira
-- ferramenta para inundar a caixa de entrada de outra pessoa.
CREATE TABLE IF NOT EXISTS recovery_requests (
    id BIGSERIAL PRIMARY KEY,
    ip VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    kind VARCHAR(20) NOT NULL DEFAULT 'reset',
    at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON email_verifications(token);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_recovery_requests_ip ON recovery_requests(ip, at DESC);
CREATE INDEX IF NOT EXISTS idx_recovery_requests_email ON recovery_requests(email, at DESC);

-- Contas criadas ANTES da verificação existir ficam marcadas como verificadas.
-- Não dá para provar o e-mail de quem já estava no banco, e deixá-las "não
-- verificadas" transformaria um recurso novo em aviso permanente na tela delas.
-- O corte é uma data fixa (implantação, 01/11/2026): rodar o script de novo
-- depois disso NÃO marca contas novas, porque o `created_at` delas é posterior.
UPDATE users
   SET email_verified = TRUE,
       email_verified_at = COALESCE(email_verified_at, created_at)
 WHERE email_verified = FALSE
   AND created_at < TIMESTAMPTZ '2026-11-01 00:00:00+00';
