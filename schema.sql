-- ======================================================================
-- SCHEMA DO BANCO — ARQUIVO GERADO. NÃO EDITE À MÃO.
-- ======================================================================
-- Este arquivo é a foto das migrações de migrations/*.sql, na ordem em que são
-- aplicadas. Serve para criar um banco do zero colando no SQL Editor do Neon.
--
-- Para mudar o schema: crie migrations/NNN_nome.sql e rode
--     npm run build:schema     (regenera este arquivo)
--     npm run check:schema     (a CI falha se este arquivo divergir)
--
-- Em banco que já existe, o caminho é só:
--     npm run migrate
-- ======================================================================

-- ===== 001_schema_inicial.sql =====
-- 001 — schema inicial (usuários, sessões, jogos, resultados, simulações,
-- estatísticas, automação e a tabela de controle de força bruta).
--
-- Corresponde ao `schema.sql` original que era colado à mão no Neon. Todo comando
-- usa IF NOT EXISTS: rodar esta migração num banco que já tem as tabelas não
-- apaga nem recria nada — só registra a migração como aplicada.
--
-- Ordem importa: as tabelas com chave estrangeira (sessions, games, simulations,
-- user_stats, auto_settings, auto_log) vêm depois de `users`.

-- 1. TABELA DE USUÁRIOS
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(500) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABELA DE SESSÕES
CREATE TABLE IF NOT EXISTS sessions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABELA DE JOGOS GERADOS
CREATE TABLE IF NOT EXISTS games (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    lottery_type VARCHAR(50) NOT NULL,
    numbers JSONB NOT NULL,
    strategy VARCHAR(100),
    model_score NUMERIC(6,2),
    historical_performance TEXT,
    expected_hits NUMERIC(6,2),
    confidence_level VARCHAR(50),
    probability_type VARCHAR(150),
    explanations JSONB,
    stats JSONB,
    status VARCHAR(50) DEFAULT 'generated',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABELA DE RESULTADOS DE LOTERIAS (Alinhada com LotteryController)
CREATE TABLE IF NOT EXISTS lottery_results (
    id BIGSERIAL PRIMARY KEY,
    lottery_type VARCHAR(50) NOT NULL,
    concurso INT NOT NULL,
    data VARCHAR(50),
    data_apuracao VARCHAR(50),
    dezenas JSONB NOT NULL,
    acumulou BOOLEAN DEFAULT FALSE,
    valor_estimado NUMERIC(15,2),
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_lottery_concurso UNIQUE (lottery_type, concurso)
);

-- 5. TABELA DE SIMULAÇÕES (Alinhada com LotteryController)
CREATE TABLE IF NOT EXISTS simulations (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    lottery_type VARCHAR(50) NOT NULL,
    strategy VARCHAR(100),
    games_count INT DEFAULT 10,
    results_count INT DEFAULT 0,
    total_games INT DEFAULT 10,
    results JSONB,
    score NUMERIC(6,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TABELA DE ESTATÍSTICAS DO USUÁRIO
CREATE TABLE IF NOT EXISTS user_stats (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    games_generated INT DEFAULT 0,
    simulations INT DEFAULT 0,
    results_analyzed INT DEFAULT 0,
    total_games INT DEFAULT 0,
    total_wins INT DEFAULT 0,
    total_spent NUMERIC(12,2) DEFAULT 0.00,
    total_prize NUMERIC(12,2) DEFAULT 0.00,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. TABELA DE CONFIGURAÇÃO DE JOGOS AUTOMÁTICOS
CREATE TABLE IF NOT EXISTS auto_settings (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    active BOOLEAN DEFAULT FALSE,
    auto_fetch BOOLEAN DEFAULT FALSE,
    auto_generate BOOLEAN DEFAULT FALSE,
    auto_conference BOOLEAN DEFAULT FALSE,
    auto_all_lotteries BOOLEAN DEFAULT FALSE,
    interval_minutes INT DEFAULT 30,
    lottery_type VARCHAR(50) DEFAULT 'lotofacil',
    strategy VARCHAR(100) DEFAULT 'wheeling',
    games_per_draw INT DEFAULT 10,
    max_spend_per_draw NUMERIC(10,2) DEFAULT 50.00,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. TABELA DE LOGS DE AUTOMAÇÃO
CREATE TABLE IF NOT EXISTS auto_log (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) DEFAULT 'info',
    message TEXT,
    action VARCHAR(100),
    details JSONB,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- ÍNDICES DE ALTA PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_games_user ON games(user_id);
CREATE INDEX IF NOT EXISTS idx_games_lottery ON games(lottery_type);
CREATE INDEX IF NOT EXISTS idx_lottery_results_lookup ON lottery_results(lottery_type, concurso);
CREATE INDEX IF NOT EXISTS idx_simulations_user ON simulations(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_log_user_time ON auto_log(user_id, timestamp DESC);

-- 9. TABELA DE PROTEÇÃO CONTRA FORÇA BRUTA (RATE LIMIT SERVERLESS)
CREATE TABLE IF NOT EXISTS login_attempts (
    id BIGSERIAL PRIMARY KEY,
    ip VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    at TIMESTAMPTZ DEFAULT NOW()
);

-- ÍNDICES COMPOSTOS DE PERFORMANCE E RATE LIMIT
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_games_user_created ON games(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lottery_results_type_desc ON lottery_results(lottery_type, concurso DESC);
CREATE INDEX IF NOT EXISTS idx_simulations_user_desc ON simulations(user_id, created_at DESC);

-- ===== 002_recuperacao_de_conta.sql =====
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
