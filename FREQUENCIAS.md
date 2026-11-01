# Frequências com honestidade estatística

> Item 6.3 do roadmap de [AUDITORIA_PRECISAO.md](./AUDITORIA_PRECISAO.md).
> Implementado em `js/engine/bayesFrequencyEngine.js`, com 32 testes.

---

## 1. O problema

O painel ranqueava as dezenas por **frequência bruta** — `count / concursos` — e
exibia as cinco primeiras como "🔥 Quentes".

O problema é que essa conta mistura duas coisas diferentes: a taxa real de cada
dezena e o **ruído amostral**. Em 25 concursos de Lotofácil, uma dezena que
aparece 6 vezes tem 24%; o erro-padrão de 6 em 25 é de **~8 pontos percentuais**.
Ou seja: 24% e 20% não são distinguíveis em 25 concursos — mas o painel os
apresentava como se fossem medidas precisas de coisas diferentes.

Em 200 concursos, 40 aparições (20%) têm erro-padrão de ~2,8 p.p. A mesma tela
comparava os dois números lado a lado, sem qualquer indicação de que um é
quatro vezes mais confiável que o outro (ou de que um deles não deveria ser
exibido assim).

Isso não é um bug de arredondamento. É a razão pela qual "dezena quente" parece
um conceito com conteúdo, quando em sorteio idôneo não é.

## 2. O modelo

Cada dezena tem uma taxa latente θ — a probabilidade de aparecer em um concurso.
A priori é uma Beta centrada na taxa esperada `p = drawn / total`:

```
θ ~ Beta(α₀, β₀),  α₀ = κ·p,  β₀ = κ·(1 − p)
```

Após `k` aparições em `N` concursos, a posteriori é:

```
θ | dados ~ Beta(α₀ + k, β₀ + N − k)
```

E a estimativa pontual é a média a posteriori:

```
θ̂ = (α₀ + k) / (α₀ + β₀ + N)
```

que é um **encolhimento** da frequência bruta em direção a `p`. Com histórico
curto, o encolhimento é forte; com histórico longo, a frequência bruta domina.
É exatamente o comportamento que falta quando se mostra `count / N`.

## 3. A força da prior não é inventada

`κ = α₀ + β₀` é estimado dos próprios dados (empirical Bayes, método dos
momentos). A variância das taxas observadas entre as dezenas tem dois
componentes:

```
s²  =  τ²  +  p(1 − p)/N
      ↑      ↑
      real   ruído amostral
```

donde:

```
τ² = s² − p(1 − p)/N
κ  = p(1 − p)/τ² − 1
```

- Se `τ² ≈ 0`, as dezenas são **indistinguíveis** e a prior vai ao máximo
  (`κ = 2000`): todas as estimativas colapsam em `p`, que é a resposta correta.
- Se há heterogeneidade real, `τ² > 0` e `κ` cai — a frequência bruta passa a
  influenciar a estimativa.

O teto de 2000 existe só para manter a aritmética finita. Um teste garante que
o **veredicto não muda** para `κ_max` entre 200 e 20.000.

## 4. Intervalos: por que a união com Wilson

Cada dezena recebe:

| Intervalo | Cobertura | Papel |
|---|---|---|
| Credível (95%) | moderada | Estimativa bayesiana |
| Wilson (95%) | conservadora | Não assume homogeneidade |
| **Exibido = união dos dois** | conservadora | Nunca finja mais precisão que os dados |
| Simultâneo (Bonferroni: α/total) | 95% conjunto | Teste de "esta dezena se distingue?" |

A união com Wilson é o ponto sutil. Quando `τ̂² ≤ 0`, a prior domina e o
intervalo credível fica estreito — mas estreito **condicionado à hipótese de que
todas as dezenas têm a mesma taxa**, que é justamente a hipótese em teste. O
intervalo de Wilson não faz essa suposição. Tomar a união garante que o painel
nunca exiba uma precisão que o histórico não sustenta. Um teste verifica que o
intervalo mostrado sempre **contém** o de Wilson.

A correção de Bonferroni existe porque 25/60/80/100 dezenas são testadas ao
mesmo tempo: a 95% marginal, espera-se `0,05 × total` "desvios" só por azar
(3 na Mega, 4 na Quina). O resumo reporta essa expectativa para que ninguém
confunda coincidência com padrão.

## 5. Números medidos

### Lotofácil — dezena com ~70% bruto (base 60%)

| N | κ | Bruto | Ponto | IC exibido | Encolhimento | Distingue? |
|---|---|---|---|---|---|---|
| 25 | 2000 | 72,0% | **60,1%** | 52,4% – 85,7% | −11,9 p.p. | não |
| 100 | 2000 | 70,0% | **60,5%** | 58,4% – 78,1% | −9,5 p.p. | não |
| 500 | 2000 | 70,0% | **62,0%** | 60,1% – 73,9% | −8,0 p.p. | sim |
| 2000 | 575 | 70,0% | **67,8%** | 65,9% – 72,0% | −2,2 p.p. | sim |

Os dois lados importam: com 25 concursos, "70%" vira 60,1% e o intervalo cobre
52%–86% (nada se sabe); com 2000, a taxa sobrevive a 67,8% e o intervalo
estreita. **O mesmo dado bruto significa coisas diferentes dependendo de N** —
e isso agora está visível.

### Mega-Sena uniforme (base 10%), N = 500 — o mais quente das 60 dezenas

| | Valor |
|---|---|
| Frequência bruta | 13,0% |
| Estimativa encolhida | **10,6%** |
| IC exibido | 9,4% – 16,2% |
| Base | 10,0% |
| Dezenas distinguíveis | **0** (marginal e simultâneo) |

Os "13% contra 10% de base" que o painel antigo mostrava como liderança são
ruído: o intervalo cobre a base com folga.

### Quina com uma dezena realmente viciada (N = 300, dezena 7 a 40%)

| | Valor |
|---|---|
| Bruto | 34,7% |
| Ponto | **30,1%** |
| IC exibido | 25,5% – 40,2% |
| IC simultâneo | 22,3% – 44,5% |
| P(acima da base) | 100,0% |
| Distinguíveis | 3 marginais, **1 simultâneo** |

O sistema **detecta** um vício grosseiro quando ele existe. Não é ceticismo
universal — é calibração.

### Calibração dos intervalos

Em 15 simulações independentes de sorteio uniforme (Mega, N = 200/400/800),
**zero** dezenas quedaram fora do intervalo simultâneo — como deveria ser: o
intervalo simultâneo é construído para errar no máximo 5% das vezes, e sobre 900
dezenas testadas isso daria no máximo ~45 esperados; obter zero é consistente
com a correção estar conservadora.

## 6. Onde aparece no sistema

| Local | O que mostra |
|---|---|
| 🔥 Quentes / 🧊 Frios | Números + `Bruto X% → Y% · IC 95% A%–B%` |
| 🎯 Frequência × Ruído (novo) | Quantas dezenas sobrevivem ao IC simultâneo |
| Mapa de frequência (tooltip) | `Nx de M · estim. Y% (IC 95% A%–B%)` |

Custo: 3–6 ms para 25 dezenas, 10–15 ms para 100 (Lotomania). Sem impacto
perceptível na interface.

## 7. O que este módulo **não** faz

- **Não prevê dezenas.** Ele diz o quanto a frequência observada deve ser levada
  a sério. A conclusão usual é que deve ser levada a sério muito menos do que
  parece.
- **Não muda a geração de jogos.** O `scoringEngine` continua usando os pesos
  que já usava; alterar o gerador com base neste módulo é outro item do roadmap
  (6.4) e exigiria recalibrar o backtest.
- **Não corrige o sorteio.** Se a Caixa publicar um sorteio com vício real, este
  módulo aponta — mas a probabilidade de acertar continua sendo a combinatória.

## 8. Como verificar

```bash
npm test   # 225 testes (32 do módulo bayesiano)
```

Referências externas usadas nos testes:

- `qbeta(q, a, b)` conferido contra **mpmath** (50 dígitos, bissecção tol=1e-30)
  em 10 casos, erro máximo observado **1,3 × 10⁻¹⁴**.
- Simetria `I(x; a, b) = 1 − I(1−x; b, a)`.
- Média a posteriori conferida contra a fórmula fechada com tolerância 1e-12.
- Calibração por simulação com PRNG semeado (determinístico).
