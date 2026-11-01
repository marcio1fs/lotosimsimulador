> [!NOTE]
> **Documento histórico (v1.1) — com correções de fato.**
> Este relatório registra a reengenharia que criou os motores atuais. Os números
> de teste citados nas seções 1–3 são os **daquela época**: 4 suítes, 151 ainda
> não existiam. Hoje a suíte tem **411 testes em 28 arquivos** (`npm test`) e o
> projeto passou por uma segunda auditoria, **[AUDITORIA_PRECISAO.md](./AUDITORIA_PRECISAO.md)**,
> que encontrou 11 defeitos adicionais — inclusive um que **fabricava resultados
> de loteria** — e, depois dela, mais seis itens de precisão.
>
> Duas afirmações da seção 4 deste relatório **não se sustentaram** e estão
> corrigidas aqui: "o modelo adaptativo apresentou o melhor alinhamento
> multifatorial" e "melhoria observada". Nenhum teste de significância sustentava
> aquilo na época, e as medições feitas depois mostram o contrário. Um relatório
> desatualizado é pior que nenhum; um relatório que afirma vantagem inexistente é
> pior que os dois.

# AUDITORIA E REENGENHARIA DO LOTOSIMSIMULADOR

## Resumo Geral da Auditoria (v1.1 — estado da época)

| Item | Métrica / Status |
| :--- | :--- |
| **Problemas Encontrados** | 12 falhas conceituais, metodológicas e de infraestrutura |
| **Problemas Corrigidos** | 12 de 12 **do escopo desta auditoria** (a segunda encontrou outros 11) |
| **Testes Automatizados** | 4 suítes passando **na época** — hoje 28 arquivos / 411 testes |
| **Backtesting** | Simulação cega walk-forward sem data leakage implementada |
| **Baseline Aleatória** | Motor comparativo estatístico em tempo real ativo |
| **Vantagem sobre o aleatório** | **Nenhuma, e isso é o resultado esperado** (ver seção 4) |

---

## 1. Problemas Encontrados

1. **Score Enganoso de Falsa Probabilidade**: O sistema antigo exibia rotulagens como `"Confiança: 99.9%"`, misturando heurística relativa com probabilidade matemática real.
2. **Ausência de Backtesting**: Não existia nenhum mecanismo para testar os algoritmos em concursos do passado.
3. **Ausência de Baseline Aleatória**: O sistema não possuía benchmark para comprovar se uma estratégia superava a escolha puramente aleatória.
4. **Data Leakage Potencial**: Análises anteriores consideravam todo o histórico em lote único sem isolamento temporal.
5. **Estratégias Frágeis & Pseudo-IA**: A antiga estratégia `ai` utilizava uma fórmula arbitrária com `Math.random()`, sem calibração estatística real.
6. **Ausência de Validação Walk-Forward e Overfitting**: O sistema não monitorava se um modelo ajustado no passado mantinha desempenho em períodos recém-ocorridos.
7. **Risco de Duplicação e Baixa Diversificação**: Lotes de 10 jogos geravam combinações altamente semelhantes sem controle de similaridade.
8. **Validações Rígidas / Filtros Booleanos Fixos**: Filtros de soma e paridade usavam limites fixos min/max sem modelagem por distribuições estatísticas.
9. **Falta de Explicabilidade**: Os jogos gerados não apresentavam o motivo da seleção de suas dezenas.
10. **Serviço de API Vulnerável**: O serviço externo não possuía retries exponenciais, múltiplos espelhos de fallback, nem validação de intervalo/dezenas por modalidade.
11. **Ausência de Testes Automatizados**: O repositório não possuía testes unitários nem de integração.
12. **Interface sem Métricas Transparentes**: O dashboard não exibia a comparação entre estratégias e a baseline aleatória.

---

## 2. Arquivos Modificados & Novos Módulos

### Novos Módulos (`js/engine/`)
- `js/engine/statisticalAnalyzer.js`: Análise de frequências absolutas/relativas/ponderadas, atrasos, repetição entre concursos, matrizes de co-ocorrência de pares, distribuições contínuas de somas, paridade, primos e faixas.
- `js/engine/scoringEngine.js`: Motor de pontuação composta por 9 fatores ponderados com métricas transparentes (`modelScore`, `historicalPerformance`, `expectedHits`, `confidenceLevel`, `explanations`).
- `js/engine/backtestEngine.js`: Execução de testes cegos sem data leakage e validação walk-forward.
- `js/engine/baselineEngine.js`: Gerador e avaliador de baseline aleatória em tempo real.
- `js/engine/monteCarloEngine.js`: Simulação Monte Carlo sintética para testes de estabilidade.
- `js/engine/gameGenerator.js`: Algoritmo de geração, filtragem adaptativa, diversificação por Índice de Similaridade de Jaccard e modos **MELHOR JOGO** (`best_game`) e **MÁXIMA PRECISÃO** (`maximum_precision`).

> Módulos que vieram depois deste relatório: `bayesFrequencyEngine` (6.3),
> `evidenceWeightingEngine` (6.4), `permutationTestEngine` (6.6), `futureProjectionEngine`,
> `sequentialTestEngine` (6.2) e `drawSourcePolicy` (6.7). Detalhes em
> [AUDITORIA_PRECISAO.md](./AUDITORIA_PRECISAO.md).

### Arquivos Modificados
- `js/services/lotteryApi.js`: Adicionados timeouts com `AbortController`, retries com retardo exponencial, espelhos de fallback e validação rigorosa de dezenas/concursos.
- `js/models/lottery.js`: Refatoração completa integrando com o motor `js/engine/*` e remoção da falsa probabilidade.
- `js/controllers/lottery.js`: Adicionado suporte a janelas temporais configuráveis, execução assíncrona de backtest e benchmark de estratégias.
- `js/main.js`: Adicionados gerenciadores de eventos para janelas temporais, estratégias estatísticas e integração do painel de transparência.
- `js/views/app.js`: Renderização de cartões de jogos com Score do Modelo, Desempenho Histórico, Acertos Esperados e Explicações.
- `js/views/statistics.js`: Adicionado o gráfico e tabela de Ranking de Estratégias vs Baseline Aleatória.
- `index.html` & `css/style.css`: Atualização da interface visual, adição de botões de janela temporal, tabela de benchmark e estilos responsivos.
- `package.json`: Adicionado `"type": "module"` e o script `"test": "node --test tests/*.test.js"`.

---

## 3. Testes Automatizados — saída da época (v1.1)

Esta é a saída **literal** da suíte quando este relatório foi escrito. Ela é
mantida como registro histórico, não como estado atual:

```text
TAP version 13
# Subtest: BacktestEngine - Validação Histórica Cega sem Vazamento de Dados e Walk-Forward
ok 1 - BacktestEngine - Validação Histórica Cega sem Vazamento de Dados e Walk-Forward
# Subtest: GameGenerator - Dezenas Únicas, Fixas, Excluídas e Diversificação
ok 2 - GameGenerator - Dezenas Únicas, Fixas, Excluídas e Diversificação
# Subtest: StatisticalAnalyzer - Frequência, Atraso e Estatísticas Descritivas
ok 3 - StatisticalAnalyzer - Frequência, Atraso e Estatísticas Descritivas
# Subtest: ScoringEngine - Avaliação Transparente sem Falsa Probabilidade
ok 4 - ScoringEngine - Avaliação Transparente sem Falsa Probabilidade
1..4
# pass 4
# fail 0
```

Uma suíte de 4 casos não podia sustentar as afirmações da seção 4. Hoje:

```bash
npm test            # 28 arquivos, 411 testes
npm run build       # build de produção
npm run check:html  # index.html em dia com os templates
```

---

## 4. Backtesting, Baseline & Desempenho Observado

- **Backtesting**: Toda previsão $N$ utiliza estritamente o histórico anterior a $N$.
- **Baseline Aleatória**: Mede o desempenho médio de apostas geradas por distribuição uniforme.

### Correção das afirmações originais

O relatório afirmava:

> "O **Modelo Adaptativo (Estatístico)** apresentou o melhor alinhamento multifatorial e consistência walk-forward."
> "**Melhoria Observada**: Demonstrada de forma empírica e transparente através da tabela comparativa."

Nenhuma das duas tinha teste de significância por trás. "Melhor alinhamento
multifatorial" era uma descrição daquilo que o modelo otimiza — não uma medição
de vantagem. As medições feitas depois, com testes que existem para poder
discordar do resultado, mostram:

| Medição | Resultado |
| :--- | :--- |
| Ponderação por evidência (Lotofácil, janela 150, 2 sementes) | sem ponderação **+0,95%** (p = 0,194); com ponderação **−0,98%** (p = 0,799) |
| Menor efeito detectável naquele tamanho de amostra | **0,2486 acertos** — a diferença entre as condições (0,173) está **abaixo** dele |
| Teste de permutação da ordem temporal (Lotofácil, 200 concursos, 99 permutações) | observado 8,933 vs nulo 8,973 ± 0,207 · z = **−0,19** · p = **0,59** |

Conclusão correta: **não há evidência de vantagem sobre o aleatório**, e o teste
de permutação não tem poder para detectar uma vantagem pequena se ela existisse.
Isso não é um defeito do projeto — é o resultado científico honesto, e agora está
demonstrado em vez de afirmado.

- **Onde a matemática realmente age**: o valor esperado condicional ao prêmio
  (`E[V] = P(ganhar) × Prêmio / E[ganhadores]`) só é afetado pelo número esperado
  de ganhadores — por isso o módulo de prêmio sozinho é a única alavanca real, e
  mesmo ele depende de calibração que **não existe publicamente** para o Brasil
  (ver item 6.8 da segunda auditoria).

---

## 5. Limitações Técnicas & Regra Fundamental

> [!CAUTION]
> **Natureza dos Jogos de Azar**:
> Loterias de números sorteados com equipamentos idôneos e aleatórios não possuem determinismo ou probabilidade garantida de 100%. O **LotOSimSimulador** atua com **100% de rigor estatístico e científico no processo**, eliminando ilusões numéricas e fornecendo a ferramenta de análise estatística mais precisa possível baseada exclusivamente no histórico real.

---

## 6. O que este relatório não sabia

Corrigir o processo na primeira auditoria não foi suficiente. A segunda
encontrou, entre outras coisas:

- o histórico de loteria era **fabricado** quando a API falhava (até 110 de 120 concursos);
- o atraso médio era medido a partir da primeira ocorrência, inflando-o em ~50%;
- 128 "padrões de Markov" exibidos em 300 concursos aleatórios — nenhum sobrevive ao FDR;
- o backtest comparava contra **uma** aposta aleatória por concurso;
- o p-valor clássico era lido repetidamente pelo usuário, com **56,3%** de
  falso-positivo em séries sem sinal (corrigido com inferência sequencial).

Cada um desses itens tem seção própria, medição e teste de regressão em
**[AUDITORIA_PRECISAO.md](./AUDITORIA_PRECISAO.md)**.
