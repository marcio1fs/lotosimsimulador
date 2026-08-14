-- ======================================================================
-- LOTOMAIS - SCHEMA DO BANCO DE DADOS POSTGRESQL (NEON SERVERLESS)
-- ======================================================================
-- Execute este script completo no SQL Editor do seu console Neon:
-- https://console.neon.tech

-- 1. TABELA DE USUÁRIOS
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
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
    status VARCHAR(50) DEFAULT 'generated',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABELA DE RESULTADOS DE LOTERIAS
CREATE TABLE IF NOT EXISTS lottery_results (
    id BIGSERIAL PRIMARY KEY,
    lottery_type VARCHAR(50) NOT NULL,
    concurso INT NOT NULL,
    data_apuracao VARCHAR(50),
    dezenas JSONB NOT NULL,
    acumulou BOOLEAN DEFAULT FALSE,
    valor_estimado NUMERIC(15,2),
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_lottery_concurso UNIQUE (lottery_type, concurso)
);

-- 5. TABELA DE SIMULAÇÕES
CREATE TABLE IF NOT EXISTS simulations (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    lottery_type VARCHAR(50) NOT NULL,
    total_games INT NOT NULL,
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
    lottery_type VARCHAR(50) DEFAULT 'megasena',
    strategy VARCHAR(100) DEFAULT 'adaptive',
    games_per_draw INT DEFAULT 1,
    max_spend_per_draw NUMERIC(10,2) DEFAULT 10.00,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. TABELA DE LOGS DE AUTOMAÇÃO
CREATE TABLE IF NOT EXISTS auto_log (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(100) NOT NULL,
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
