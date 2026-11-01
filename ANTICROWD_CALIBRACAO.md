# Calibração brasileira do Anti-Crowd

Item 6.8 do roadmap de [AUDITORIA_PRECISAO.md](./AUDITORIA_PRECISAO.md). O item 6.8 tirou
as constantes do `AntiCrowdEngine` do código e as transformou em **priors declarados**, cada
um com `basis` (`literatura` / `arbitrário` / `sem fonte`) e `source`. Ficou pendente a
pergunta seguinte: *e se houver dado brasileiro para calibrar esses priors?*

**Veredito (01/11/2026): não há dado público brasileiro que calibre esses priors, e o
substituto que parecia existir não é matematicamente viável. O que dá para fazer sem esse
dado — medir o quanto o resultado depende dos priors — foi feito, e o resultado é
desconfortável o suficiente para mudar como o multiplicador de EV aparece na tela.**

---

## 1. O dado que falta

O motor precisa de **popularidade por dezena**: quantas apostas (ou quanto dinheiro) foram em
cada uma das 60 dezenas da Mega-Sena, em cada uma das 25 da Lotofácil, e assim por diante.
Isso é o *share* de aposta que multiplica `E[ganhadores]` no rateio — exatamente o termo que
decide se um bilhete pouco popular vale mais que um popular.

A Caixa divulga, por concurso: dezenas sorteadas, número de ganhadores por faixa, valor do
prêmio por faixa, arrecadação total e a lista de apostas vencedoras. **Não divulga** quantas
apostas escolheram cada dezena. Nenhuma dessas fontes permite reconstruir o share, porque:

- **arrecadação total** dá o total de apostas (dividindo pelo preço), não a distribuição
  entre dezenas;
- **ganhadores da faixa principal** são 0 ou 1 na maioria dos concursos da Mega-Sena. A
  contagem de acertos é 1 por jogo sorteado; para estimar a popularidade de uma dezena
  seria preciso que ela aparecesse em muitos concursos com o mesmo perfil, e o estimador
  teria variância de proporção com `p ≈ 10⁻⁸`. É ruído, não medida;
- a tabela de resultados do próprio projeto (`schema.sql`, `lottery_results`) guarda
  `dezenas`, `acumulou`, `valor_estimado` e `fetched_at` — **nem ganhadores por faixa nem
  arrecadação**. Ou seja, mesmo o proxy ruim não está no banco.

Tentar estimar popularidade a partir de "quantas vezes a dezena 7 foi sorteada entre os
ganhadores" mede o sorteio, não a aposta: o sorteio é uniforme por construção. Seria usar o
resultado para inferir a causa — o erro que a auditoria inteira existe para impedir.

> **Não reabrir isso como se fosse caminho viável.** Se algum dia existir uma tabela de
> apostas por dezena (transparência da Caixa, lote de microdados, `dataset` público), o
> pipeline da seção 3 já converte tabela em pesos calibrados. Até lá, este item é
> **encerrado com veredito**, não "pendente".

## 2. O que foi feito no lugar

Já que o nível não pode ser medido, mede-se a **dependência do nível**. Três perguntas, cada
uma com uma métrica verificável, em `js/engine/crowdCalibration.js`:

| Pergunta | Métrica | Onde |
| :--- | :--- | :--- |
| A **ordem das dezenas** sobrevive a erro nos priors? | ρ de Spearman dos pesos + distância de variação total da amostragem | `priorSensitivity()` |
| A **nota e o EV do bilhete** sobrevivem ao mesmo erro? | ρ das notas, deslocamento máximo em pontos, troca de faixa de risco, faixa do multiplicador | `ticketScoreSensitivity()` |
| Qual prior, se fosse medido, mudaria mais o resultado? | ρ de cada prior perturbado sozinho, em ordem de impacto | `priorInfluence()` |

Todas com `AntiCrowdEngine.withPriorOverrides()`, que troca o prior, roda a medição e restaura
no `finally` — sem cópia da fórmula e sem vazar estado entre execuções. Sementes fixas: a
mesma chamada devolve o mesmo número, e o teste cobra isso.

## 3. Pipeline de ingestão (pronto para o dia em que houver tabela)

```csv
dezena,apostas
1,412530
2,398112
# comentários começam com #
```

`parsePopularityCsv()` aceita vírgula, ponto e vírgula, tabulação e `|`; ignora cabeçalho,
comentários e linhas vazias; **soma** dezenas repetidas; registra cada problema com o número
da linha em vez de descartar em silêncio.

`deriveWeightsFromCounts()` converte contagens em pesos na escala do motor:

```
share_i     = count_i / Σ count                     (participação da dezena)
uniforme    = 1 / total                              (se todas empatassem)
relativo_i  = share_i / uniforme                     (1,0 = exatamente na média)
peso_i      = baseWeight − inclinação · (relativo_i − 1)
inclinação  = (baseWeight − minWeight) / 0,5
peso_i      = clamp(peso_i, minWeight, maxWeight)
```

O alisamento é Jeffreys/Dirichlet `α = 0,5` por dezena: evita que uma amostra pequena gere
`relativo = 0` e peso no teto. Para cada dezena sai também **intervalo de Wilson 95%** e a
marca `distinguishable`: `false` significa "esta tabela não separa esta dezena da média".
É o oposto de fingir precisão — com 40 apostas, nenhuma dezena se distingue.

O peso calibrado entra em `AntiCrowdEngine.setCalibration()`, que aplica encolhimento
`λ = n / (n + 100.000)` entre o prior e o dado: com `n = 0` o prior é tudo; com `n = 10⁸`,
99,9% vem do dado. `clearCalibration()` volta ao comportamento anterior.

### Linha de comando

```bash
# 1. Sem dado: o quanto a escolha depende dos priors?
npm run calibrar -- --sensibilidade

# 2. Com uma tabela de apostas por dezena: pesos + intervalo por dezena
npm run calibrar -- --file apostas.csv --total 60 --source "transparência Caixa 2026"

# Qualquer um dos dois em JSON (campo calibration já no formato do setCalibration)
npm run calibrar -- --sensibilidade --json
npm run calibrar -- --file apostas.csv --total 25 --json
```

## 4. Os números

Perturbação de **±50%** em cada prior (multiplicativa, uniforme), sementes fixas. Os priors de
ordem e os de nota são perturbados **separadamente** — misturar os dois mede a régua, não a
crença (foi o primeiro erro cometido aqui, e está registrado no histórico do arquivo).

### 4.1 Ordem das dezenas — 400 perturbações, 7 priors

| Loteria | ρ mínimo | ρ mediano | massa de amostragem deslocada (mediana / pior) |
| :--- | ---: | ---: | ---: |
| Mega-Sena (60) | 0,831 | **0,988** | 2,1% / 5,5% |
| Lotofácil (25) | 0,915 | **0,996** | 0,9% / 1,9% |

A ordem quase não muda. O peso por dezena é usado na escolha de dezenas do gerador; nessa
ponta, um erro grande nos priors move a distribuição de amostragem em poucos por cento.

### 4.2 Nota e EV do bilhete — 200 perturbações, 13 priors, 80 bilhetes

| Loteria | ρ mediano da nota | maior deslocamento | troca de faixa de risco | multiplicador de EV |
| :--- | ---: | ---: | ---: | ---: |
| Mega-Sena | 0,983 | **31,9 pontos** | 6,3% (pior 21,3%) | **0,50x – 2,07x** (mediano 1,58x) |
| Lotofácil | 1,000 | 16,8 pontos | 1,3% (pior 20,0%) | 0,86x – 1,44x (mediano 1,25x) |

**Este é o resultado que muda algo.** A ordem dos bilhetes se mantém, mas o *nível* do
multiplicador de EV não: com os mesmos priors, só mexendo nas magnitudes não verificadas, um
bilhete da Mega-Sena que aparece como `EV ≈ 1,58x` pode ser `0,50x` ou `2,07x`. Um número com
duas casas decimais ali é precisão fabricada — a mesma que a auditoria removeu do resto do
app.

Consequências aplicadas:

- o badge da interface passou a mostrar **`EV ≈ Nx`** com o aviso de que é escala ordinal e
  que o nível varia entre 0,5x e 2,1x conforme os priors (o `title` do badge diz isso);
- a nota 0–100 continua sendo exibida como nota **relativa** ("quanto menos popular que a
  média"), que é o que ela de fato mede;
- nada de EV absoluto, retorno esperado em reais ou "lucro" em nenhuma tela.

### 4.3 Influência por prior (um de cada vez, Mega-Sena / Lotofácil)

| Prior | `basis` | Mega ρ | dezenas | Lotofácil ρ | dezenas |
| :--- | :--- | ---: | ---: | ---: | ---: |
| `monthOverlapPenalty` | literatura | 0,965 | 12 | 1,000 | 0 |
| `dayOnlyPenalty` | literatura | 0,976 | 19 | 1,000 | 0 |
| `luckyPenalty` | literatura | 0,986 | 8 | 0,967 | 7 |
| `above31Bonus` | literatura | 0,988 | 29 | 1,000 | 0 |
| `roundTenPenalty` | arbitrário | 0,995 | 6 | 0,983 | 2 |
| `roundFivePenalty` | arbitrário | 0,999 | 6 | 1,000 | 3 |
| `edgePenaltyLotofacil` | arbitrário | 1,000 | 0 | 0,983 | 2 |

Os priors de `literatura` (viés de data, números da sorte) são os que mais movem a ordem; os
arbitrários quase não movem sozinhos. E os universos se comportam como o código diz: os
priors de data só existem para `total > 31` (na Lotofácil, `monthOverlapPenalty` e
`dayOnlyPenalty` têm 0 dezenas afetadas) e `edgePenaltyLotofacil` só existe para a Lotofácil
(0 dezenas afetadas na Mega). Isso é testado.

## 5. Duas metades independentes

Achado estrutural, registrado no cabeçalho do módulo: `getNumberAntiCrowdWeight()` (peso por
dezena) **não** alimenta `evaluateTicketAntiCrowd()` (nota 0–100 e multiplicador de EV). A
nota vem de características do bilhete — quantas dezenas ≤ 31, soma, terminações, geometria,
progressão aritmética — e não da escolha anti-multidão das dezenas. Por isso a análise é
feita em duas frentes separadas: a nota de um bilhete **não** reflete a popularidade das
dezenas que ele contém, e é bom que a documentação não sugira que reflete.

## 6. Limitações honestas

- **Não há medida de popularidade brasileira neste projeto.** Tudo aqui é *priors de
  literatura estrangeira (Reino Unido, EUA, Canadá) + dado sintético de teste*. O motor
  reporta `calibrated: false` e a proveniência aparece na interface.
- A sensibilidade é medida no **modelo**, não no mundo: ela diz "se os priors errarem 50%, o
  resultado muda tanto". Se errarem 300% — plausível, porque nem a direção de alguns vieses
  está confirmada no Brasil — a banda é maior.
- A perturbação é multiplicativa e independente por prior. Erros correlacionados (o viés de
  data e o de número da sorte crescem juntos) moveriam mais a ordem do que a tabela 4.1
  sugere.
- `float`/`toFixed(4)` nos pesos: as diferenças abaixo de 0,0001 não têm significado.
- A calibração por tabela de apostas mede **apostas**, não **apostadores**: um bolão grande
  pesa como mil pessoas. Para o rateio isso é o que importa (o prêmio é dividido por cota),
  então o viés é aceitável — mas é uma escolha, não um detalhe.

## 7. Arquivos e comandos

| Arquivo | Papel |
| :--- | :--- |
| `js/engine/crowdCalibration.js` | ingestão, pesos com Wilson, sensibilidade, influência |
| `js/engine/antiCrowdEngine.js` | `CROWD_PRIORS`/`CROWD_SOURCES`, `setCalibration`, `withPriorOverrides` |
| `scripts/antiCrowdCalibration.mjs` | linha de comando (`npm run calibrar`) |
| `tests/crowdCalibration.test.js` | 22 testes: ingestão, escala, Wilson, determinismo, restauração de prior |

```bash
npm test                     # suíte completa
npm run calibrar -- --sensibilidade
```

## 8. Status

**Item encerrado com veredito em 01/11/2026.** O que fecha: as três medições estão
implementadas, testadas e documentadas; a ingestão funciona e recusa entrada ruim; o nível
absoluto do EV deixou de ser apresentado como se fosse medido.

O que **não** fecha e não depende de código: saber se o brasileiro aposta como o britânico.
Isso exige dado que não existe publicamente. Quando existir, `npm run calibrar -- --file`
converte a tabela em pesos calibrados, e `setCalibration` aplica com encolhimento
proporcional à amostra.
