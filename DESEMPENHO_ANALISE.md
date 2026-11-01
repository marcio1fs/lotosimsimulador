# Memória e custo da análise estatística

> Item 6.10 do roadmap de [AUDITORIA_PRECISAO.md](./AUDITORIA_PRECISAO.md).
> Implementado em `js/engine/pairMatrix.js` e `js/engine/statisticalAnalyzer.js`,
> com 18 testes (`tests/analysisMemory.test.js`).

---

## 1. O problema — e um erro na própria auditoria

A auditoria descrevia o custo assim:

> "`pairMatrix` = 4.950 objetos na Mega, 4.950 na Quina, 10.000 na Lotomania"

Os números estão **errados**. O número de pares é `C(total, 2)`:

| Loteria | Pares `C(total,2)` | Matriz de Markov (`total²`) |
|---|---|---|
| Mega (60) | **1.770** | 3.600 |
| Quina (80) | **3.160** | 6.400 |
| Lotomania (100) | **4.950** | 10.000 |

O valor 10.000 atribuído à "Lotomania" não é a matriz de pares — é a matriz **de
Markov** (`nextDrawGivenPrev`), que a auditoria não contou. E ela era construída
tanto em `analyze()` quanto em `analyzeFast()` com **um objeto por célula**.
O custo real por chamada de `analyze()` na Lotomania era:

```
pares           4.950 objetos
topPairs        4.950 objetos   (todos os pares, só para achar os 30 maiores)
Markov         10.000 objetos
                 ─────────────
               19.900 objetos por chamada
```

## 2. Por que isso importava mais do que parece

`analyzeFast()` — a versão enxuta usada dentro do backtest — roda **uma vez por
concurso avaliado**, e também montava a matriz de pares e a de Markov:

```
14.950 objetos por concurso × 200 concursos = ~2.990.000 objetos por backtest
```

Todos descartáveis: a matriz de Markov nunca era devolvida, e os 4.920 pares
descartados existiam apenas para descobrir os 30 que interessavam. Não é
vazamento de memória — é **lixo alocado a cada quadro**, que o coletor precisa
varrer. O sintoma é o app engasgando ao gerar jogos em loterias de 80–100 dezenas.

## 3. O que mudou

**`PairCountMatrix`** (`js/engine/pairMatrix.js`): um único `Int32Array` de
`(total+1)²` posições — **40 KB** no pior caso, contra centenas de KB de objetos.
`get`/`increment` normalizam `{a,b}`/`{b,a}` para a mesma célula, preservando a
semântica anterior (só `i < j` era armazenado).

**Top-30 por seleção, não por ordenação.** Antes: materializar `C(n,2)` objetos e
ordenar. Agora: percorrer as células e manter apenas os 30 maiores, com inserção
estável — a mesma ordem de um `sort` decrescente estável (empate: quem aparece
primeiro, ou seja `a` crescente e depois `b` crescente).

**Markov com `Int32Array`**: a matriz `total × total` de contadores virou um
buffer plano. Ela nunca saía da função, então nada mais precisava saber disso.

**Memoização explícita** (`analyzeCached`), descrita na seção 5.

## 4. Medições

Todas em processo separado da suíte, com `--expose-gc`, PRNG semeado, comparando
o commit anterior (`d9074be`) com o atual.

| Medida | Antes | Depois |
|---|---|---|
| Heap retido — `analyze` + `analyzeFast`, Lotomania, 300 concursos | 1,19 MB | **0,89 MB** |
| Chaves expostas por `pairMatrix` | 100 linhas de objeto | 1 estrutura (`Int32Array` de 40 KB) |
| Objetos por `analyze()` (Lotomania) | 19.900 | 30 + 1 buffer |
| Objetos por backtest de 200 concursos | ~2.990.000 | 200 buffers |
| Backtest Lotomania (200 concursos, mediana de 3) | 3.802 ms | **3.416 ms** (−10%) |
| 5 cálculos da **mesma janela** | 613 ms | **1 ms** (cache) |
| `analyze()` isolado, Lotomania 400 concursos | 117 ms | 111 ms |

Sobre o tempo: o ganho de CPU em uma chamada isolada é **pequeno e dentro do
ruído**. O que muda de verdade é (a) o volume de lixo por backtest e (b) não
recalcular o que já foi calculado. Vender isso como "10× mais rápido" seria
mentira — o `analyze` continua sendo O(total²) em tempo, porque ainda precisa
contar todos os pares.

## 5. Memoização: o que é, e o que ela não perdoa

```js
StatisticalAnalyzer.analyzeCached(history, config)  // LRU de 4 janelas
```

A chave é `(total, pick, drawn, tamanho da janela, concurso mais recente,
concurso mais antigo)`. Duas chamadas com a mesma chave não refazem o trabalho —
trocar de aba, reabrir o painel ou recalcular a mesma janela deixam de custar
~100 ms na Lotomania.

Três decisões deliberadas:

1. **É explícita, não mágica.** `analyze()` continua sem cache; só quem chama
   `analyzeCached()` ganha o comportamento. Um cache invisível dentro de
   `analyze` transformaria um bug de dados desatualizados em algo impossível de
   depurar.
2. **A chave é heurística e isso está dito.** Se o conteúdo de um histórico mudar
   sem alterar as pontas nem o tamanho, a cache não percebe. Para descartar tudo
   existe `invalidateAnalysisCache()`.
3. **Cópia defensiva.** O retorno é uma cópia do nível superior **e** das listas
   que o chamador tende a mexer (`topPairs`, `topTriples`, transições de Markov,
   assinaturas). Mutar `result.topPairs` não corrompe a cache — há teste para
   isso. Os mapas internos (`freqAbsolute`, `pairMatrix`) são compartilhados e
   somente leitura por contrato: copiá-los custaria mais que refazer a análise.

## 6. Os números não mudaram

Reescrever estrutura de dados sem mudar resultado é a parte que precisa de prova,
não de confiança. `tests/analysisMemory.test.js` compara, contra implementações
de referência escritas à parte (objeto aninhado + `sort` completo):

- contagem de todos os pares de um histórico sintético;
- os 30 pares do topo, posição por posição, com empates;
- `analyzeFast` × `analyze` — mesma matriz;
- `nextDrawProbabilities` de Markov, dezena por dezena (4 casas);
- `pairStats.examined` continua `C(total,2)` mesmo com só 30 pares reportados.

## 7. O que continua caro

- **O tempo é O(total²).** A estrutura ficou barata; o laço não. Reduzir isso
  exigiria contar pares por multiplicação de indicadores (álgebra linear) — outro
  projeto.
- **Trincas** ainda usam um `Map` com até `C(drawn,3)` chaves (1.140 na
  Lotomania) por análise. É pequeno, mas existe.
- **A cache guarda até 4 análises completas.** Em Lotomania isso é ~3,5 MB de
  teto — aceitável, e é teto, não crescimento livre.
