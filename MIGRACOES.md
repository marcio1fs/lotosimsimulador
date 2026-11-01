# Migrações versionadas do banco

Terceiro item da lista de "o que falta para produção pública", depois da recuperação de conta e
da saída do Chart.js do CDN.

## 1. O problema

Até aqui o schema era criado colando `schema.sql` no SQL Editor do Neon. Isso funciona uma vez
e falha a partir da segunda:

| O que acontece | Por que é grave |
| :--- | :--- |
| Ninguém sabe o que já foi aplicado | Duas pessoas aplicam a mesma alteração, ou nenhuma aplica |
| A ordem depende de quem colou | `ALTER TABLE` num banco sem a tabela aborta no meio |
| Mudar tabela existente é instrução manual | O texto da alteração só existe no histórico de quem fez |
| Não há rollback nem auditoria | Em incidente, não se sabe qual estado o banco deveria ter |

Nada disso quebra um teste: os 496 da suíte passam com um banco em qualquer estado. É o
defeito que aparece no primeiro mês em produção, geralmente às pressas.

## 2. O modelo

```
migrations/
  001_schema_inicial.sql
  002_recuperacao_de_conta.sql
```

- Aplicadas **em ordem** de `NNN` (três dígitos, nome em `snake_case`).
- `schema_migrations (id, checksum, applied_at)` registra o que rodou e o **hash do conteúdo**.
- Cada migração roda em **uma transação**, junto com o próprio registro: ou os dois acontecem,
  ou nenhum.
- **Migração editada depois de aplicada aborta tudo.** O banco guarda o hash do que foi
  executado; se o arquivo mudar, o runner para antes de aplicar qualquer coisa e diz qual
  arquivo divergiu. Editar migração aplicada é como reescrever a ata de uma reunião: o que
  aconteceu de fato não muda.
- Registro no banco **sem arquivo** correspondente também aborta (arquivo removido é estado
  imprevisível).

## 3. Comandos

```bash
npm run migrate            # aplica o que estiver pendente
npm run migrate:status     # mostra o estado; não altera nada
npm run migrate -- --dry-run   # lista o que faria (não precisa de DATABASE_URL)
npm run build:schema       # regenera schema.sql a partir das migrações
npm run check:schema       # sai com 1 se schema.sql divergir (roda na CI)
npm run build:manifest     # regenera server/migrationsManifest.js (usado pelo /api/health)
npm run check:manifest     # sai com 1 se o manifesto divergir (roda na CI)
```

Saída de `migrate:status`:

```
  001_schema_inicial             aplicada em 2026-11-01 21:40:12
  002_recuperacao_de_conta       aplicada em 2026-11-01 21:40:13
  003_proximo_passo              pendente

2 migração(ões) pendente(s). Rode: npm run migrate
```

## 4. `schema.sql` virou foto gerada

O arquivo continua no repositório, porque colar um arquivo único no SQL Editor do Neon é como
se cria um banco do zero. Mas ele agora é **gerado**:

```
-- ======================================================================
-- SCHEMA DO BANCO — ARQUIVO GERADO. NÃO EDITE À MÃO.
-- ======================================================================
-- ===== 001_schema_inicial.sql =====
...
-- ===== 002_recuperacao_de_conta.sql =====
...
```

Editar a foto sem editar a fonte é inútil: `npm run build:schema` sobrescreve, e `npm run
check:schema` (passo da CI em *Guardas de integridade*) falha com a posição da primeira
diferença. É a mesma disciplina do `index.html`, que já era saída de build.

Existe uma segunda foto gerada, `server/migrationsManifest.js`: a lista de migrações com os
respectivos checksums. Ela é o que permite o `/api/health` comparar banco e código sem ler
`migrations/` do disco em tempo de requisição — na Vercel a função é empacotada a partir das
importações, e arquivo `.sql` não é importação. Detalhe em
[OBSERVABILIDADE.md](./OBSERVABILIDADE.md); o comando é `npm run build:manifest`.

## 5. Banco que já está rodando

O `001` e o `002` foram escritos com `IF NOT EXISTS` em tudo. Rodar `npm run migrate` num banco
criado pelo `schema.sql` antigo:

1. executa os comandos (que não fazem nada de novo, porque as tabelas já existem);
2. registra `001` e `002` em `schema_migrations`.

A partir daí o banco está sob controle de versão. **Confira antes** com `migrate:status`, que
só lê.

## 6. Por que não migra automático no deploy

Migração é a única operação deste projeto que pode destruir dado. Amarrá-la ao build significa
que **um deploy de rollback também roda SQL** — e aí não existe rollback. A ordem é:

```bash
npm run migrate:status   # 1. o que vai acontecer
npm run migrate          # 2. aplicar, lendo a saída
# 3. só então publicar
```

Se o passo 2 falhar, o banco continua no estado anterior (transação) e o deploy não aconteceu.

## 7. Como escrever a próxima migração

```bash
cat > migrations/003_adicionar_indice.sql <<'SQL'
-- 003 — índice para a listagem de jogos por concurso.
--
-- Por quê: a tela de conferência passou a filtrar por concurso e a consulta
-- fazia varredura completa em `games` (8k linhas no banco de produção).
CREATE INDEX IF NOT EXISTS idx_games_concurso ON games (lottery_id);
SQL

npm run build:schema     # regenera a foto
npm run build:manifest   # e o manifesto que o /api/health consulta
npm test                 # 24 testes de migração + o resto da suíte
```

Regras que os testes cobrem:

- nome no padrão `NNN_nome_em_snake_case.sql`, numeração **sem buraco** e **sem repetição**;
- primeira linha da migração é comentário dizendo **por quê** (não o quê: o SQL já diz o quê);
- nada de `DROP TABLE`, `DROP DATABASE`, `DROP SCHEMA` ou `TRUNCATE` sem discussão — o teste
  falha se aparecer (`053_migracoes` proíbe por padrão; exceção exige mudar o teste e assumir
  a decisão);
- `schema_migrations` é criada pelo runner, não por migração.

## 8. O que o runner **não** faz

- **Não** gera down/rollback automático. Escrever o "desfazer" de um `ALTER` é fácil; o de um
  `DROP COLUMN` é impossível (o dado já foi). O caminho é migração nova que corrige.
- **Não** trava contra execução concorrente (lock consultivo). Duas execuções simultâneas
  podem tentar aplicar a mesma migração — a `PRIMARY KEY` em `schema_migrations` barra a
  segunda no registro, mas o DDL já teria rodado. Na prática o deploy é um só; se virar
  rotina, o próximo passo é `pg_advisory_lock`.
- **Não** roda em transação única para o arquivo inteiro quando há `CREATE INDEX CONCURRENTLY`
  (esse comando não aceita transação). Não é o caso hoje — quando for, a migração precisa de um
  marcador explícito e o runner precisa de outro caminho.

## 9. Testes

`tests/migrations.test.js` — **24 casos**:

- nomes válidos/inválidos, ordenação por versão, duplicata e buraco;
- checksum insensível a CRLF e espaço nas pontas, sensível a conteúdo;
- divisão de comandos: `;` dentro de string, de comentário e de bloco `$$ … $$` (o caso que
  quebraria um `split(';')` ingênuo); arquivo só de comentários não produz comando;
- plano: pendente, aplicada, **editada**, **fantasma**;
- aplicação: ordem, transação por migração, checksum gravado, não reaplica, aborta antes de
  executar quando há deriva, `--dry-run` sem banco, migração vazia é erro;
- guardas do repositório: numeração contígua, cabeçalho explicativo, nenhum comando destrutivo,
  e **`schema.sql` idêntico à soma das migrações**.

## 10. Limitações honestas

- O runner depende do `sql.transaction([...])` do driver da Neon (uma requisição HTTP com os
  comandos da migração e o registro de controle). Em outro Postgres, trocar por
  `BEGIN/COMMIT` numa conexão só — a lógica testada (`planMigrations`, `splitStatements`) não
  muda.
- `splitStatements` desconhece `DO $$ … $$` com `;` aninhado em bloco `BEGIN … END` **fora** de
  dollar-quote — mas todo bloco `DO` usa dollar-quote, então o caso é coberto.
- Não há histórico de "quem aplicou". `applied_at` existe; autor, não. Em projeto de uma pessoa
  isso é ruído; em equipe, vira `applied_by` com o usuário do banco.
- **Não há teste de integração contra um Postgres real** neste ambiente (não há servidor nem
  Docker disponíveis). O que é testado: a lógica do runner (plano, deriva, transação, divisão de
  comandos) contra um duplo, e a coerência entre arquivos e `schema.sql`. O DDL do `001` é o
  mesmo que já rodava colado à mão; o do `002` é `ALTER TABLE … ADD COLUMN IF NOT EXISTS` e
  `CREATE TABLE IF NOT EXISTS`, mas a **primeira execução real é a primeira execução real** —
  rode `npm run migrate:status` e depois `npm run migrate` num banco de ensaio, se houver um.
