# Projeções Futuras — o que é previsível e o que não é

**Módulo:** `js/engine/futureProjectionEngine.js` · **Interface:** aba `📊 Estatísticas → 🔭 Projeções`
**Testes:** `tests/futureProjection.test.js` (42 testes)

---

## 1. A resposta curta

**Nenhuma IA prevê dezenas de loteria** — e é importante começar por aqui.

Em um sorteio idôneo, toda combinação válida tem **exatamente** a mesma probabilidade. Não existe padrão, histórico, rede neural ou modelo estatístico capaz de alterar `1 / C(60,6)` na Mega-Sena. Um sistema que dissesse "esta dezena vai sair" estaria mentindo — e essa é precisamente a mentira que a auditoria anterior removeu do projeto.

O que **é** previsível com exatidão matemática é o **comportamento do processo**. E esse comportamento pode ser projetado com precisão muito maior do que qualquer "previsão" de números, porque é determinístico ou derivável de forma fechada.

Este módulo projeta — sem simulação, sem constantes inventadas — sete coisas:

| # | Projeção | Método | Precisão |
| :-- | :--- | :--- | :--- |
| 1 | Tempo até 50%/90%/99% de chance de acerto | Geométrica (forma fechada) | **Exata** |
| 2 | Curva de sobrevivência em N concursos | `1 − (1 − p)^N` | **Exata** |
| 3 | Espera por uma dezena individual | Geométrica com `p = drawn/total` | **Exata** |
| 4 | Custo de uma estratégia em N concursos | Multiplicação | **Determinística** |
| 5 | Retorno esperado por faixa oficial | `Σ P(k) × prêmio(k)` | Exata (teto, sem rateio) |
| 6 | Probabilidade de acúmulo do prêmio | Taxa histórica + Wilson 95% | Estimada com IC |
| 7 | Cobertura de uma carteira | Hipergeométrica + Bonferroni / Monte Carlo | Exata ou com IC 95% |

---

## 2. As projeções, uma por uma

### 2.1 Tempo até a "certeza estatística"

A chance de acertar a sena em N concursos é `1 − (1 − p)^N`, onde `p` é a probabilidade da carteira por concurso. Para jogos distintos, `p = m × p_single` (os eventos são mutuamente exclusivos).

Resolvendo para N: `N = ⌈ln(1 − confiança) / ln(1 − p)⌉`.

**Mega-Sena, 1 aposta simples:**

| Chance acumulada | Concursos | Tempo (3 sorteios/semana) |
| :--- | ---: | ---: |
| 50% | 34.701.623 | **221,7 mil anos** |
| 90% | 115.276.297 | 736,4 mil anos |
| 99% | 230.552.593 | 1,5 milhão de anos |

Espera média até o primeiro acerto: **50.063.860 concursos** (≈ 319.830 anos).

Essa é a projeção mais precisa de todo o sistema — e a mais desconfortável. Ela não depende de modelo, de dados históricos nem de interpretação: é a definição de independência estatística.

### 2.2 Espera por uma dezena

Cada dezena tem `p = drawn/total` por concurso (Mega: 6/60 = 10%). A distribuição do tempo até a próxima aparição é geométrica:

- **Espera média:** `1/p` = 10 concursos (na Mega)
- **Mediana:** 7 concursos
- **P90:** 22 · **P99:** 44
- **P(sair em ≤ 10 concursos):** 65,1%

A consequência importante — que o painel expõe porque a interface antiga sugeria o contrário — é que **atraso não aumenta a probabilidade da próxima saída**. A distribuição geométrica não tem memória: uma dezena ausente há 40 concursos tem exatamente a mesma chance que qualquer outra.

### 2.3 Projeção financeira

O custo é determinístico; o retorno é uma esperança matemática.

**Mega-Sena, 1 aposta de R$ 6,00:**

| Faixa | Odds (exatamente k) | Prêmio estimado | Retorno esperado |
| :--- | ---: | ---: | ---: |
| 6 acertos | 1 em 50.063.860 | R$ 35.000.000 | R$ 0,70 |
| 5 acertos | 1 em 154.518 | R$ 52.000 | R$ 0,34 |
| 4 acertos | 1 em 2.332 | R$ 1.150 | R$ 0,49 |
| **Total** | | | **R$ 1,53** |

**Taxa de retorno: 25,5%** — ou seja, **R$ 0,75 de perda esperada por real apostado**.

O painel deixa explícito que esse retorno é um **teto**: ele assume prêmio integral, sem rateio. Com ganhadores múltiplos, o retorno real é menor.

### 2.4 Acúmulo do prêmio

Diferente das demais, esta projeção **usa dados reais** (o campo `acumulou` de cada concurso). Reporta a taxa com **intervalo de Wilson 95%** em vez de um número pontual, mais a sequência atual, o recorde e a média de acúmulos consecutivos.

Exemplo real observado no painel: 49 de 160 concursos acumularam → **30,6% [24,0% – 38,2%]**.

Isso projeta *expectativa de prêmio*, não escolha de dezenas: acúmulo depende do número de acertadores.

### 2.5 Cobertura da carteira

Duas situações matematicamente distintas:

**a) Prêmio máximo — exato.** Se o bilhete é a própria combinação sorteada (`pick === drawn`), dois bilhetes distintos não podem acertar ao mesmo tempo. Logo a probabilidade da carteira é exatamente `m × p`. Com 10 jogos de Mega-Sena: **1 em 5.006.386**.

**b) Demais faixas — limites rigorosos.** Para "pelo menos 4 acertos em algum bilhete", os eventos se sobrepõem. O módulo calcula a interseção exata entre pares de bilhetes por contagem combinatória e aplica **Bonferroni**:

```
Σ pᵢ − Σ_{i<j} P(Aᵢ ∩ Aⱼ)  ≤  P(∪ Aᵢ)  ≤  Σ pᵢ
```

Quando os bilhetes se sobrepõem muito (típico em Lotofácil, onde 11 acertos é comum), o intervalo de Bonferroni fica inútil (0% – 100%) e o módulo cai para **Monte Carlo determinístico** com semente fixa e IC 95% — reprodutível e auditável, nunca um "chute".

**Lotofácil, 10 jogos:**

| Faixa | Probabilidade da carteira | Método |
| :--- | ---: | :--- |
| 15 acertos | 1 em 326.876 | exato |
| 14 acertos | 0,05% | Bonferroni [0,05 – 0,05] |
| 13 acertos | 1,49% | Bonferroni [1,48 – 1,49] |
| 12 acertos | 17,15% | Bonferroni [16,10 – 18,20] |
| 11 acertos | 62,22% | Monte Carlo [61,74 – 62,70] |

### 2.6 Odds exatas em BigInt

As odds são calculadas com aritmética inteira (`BigInt`) e divisão inteira, reproduzindo as tabelas oficiais sem erro de ponto flutuante:

| Modalidade | Faixa | Odds no sistema | Odds oficiais Caixa |
| :--- | :--- | ---: | ---: |
| Mega-Sena | sena | 1 em 50.063.860 | 1 em 50.063.860 ✅ |
| Mega-Sena | quina | 1 em 154.518 | 1 em 154.518 ✅ |
| Mega-Sena | quadra | 1 em 2.332 | 1 em 2.332 ✅ |
| Lotofácil | 15 acertos | 1 em 3.268.760 | 1 em 3.268.760 ✅ |
| Quina | 5 acertos | 1 em 24.040.016 | 1 em 24.040.016 ✅ |
| Lotomania | 20 acertos | 1 em 11.372.635 | 1 em 11.372.635 ✅ |

Antes do módulo, inverter `1/p` em ponto flutuante produzia `11.372.636` na Lotomania. Detalhe pequeno; sintoma do mesmo problema maior.

---

## 3. O que NÃO foi feito (e por quê)

| Ideia tentadora | Por que não implementamos |
| :--- | :--- |
| Prever as dezenas do próximo sorteio | Impossível em sorteio idôneo. Seria ficção com aparência de matemática. |
| "Modelo de IA" que aprende o padrão dos sorteios | Não existe padrão a aprender. O χ² exato confirma uniformidade; a auditoria mostrou que 0 de 360 transições de Markov sobrevivem ao FDR. |
| Dizer que a poda gaussiana melhora as odds | **Falso** — e estava no sistema antes. Ver seção 4. |
| Garantir retorno positivo | Matematicamente impossível: `E[retorno] < custo` em todas as modalidades, por desenho do jogo. |

---

## 4. Correção de integridade que veio junto

O `ProbabilityEngine.calculatePortfolioProjection` aplicava dois multiplicadores inventados que faziam a interface exibir **"Ganho de Eficiência Combinatória: 5x"** e `1 em X` melhor para o "Núcleo Gaussiano":

```js
// ANTES (falso)
const effectiveSpace = Math.round((1/p) * retentionRatio);
const coreProb = Math.min(1, tickets / effectiveSpace);   // ← trata poda como ganho de odds
const orthogonalityFactor = 0.65 + 0.35 * (diversificationScore / 100); // ← inventado
```

**Descartar combinações não altera a probabilidade de nenhuma combinação.** O sorteio não sabe o que o app descartou; a poda reduz o espaço *pesquisado* (custo computacional), não a chance de acerto.

Agora o campo `gaussianCorePortfolioOdds` retorna exatamente o mesmo valor de `portfolioDirectOdds`, com `gaussianCoreOddsAreUnchanged: true` e um texto explicando o efeito real. A probabilidade de "qualquer prêmio" passou a usar o **limite superior da união** (`m × p`), válido, em vez do fator de ortogonalidade.

Um teste de regressão impede a reintrodução: `tests/futureProjection.test.js → "podar combinações NÃO melhora as odds"`.

---

## 5. Como ler o painel

1. **Escolha a modalidade** e carregue o histórico.
2. **Gere jogos** (opcional). Com jogos gerados, a cobertura da carteira usa os **bilhetes reais** — inclusive as sobreposições — em vez de estimar por `m × p`.
3. Abra **📊 Estatísticas → 🔭 Projeções**.
4. Leia na ordem: *Tempo até a certeza* → *Sobrevivência* → *Financeiro*. Esta ordem é deliberada: começa pela escala do problema.

**Onde estão as incertezas.** Todo número que é estimativa vem acompanhado de intervalo:
- Acúmulo → intervalo de Wilson 95%
- Faixas parciais da carteira → limite de Bonferroni ou IC 95% de Monte Carlo
- Prêmio financeiro → marcado como teto (sem rateio)

**O que é exato não ganha intervalo**: `p_single`, `m × p` para prêmio máximo, espera geométrica, custo. Esses números não têm incerteza — têm a limitação da premissa (sorteio idôneo), que é a premissa correta.

---

## 6. Verificação

```bash
npm test          # 193 testes; 42 dedicados a projeções
```

Os testes conferem contra **tabelas oficiais** (odds), **valores analíticos** (derivadas da geométrica e da hipergeométrica) e **propriedades matemáticas** (monotonicidade, complementaridade, validade dos limites).

Casos notáveis:
- dois bilhetes idênticos → a interseção da sena deve ser **exatamente** `p_sena` (valida a contagem combinatória);
- dois bilhetes sem dezenas em comum → interseção da sena = **0**;
- `drawsForConfidence` deve ser o **mínimo** n que atinge a confiança (não apenas "um n que atinge");
- o limite superior de Bonferroni nunca pode ser violado por arredondamento;
- a poda **não** pode melhorar as odds.
