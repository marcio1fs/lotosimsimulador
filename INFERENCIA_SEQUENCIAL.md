# Inferência válida quando se olha repetidamente

> Item 6.2 do roadmap de [AUDITORIA_PRECISAO.md](./AUDITORIA_PRECISAO.md).
> Implementado em `js/engine/sequentialTestEngine.js`, com 29 testes.
> Documentação relacionada: [PROJECOES.md](./PROJECOES.md), [FREQUENCIAS.md](./FREQUENCIAS.md).

---

## 1. O problema

O relatório estatístico mostrava um p-valor. Esse número responde a uma pergunta
específica:

> "Se eu tivesse decidido **de antemão** olhar **uma vez**, com **esta** janela,
> qual seria a chance de um resultado tão extremo quanto este?"

O uso real do app é o contrário disso. A pessoa gera jogos, lê o relatório, troca
a janela (20 → 100 → 200), troca a estratégia, gera de novo, e para quando
**alguma** configuração parece boa. Cada leitura é um teste. Com dados de loteria
— que são aleatórios por construção — a chance de alguma leitura cair abaixo de
0,05 cresce depressa:

```
P(algum falso-positivo) ≈ 1 − (1 − α)^k
```

Medido neste repositório, em 300 séries de 120 olhadas cada, **sem nenhum sinal
embutido**: o t-test clássico aplicado a cada prefixo acusou "significância" em
**56,3%** das séries. O α nominal era 5%.

Isso não é um detalhe acadêmico. É a diferença entre "o app mediu algo" e "o app
deixou a pessoa procurar até achar".

## 2. A correção: p-valores *always-valid*

Um p-valor always-valid mantém a garantia em **todos** os tamanhos de amostra ao
mesmo tempo:

```
P(∃ n : pₙ ≤ α  |  H₀ verdadeira) ≤ α
```

A construção usada é a **mSPRT** — mixture sequential probability ratio test —
que na prática produz um *e-value*: uma variável aleatória não-negativa com
esperança ≤ 1 sob H₀. Pela desigualdade de Ville, `1/Λ` é um p-valor válido em
**qualquer instante de parada**, inclusive um instante escolhido olhando os
próprios dados.

Com `dᵢ = acertos_modelo − acertos_baseline` no concurso `i`, média `d̄` e uma
prior `N(0, τ²)` sobre o efeito médio:

```
Λₙ = √( σ² / (σ² + nτ²) ) · exp( n² · d̄² · τ² / (2σ²(σ² + nτ²)) )

pₙ = min(1, 1/Λₙ)
```

O mesmo e-value, invertido, dá o **intervalo de confiança sequencial** — o
conjunto de efeitos que não seriam rejeitados em nenhuma olhada:

```
|d̄ − μ₀| ≤ √( 2σ²(σ²+nτ²)/(n²τ²) · ln( √(σ²+nτ²)/(σ·α) ) )
```

Como p e intervalo saem da **mesma** quantidade, eles nunca se contradizem
(quando o intervalo exclui zero, o p sequencial está abaixo de α, e vice-versa —
há teste para isso).

## 3. A parte incômoda: σ não é conhecido

A primeira versão estimava σ com **os mesmos dados** que estava testando
(plug-in). Isso parecia inofensivo e era catastrófico: uma amostra de dois pontos
pode ter desvio-padrão quase zero, o que transforma qualquer média diferente de
zero em `z = ∞`. Medido: **100% de falso-positivo** em ruído puro.

A correção é um **bloco de aquecimento**: os primeiros 20 concursos (limitados a
um terço da amostra) servem apenas para estimar σ, e não são monitorados. Como o
restante da série é independente desse bloco, a garantia sobre as olhadas
seguintes se sustenta — condicionada a um σ que não olhou para o dado testado.

Efeito colateral necessário: se o bloco de aquecimento não tem variabilidade
nenhuma, **não existe σ estimável** e o motor declara o teste indisponível, com
motivo. Inventar um piso numérico minúsculo devolveria "p = 0" para qualquer
coisa — e um número inventado é pior que um número ausente.

## 4. O custo em poder — e ele é real

Ser válido em qualquer instante significa ser **mais conservador em cada
instante**. Medições deste repositório, 200 concursos, σ = 2 acertos:

| Efeito real | Detecção (sequencial, 180 olhadas) | Detecção (clássico, uma olhada) |
|---|---|---|
| 0,3 acerto | 30% | 60% |
| 0,5 acerto | 73% | 96% |
| 0,9 acerto | 99% | 100% |
| 1,5 acerto | 100% | 100% |

(100 réplicas por linha, semente fixa.)

O teste sequencial **não vê** vantagens pequenas que o teste clássico veria — se
você tivesse combinado olhar uma vez só. Não é defeito de implementação: é o
preço de poder olhar quantas vezes quiser. Não existe almoço grátis aqui, e o
relatório diz isso em vez de esconder.

## 5. Calibração medida

Todas as medições abaixo são reproduzíveis pelos testes e usam o PRNG semeado do
projeto.

| Cenário | Resultado |
|---|---|
| 300 séries nulas, 120 olhadas cada — p always-valid | **3,7%** de falso-positivo |
| 300 séries nulas, 120 olhadas cada — p clássico repetido | **56,3%** de falso-positivo |
| 60 séries com efeito de 0,9 acerto | **100%** de detecção |
| Backtest real (Lotofácil, 200 concursos) | p clássico 0,659 · p sequencial 1,000 · IC seq. [−0,254; +0,345] |

## 6. Orçamento de α da sessão

Para as olhadas **discretas** do app (gerar, trocar janela, rodar outra
estratégia) há uma solução mais simples que a mSPRT e igualmente válida, desde
que o limiar seja fixado antes de olhar: gastar α em uma série cuja soma
converge para α.

```
αₘ = α · (6/π²) / m²        pois  Σ 1/m² = π²/6
```

A soma dos limiares de **todas** as olhadas possíveis (m = 1, 2, 3, …) é
exatamente α. Como a união cobre todos os m, a garantia vale **mesmo que o
número de olhadas seja escolhido depois de ver os dados** — que é precisamente o
comportamento que se quer conter.

Consequência visível: a primeira olhada recebe **0,0304** de α (61% do total); a
segunda, 0,0076; a décima, 0,0003. Quanto mais se procura, mais alto fica o
crivo. O relatório mostra o limiar da olhada atual e o α restante da sessão.

O esquema `bonferroni` (α/m) existe na API, mas com uma ressalva registrada no
código: só vale se `m` for decidido **antes** da coleta. Com `m` escolhido
olhando os dados, Bonferroni não protege — e é exatamente o que o usuário faz.

## 7. Onde aparece

```
P-Value Exato (t-Student): 0,658991        (válido para UMA olhada)
Inferência Sequencial (always-valid): p=1,0000 · IC sequencial [−0,25; 0,34]  (válido ao olhar quantas vezes quiser)
Orçamento de α da Sessão: 3 olhada(s) · limiar desta 0,0034 · α restante 0,0018  (gasto quadrático)
```

O `BacktestEngine` devolve `sequentialAnalysis` em todo backtest; o controlador
registra uma olhada por geração de jogos em `SequentialTestEngine.sharedBudget`.

## 8. O que isso não resolve

- **Não prevê dezenas.** Nenhuma inferência sequencial cria sinal onde não há.
  Em sorteio idôneo o resultado esperado continua sendo "nada detectado".
- **Não corrige o teste de permutação** nem o benchmark de estratégias: eles têm
  famílias próprias e já aplicam correção (FDR / Holm) dentro delas. O que o
  orçamento cobre é a sequência de **leituras do usuário**, que antes não era
  corrigida por nada.
- **Assume normalidade e independência** entre concursos. As duas aproximações
  estão declaradas no cabeçalho do módulo; a calibração empírica existe porque a
  demonstração analítica não cobre σ estimado.

## 9. Referências

- Ville, J. (1939). *Étude critique de la notion de collectif*. Gauthier-Villars.
- Wald, A. (1945). Sequential Tests of Statistical Hypotheses. *Annals of Mathematical Statistics* 16(2), 117–186.
- Robbins, H. (1970). Statistical Methods Related to the Law of the Iterated Logarithm. *Annals of Mathematical Statistics* 41(5), 1397–1409.
- Johari, R., Koomen, P., Pekelis, L., Walsh, D. (2017). Peeking at A/B Tests: Why It Matters, and What to Do About It. *KDD 2017*.
- Howard, S. R., Ramdas, A., McAuliffe, J., Sekhon, J. (2021). Time-uniform, nonparametric, nonasymptotic confidence sequences. *Annals of Statistics* 49(2), 1055–1080.
