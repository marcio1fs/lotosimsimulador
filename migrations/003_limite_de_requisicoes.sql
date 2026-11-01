-- 003 — limite de requisições por rota (janela fixa, contador atômico).
--
-- Por quê: antes só o login e a recuperação de conta tinham limite. `register`
-- aceitava criação de conta sem teto, `sync` disparava chamada a API de terceiro
-- a cada requisição e as rotas `db/*` podiam ser marteladas por qualquer sessão
-- válida. Uma linha por (bucket, chave, janela) com incremento atômico via
-- ON CONFLICT resolve sem precisar de Redis.
--
-- Janela fixa (não deslizante): quem chega no fim de uma janela e no começo da
-- seguinte faz o dobro do limite em instantes. Para contenção de abuso é aceitável
-- e custa uma linha por chave em vez de uma por requisição.

CREATE TABLE IF NOT EXISTS rate_limits (
    bucket VARCHAR(60) NOT NULL,
    key VARCHAR(200) NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    hits INT NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket, key, window_start)
);

-- Limpeza das janelas antigas (o runtime apaga as com mais de 1 dia na virada de
-- janela; este índice é o que faz esse DELETE ser barato).
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);
