# Auditoria Técnica e Estatística — LotoSimSimulador

**Data:** 01/11/2026
**Escopo:** 61 arquivos · ~8.700 linhas de JavaScript · 12 módulos de motor estatístico · API serverless (Neon) · interface SPA
**Suíte de testes:** 113 → **429 testes em 29 arquivos** (100% passando), `npm run build` OK
<!-- suite: arquivos=29 testes=429 -->
**Pergunta que guiou a auditoria:** *onde este projeto perde precisão — e como recuperá-la?*

---

## 1. Sumário executivo

A auditoria encontrou **1 problema crítico de integridade**, **4 defeitos estatísticos de alto impacto** e **11 itens de precisão de médio/baixo impacto**. Onze foram corrigidos com testes de regressão; cinco ficaram como recomendação priorizada. Todos os itens críticos e altos — e a maioria dos médios — foram **corrigidos e cobertos por testes de regressão**.

O veredito técnico, em uma frase: **o processo do projeto era rigoroso na aparência e impreciso no cálculo.** Ele tinha p-values exatos em uma camada, mas alimentava o motor com intervalos entre sorteios medidos de forma errada; exibia "128 transições de Markov detectadas" que eram indistinguíveis de ruído; comparava o modelo contra *uma única* aposta aleatória por concurso; e — no achado mais grave — **fabricava resultados de loteria** para completar a série histórica quando a API oficial falhava.

Três números resumem o ganho:

| Métrica | Antes | Depois |
| :--- | :--- | :--- |
| Atraso médio entre saídas (caso controlado: saídas a cada 10 concursos) | **15** (50% inflado) | **10** (exato) |
| p-value do χ² no ponto crítico (χ²=3,841 / gl=1) | **0,0649** (30% inflado) | **0,0500** (exato) |
| "Padrões de Markov" exibidos em 300 concursos aleatórios | **128** | **0** sobrevivem ao FDR 5% |
| Concursos exibidos como "calibrados" quando a API falha | até **110 de 120 inventados** | marcados como sintéticos, inferência bloqueada |

---

## 2. Metodologia

1. **Leitura integral** de `js/engine/*` (o núcleo que decide cada número gerado), `js/models`, `js/controllers`, `js/services`, `server/*` e das views.
2. **Execução da suíte** e do build para estabelecer a linha de base (113 testes verdes).
3. **Testes de cálculo independentes**: cada função estatística foi confrontada com valores de referência tabelados (χ², t de Student, binomial, quantil normal, Benjamini-Hochberg) e com simulação Monte Carlo para verificar **calibração** (a taxa de falso positivo bate com o α nominal?).
4. **Injeção de dados de controle**: séries com periodicidade conhecida (para expor o bug de intervalos) e séries puramente aleatórias (onde qualquer "padrão" detectado é ruído, por definição).
5. **Análise de poder estatístico**: cálculo do menor efeito detectável (MDE) por modalidade para dimensionar honestamente o que um backtest pode afirmar.

---

## 3. Achados por severidade

| # | Severidade | Achado | Local | Status |
| :-- | :--- | :--- | :--- | :--- |
| 1 | 🔴 **Crítico** | Histórico de loteria **fabricado** para completar a série; toda a inferência roda sobre dados inventados | `js/services/lotteryApi.js` | ✅ Corrigido |
| 2 | 🟠 Alto | Intervalo entre ocorrências medido errado (`lastSeen` nunca atualizado) → `avgDelay`/`maxDelay` inflados, alimentando o fator *trend* do score | `js/engine/statisticalAnalyzer.js` | ✅ Corrigido |
| 3 | 🟠 Alto | "Padrões" de Markov e pares **sem nenhum teste de significância**; `lift > 1.15` arbitrário apresentado como descoberta | `js/engine/statisticalAnalyzer.js` | ✅ Corrigido |
| 4 | 🟠 Alto | Backtest comparava o modelo contra **1** aposta aleatória por concurso → ruído da baseline dominava o teste pareado | `js/engine/backtestEngine.js` | ✅ Corrigido |
| 5 | 🟠 Alto | `pairedTTest` declarava **p = 0,0001 e "significativo"** sempre que a variância era zero (falso positivo garantido) e truncava p em 1e-6 | `js/engine/statisticalInference.js` | ✅ Corrigido |
| 6 | 🟡 Médio | χ² com p-value por aproximação `tanh` em vez de gama incompleta (erro de 30–35%) | `js/engine/statisticalAnalyzer.js` | ✅ Corrigido |
| 7 | 🟡 Médio | `optimizeWeights` escolhia pesos e reportava desempenho **no mesmo bloco** (viés de seleção) | `js/engine/scoringEngine.js` | ✅ Corrigido |
| 8 | 🟡 Médio | Backtest rodava sempre 30 concursos, sem reportar poder estatístico — indistinguível de um teste cego | `js/models/lottery.js` | ✅ Corrigido |
| 9 | 🟡 Médio | Fallbacks arbitrários no score: `stdDev = 1.5` (paridade) e `0,12 × média` (soma) | `js/engine/scoringEngine.js` | ✅ Corrigido |
| 10 | 🟡 Médio | `dataLeakageDetected` era **literalmente `false`**, não um resultado | `js/engine/backtestEngine.js` | ✅ Corrigido |
| 11 | 🟡 Médio | `runBestGameMode` escolhia a melhor janela entre 5 e devolvia o p-value do vencedor como teste único — e **descartava** o próprio backtest | `js/engine/gameGenerator.js` | ✅ Corrigido |
| 12 | 🟡 Médio | Constantes do `AntiCrowdEngine` ("~65% das apostas…") sem fonte verificável | `js/engine/antiCrowdEngine.js` | ✅ Corrigido (6.8) |
| 13 | 🟢 Baixo | `AUDIT_REPORT.md` desatualizado ("4 suítes", "12/12 resolvidos") | raiz | ✅ Corrigido (6.14) |
| 14 | 🟢 Baixo | Sem CI, sem lint/format configurado; `.vscode/settings.json` só tem preferências de extensão | raiz | 🟡 CI pronto; lint pendente |
| 15 | 🟢 Baixo | `legacyHash` (hash trivialmente reversível) continua aceito indefinidamente | `server/security.js` | ✅ Corrigido (6.12) |
| 16 | 🟢 Baixo | `analyze()` aloca matrizes O(N²) de objetos a cada chamada; `index.html` monolítico de 32 KB | `statisticalAnalyzer.js`, `index.html` | ✅ Corrigido (6.10 e 6.11) |

---

## 4. Achados detalhados e correções aplicadas

### 4.1 🔴 CRÍTICO — Histórico sintético virando evidência estatística

**O que estava acontecendo.** Quando o cache local tinha menos de 120 concursos, `ensureMinimumHistoryDepth` **inventava** sorteios com um PRNG semeado e os inseria no histórico. O único sinal era `data: 'Histórico Base'` — texto que nenhuma tela destacava. A partir daí, *tudo* era calculado sobre a mistura: `analyze`, backtest walk-forward, χ², p-values, "Base Histórica: 120 concursos calibrados", ranking de estratégias.

Numa série real com 10 concursos oficiais, **110 dos 120** concursos analisados eram ficção. E como o preenchimento é uniforme, ele **empurra deliberadamente** o χ² para "uniforme" e dilui qualquer padrão real — ou seja, ele não só inventa dados: ele sabota a medição.

**Correção.**
- Cada concurso inventado agora recebe `synthetic: true` e `data: 'Sintético (não oficial)'`.
- Novo `LotteryAPIService.countSynthetic(draws)` para contagem auditável.
- `ForecastPolicy.evaluate()` recebe o histórico e retorna o status **`SYNTHETIC_DATA`**, bloqueando qualquer afirmação de vantagem, com texto explícito ao usuário.
- `fetchAllResults` publica `dataQuality` (`officialDraws`, `syntheticDraws`, `isTrustworthyForInference`).
- A tela de insights passou a mostrar **concursos oficiais** e, em amarelo, quantos são sintéticos.

> **Recomendação estratégica:** o preenchimento sintético deveria ser **removido por completo**. Tratar "poucos dados" com um estado vazio honesto é sempre superior a preencher com ficção — mesmo com rótulo.

### 4.2 🟠 Intervalo entre ocorrências: o bug que contaminava o score

Em `analyze()` e `analyzeFast()`, o índice da última aparição era gravado **uma única vez** e nunca mais atualizado:

```js
// ANTES
if (lastSeenIndex[n] === -1) {
    lastSeenIndex[n] = idx;
} else {
    delayDistribution[n].push(idx - lastSeenIndex[n]); // sempre a partir da 1ª saída
}
```

Consequência: `avgDelay` e `maxDelay` mediam a distância desde a **primeira** aparição, não o intervalo real entre sorteios consecutivos. Em um caso controlado (dezena saindo a cada 10 concursos), o valor retornado era **15**, e o `maxDelay` **20** em vez de 10. O erro **cresce com o tamanho do histórico** — o oposto do que uma métrica de atraso deveria fazer.

Esse campo alimenta o fator `trend` (peso 0,09 do score composto), a razão de atraso em `wheelingEngine.js` e o cartão "⏱️ Atrasados" da interface.

**Correção:** dois ponteiros separados — `lastSeenIndex` (ocorrência anterior, para o gap) e `mostRecentIndex` (para o atraso atual). Ambos os analisadores foram corrigidos e um teste garante que permanecem idênticos entre si (`tests/server.test.js` já exigia isso) e que `avgDelay` não cresce com o histórico.

### 4.3 🟠 Sinais estatísticos sem teste de significância

O código decidia que uma transição de Markov era um "padrão" com uma regra fixa:

```js
if (lift > 1.15) { topTransitions.push({ from, to, lift }); }
```

Sem `p-value`, sem correção para multiplicidade — embora o motor teste **360 pares (dezena → dezena) por chamada**. O mesmo valia para pares co-ocorrentes ("pares quentes"), onde a família é **C(60,2) = 1.770** comparações.

**Correção.**
- **Teste binomial exato** para cada transição: sob H0, `acertos ~ Binomial(n, drawn/total)`, calculado por função beta incompleta regularizada (`StatisticalInference.binomialUpperTail`).
- **Benjamini-Hochberg (FDR 5%)** com o tamanho real da família de hipóteses; a interface mostra `p`, `q` e `significant`.
- Pares co-ocorrentes usam a família completa C(N,2) — conservador por construção.

**Impacto medido em 300 concursos puramente aleatórios:**

| | Antes | Depois |
| :--- | :--- | :--- |
| Transições exibidas como padrão | **128** | 128 (marcadas como **não significativas**) |
| Transições com significância real | — | **0** |
| Pares "quentes" com significância real | — | **0** de 30 |

Exemplo real do relatório: par 18–33, observado **9**, esperado **2,54** (3,5× mais frequente), `p = 0,0012`. Ao corrigir para as 1.770 comparações: **`q = 1,00`**. Ou seja, com 1.770 pares testados, esperam-se ~2 ocorrências desse tamanho por puro acaso. O "padrão" não existe.

### 4.4 🟠 Backtest: ruído da baseline e ausência de poder estatístico

Dois problemas combinados:

**(a) Comparação injusta.** O teste t pareado confrontava o modelo com **uma** aposta aleatória por concurso. O desvio-padrão de uma aposta aleatória (0,70 acertos na Mega) é o mesmo da série do modelo — o ruído da baseline, portanto, era metade do ruído total do teste. **Correção:** média de 12 apostas aleatórias por concurso (parametrizável), reduzindo o desvio da baseline por √12.

**(b) Nenhuma informação sobre poder.** O backtest rodava 30 concursos e reportava `p`. Mas com 30 concursos a Mega-Sena só detectaria vantagens de **+53%**. O relatório não dizia isso.

**Correção:** novo `theoreticalBenchmark` — teste Z contra a **média e o desvio-padrão hipergeométricos exatos** (nulo analítico, sem ruído de amostragem) e novo bloco `sampleAdequacy` com MDE, poder observado e tamanho de amostra necessário:

| Modalidade | E[acertos] | σ | MDE (n=30) | MDE (n=100) | MDE (n=400) | n p/ detectar +10% |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Lotofácil (15/25) | 9,00 | 1,225 | ±0,56 (6%) | ±0,30 (3%) | ±0,15 (2%) | 12 |
| Mega-Sena (6/60) | 0,60 | 0,703 | ±0,32 (53%) | ±0,18 (29%) | ±0,09 (15%) | **849** |
| Quina (5/80) | 0,31 | 0,527 | ±0,24 (77%) | ±0,13 (42%) | ±0,07 (21%) | **1.761** |
| Lotomania (50/100) | 10,00 | 2,010 | ±0,91 (9%) | ±0,50 (5%) | ±0,25 (2%) | 25 |

Interpretação direta: **com 30 concursos de Mega-Sena não existe precisão possível** — qualquer "melhoria" reportada é ruído. Foi por isso que o backtest passou a usar a janela disponível (até 200 concursos) e o motor trocou `analyze` por `analyzeFast` no laço (7,5 ms → 1,3 ms por análise, ~5,7× mais rápido), o que tornou esse aumento de amostra viável.

### 4.5 🟠 Teste t pareado com falso positivo garantido

```js
// ANTES
if (seDiff === 0 || isNaN(seDiff)) {
    const isModelBetter = meanDiff > 0;
    return { pValue: isModelBetter ? 0.0001 : 1.0,
             statisticallySignificant: isModelBetter, ... };
}
```

Se o modelo acertasse sempre exatamente 1 a mais que a baseline **3 vezes**, o sistema declararia `p = 0,0001` e "superioridade estatística". Além disso, o p-value era truncado em `1e-6` (impossibilitando reportar evidência mais forte) e calculado a partir de médias **já arredondadas** a 2–4 casas.

**Correção:** teste t calculado sobre os valores não arredondados; no caso degenerado, **teste de sinais (binomial exato)** — matematicamente válido para diferenças constantes (6 acertos consistentes → `p = 0,015625`, não 0,0001); limite inferior de p em `1e-16`; exposição de `pValueTwoSided`, `observedPower` e `minimumDetectableEffect` em cada resultado.

### 4.6 🟡 χ² e as aproximações que custam precisão

O p-value do teste de uniformidade usava a aproximação de Wilson-Hilferty combinada com uma tangente hiperbólica. Comparação com a gama incompleta regularizada (exata):

| χ² | gl | p aproximado (antes) | p exato (depois) | Erro |
| ---: | ---: | ---: | ---: | ---: |
| 3,841 | 1 | 0,0649 | 0,0500 | **+30%** |
| 18,307 | 10 | 0,0673 | 0,0500 | **+35%** |
| 43,773 | 30 | 0,0675 | 0,0500 | **+35%** |

O erro era **sistemático e crescente**: quanto mais evidência contra a uniformidade, mais o teste antigo hesitava em rejeitá-la. Somado ao corte `p > 0.05` para `isUniform`, isso significa que uma tabela de frequências com evidência exatamente limítrofe era classificada como "uniforme".

**Correção:** `StatisticalInference.chiSquareSurvival()` via gama incompleta regularizada (série + fração continuada de Lentz, erro < 1e-15), mais **V de Cramér** (tamanho de efeito) e **resíduos padronizados** com as dezenas realmente fora do padrão (|z| ≥ 3).

### 4.7 🟡 Viés de seleção na otimização de pesos

`optimizeWeights` testava 24 variações de pesos e escolhia a melhor pelo desempenho **no bloco de validação** — e reportava esse mesmo número como desempenho fora da amostra. É a definição de viés de seleção: o vencedor é necessariamente o que mais se ajustou ao ruído daquele bloco.

**Correção:** divisão temporal em três blocos — treino (65%) / validação (30%) / **teste às cegas (15%, o mais recente)**. O bloco de teste não participa da escolha. O resultado passa a expor `testMean`, `baseTestMean`, `selectionGap` (queda da validação para o teste) e `selectionBiasWarning` quando a queda passa de 0,5 acerto.

### 4.8 🟡 Fallbacks arbitrários no score composto

Dois fatores usavam desvios-padrão inventados quando a estatística histórica não estava disponível:
- paridade: `stdDev = 1.5` fixo;
- soma: `0,12 × média`.

Ambos foram substituídos pelas expressões **exatas** (`sqrt(k·(N−k)·(N+1)/12)` para a soma; hipergeométrica para a contagem de pares). Impacto prático maior na Lotomania (50 de 100), onde `0,12 × 2.550 = 306` contra o desvio real de ~293 — erro pequeno aqui, mas o `1.5` de paridade na Lotofácil (onde o desvio real é ~1,9) penalizava jogos legítimos.

### 4.9 🟡 `dataLeakageDetected: false`

O relatório exibia "Data Leakage: NÃO DETECTADO (✅)" como se fosse o resultado de uma verificação. Era uma **constante**. Agora `runBacktest` verifica em cada concurso (a) se o gerador recebeu exatamente `i` concursos e (b) se o concurso mais recente entregue é o `i-1` — detecção de *off-by-one*, que é a forma real de vazamento nesse desenho — publicando `leakageCheck: { violations, evaluatedDraws }`.

---

## 5. O que a auditoria **não** mudou (e por quê)

É importante registrar o que está **correto** no projeto, para não "consertar" o que funciona:

- **`statisticalInference.js` é sólido.** Lanczos para log-gama, fração continuada de Lentz para beta incompleta, CDF de Student exata, intervalo de confiança dinâmico (t para n < 30, Z para n ≥ 30), Cohen's d, bootstrap determinístico por PRNG semeado. O problema nunca foi a matemática de base — foi o que se fazia com ela.
- **`ProbabilityEngine.hypergeometric`** calcula a distribuição de acertos exata, com intervalos preditivos e odds por faixa de premiação. É a peça mais honesta do sistema.
- **`forecastPolicy.js`** já nasceu com a postura certa: nunca promete ganho, exige histórico mínimo e backtest significativo.
- **Segurança do backend** está acima da média: consultas parametrizadas, whitelist de tabelas/colunas (`server/tables.js`), bcrypt custo 12, tokens de sessão armazenados apenas como SHA-256, comparação em tempo constante (`timingSafeEqual`), rate limit por IP e e-mail, cookies `HttpOnly; SameSite=Lax`, CSP e `X-Frame-Options` no `vercel.json`.
- **Determinismo e reprodutibilidade** são tratados como requisito (PRNG Mulberry32 semeado, testes específicos para isso). Excelente prática, raramente vista.

---

## 6. Roadmap recomendado (ganho de precisão, em ordem)

### Prioridade máxima — corrigir a lógica de inferência

**6.1 Multiplicidade da seleção de janelas (achado #11) — ✅ implementado.**
`runBestGameMode` testa 5 janelas temporais e escolhia a de melhor backtest, devolvendo **o p-value do vencedor** como se fosse um teste único — *p-hacking* estrutural (com 5 tentativas, a chance de ao menos uma parecer significativa a α=0,05 sobe para ~23%). Agora cada janela é registrada em `modelPipeline.selectionCorrection` com seu p-value bruto **e** corrigido por **Holm-Bonferroni**, mais `anyWindowSignificantAfterCorrection` e `familyAdjustedPValueForWinner`. Bônus: o modo passou a preservar o próprio backtest (antes ele era descartado e a política caía em `INSUFFICIENT_BACKTEST`, escondendo a evidência coletada).

**6.2 Inferência sequencial (always-valid p-values) — ✅ implementado.**
O usuário pode clicar em "gerar" repetidamente e trocar a janela até gostar do resultado. Com testes clássicos, olhar repetidamente infla o erro tipo I indefinidamente. *Correção:* mSPRT / testes sequenciais com correção de α sobre o número de gerações, ou um "orçamento de α" por sessão.

*Implementado* em `js/engine/sequentialTestEngine.js` (29 testes; documentação completa
em [INFERENCIA_SEQUENCIAL.md](./INFERENCIA_SEQUENCIAL.md)). A inflação não era hipotética:
em **300 séries de 120 olhadas sem nenhum sinal**, o t-test clássico aplicado a cada
prefixo acusou significância em **56,3%** das séries, com α nominal de 5%. Com o p
always-valid (mSPRT, e-value com p = min(1, 1/Λ)), as mesmas séries erram em **3,7%** —
abaixo do α nominal, como a teoria exige.

Três decisões que o resultado tornou obrigatórias:

- **σ não pode vir dos dados que estão sendo testados.** A primeira versão estimava σ
  no mesmo prefixo: uma amostra de dois pontos com desvio-padrão ~0 transformava
  qualquer média ≠ 0 em "sinal". Falso-positivo medido: **100%** em ruído puro.
  Agora os primeiros 20 concursos formam um bloco de aquecimento que estima σ e
  **não é monitorado** — e quando o bloco não tem variabilidade, o motor declara o
  teste indisponível com motivo em vez de inventar um piso numérico.
- **O custo em poder é real e está no relatório.** A 200 concursos: 0,3 acerto →
  30% de detecção (clássico: 60%); 0,5 → 73% (96%); 0,9 → 99% (100%). Poder olhar
  quantas vezes quiser custa sensibilidade — não existe versão gratuita.
- **O orçamento de α da sessão** cobre as olhadas discretas do app (gerar, trocar
  janela, trocar estratégia). Em vez de Bonferroni — que só vale se o número de
  olhadas for fixado de antemão, exatamente o que o usuário não faz — usa gasto
  quadrático, `α_m = α·(6/π²)/m²`, cuja soma sobre **infinitas** olhadas é α. A
  primeira olhada recebe 0,0304; a segunda, 0,0076; a décima, 0,0003.

O `BacktestEngine` passou a devolver `sequentialAnalysis` (p always-valid, IC
sequencial, primeira olhada que cruzaria α) ao lado do p clássico, e o relatório
estatístico mostra os dois com o rótulo do que cada um vale. Um teste garante que o
intervalo sequencial e o p nunca se contradizem, já que saem do mesmo e-value.

**6.3 Encolhimento bayesiano (empirical Bayes / James-Stein) das frequências — ✅ implementado.**
As dezenas são ranqueadas por frequência bruta, mas a diferença entre "a mais quente" e "a mais fria" em 100 concursos está quase toda dentro do erro amostral. *Correção:* estimar `p_i = (count_i + α·p0) / (n + α)` com `α` calibrado pelo histórico (equivalente a um prior Dirichlet-multinomial). Isso substitui "quente/frio" por **posterior com intervalo de credibilidade** — a única forma honesta de mostrar esse tipo de métrica. O cartão "🔥 Quentes" deveria exibir a incerteza, não só 5 números.

*Implementado* em `js/engine/bayesFrequencyEngine.js`: modelo Beta-Binomial com
`κ` estimado por método dos momentos (sem constante calibrada à mão), intervalo
de credibilidade corrigido por Bonferroni para as 25/60/80/100 dezenas testadas
ao mesmo tempo, e — decisão importante — o intervalo **exibido** é a união do
credível com o de Wilson, para que o encolhimento nunca estreite um intervalo
além do que o histórico sustenta. Os cartões 🔥/🧊 agora mostram
`bruto → estimativa · IC 95%` e há um cartão novo, 🎯 Frequência × Ruído, com
quantas dezenas sobrevivem à correção. Documentação e números em
[FREQUENCIAS.md](./FREQUENCIAS.md).

**6.4 Reduzir o peso dos fatores sem evidência — ✅ implementado.**
`markov` carrega 0,10 do score e `cooccurrence` 0,11 — mas a auditoria demonstrou que **nenhuma** transição de Markov sobrevive ao FDR em dados aleatórios, e que a co-ocorrência de pares é indistinguível de independência. Fatores que não podem ser distinguidos de ruído não deveriam somar 21% da decisão. *Correção:* encolher cada peso na proporção da evidência disponível (`peso_i ∝ força da evidência_i`), zerando-os quando o teste não rejeita H0.

*Implementado* em `js/engine/evidenceWeightingEngine.js`. O portão é aplicado tanto no
**score** (`ScoringEngine.evaluateGame`) quanto na **amostragem de dezenas**
(`GameGenerator.generateSingleCandidate`) — de nada adiantaria tirar o fator do score e
deixá-lo guiando a geração. Depois do corte, os pesos restantes são renormalizados para
somar 1. Há uma distinção preservada de propósito: **ausência de teste não é evidência de
ausência** — com histórico curto o teste não roda, o fator mantém o peso e o relatório
registra `assessed: false`. Zerar nesse caso só trocaria um erro por outro.

O relatório estatístico (painel de transparência) passou a exibir:
`Ponderação por Evidência: markov + cooccurrence zerado(s) · 26% do score redistribuído`.

**Medição antes/depois** — Lotofácil, janela de 150 concursos, 2 sementes
(os `optimizedWeights` do otimizador atribuíam **26%** aos dois fatores: markov 8,9%,
co-ocorrência 17,2%):

| Condição | Média acertos | Baseline | Melhoria relativa | p-valor | Acertos ≥ 11 |
|---|---|---|---|---|---|
| Sem ponderação | 9,0667 | 8,9900 | +0,95% | 0,194 | 17 |
| Com ponderação | 8,8933 | 8,9900 | −0,98% | 0,799 | 17 |

**Como ler esta tabela:** nenhuma das duas condições é estatisticamente distinguível da
baseline aleatória — que é exatamente o que a teoria prevê. O MDE do experimento é de
0,2486 acertos (2,8% com 80% de poder), e a diferença entre as condições (0,173 acertos)
está **abaixo** desse limite: o backtest não tem poder para dizer que uma é melhor que a
outra. A conclusão honesta é que **a mudança não melhora nem piora o desempenho** — ela
remove uma afirmação que não se sustentava. Os jogos gerados mudaram (0 de 10 idênticos),
todos estruturalmente válidos (15 dezenas únicas, paridade e soma dentro da faixa).

O que se ganha, portanto, não é vantagem: é que 26% do peso deixe de ser decidido por
sinal que não passou no próprio teste do sistema.

### Prioridade alta — dados e validação

**6.5 Substituir o preenchimento sintético por estado vazio honesto.** Remover `ensureMinimumHistoryDepth`; exibir "histórico insuficiente para inferência" e oferecer sincronização. Validar continuidade dos concursos (sem lacunas, sem duplicatas) e armazenar um checksum por lote importado.

**6.6 Teste de permutação do pipeline completo — ✅ implementado.** Além do nulo analítico por concurso, embaralhar a ordem temporal do histórico N vezes e rodar o pipeline inteiro. Se o desempenho observado estiver dentro da distribuição nula, isso é conclusivo — e comunica melhor que um p-value.

*Implementado* em `js/engine/permutationTestEngine.js`, com botão próprio no painel
de padrões (roda no Web Worker, ~5 s) e 16 testes. A lógica: embaralhar a ordem dos
concursos 99 vezes, rodar o pipeline inteiro em cada versão e comparar com a ordem real.

**Por que isso é melhor que o p-valor do backtest:** o backtest pergunta "o modelo acerta
mais que um bilhete sorteado ao acaso?" — resposta que é sempre "não", porque todo bilhete
tem a mesma chance. O teste de permutação pergunta "o modelo usa a *ordem* do histórico?",
e o nulo é construído pelo próprio pipeline, absorvendo seus vícios (viés de paridade,
restrições de soma, janelas deslizantes) — coisas que um nulo analítico ignora e que
podem criar vantagem aparente sem sinal real.

**Calibração verificada** (20 históricos i.i.d. independentes): z médio **−0,04** (esperado 0),
desvio-padrão de z **0,91** (esperado 1), e **0 de 20** testes declarando significância a 5%.
O teste não inventa sinal onde não há.

**Execução real** (Lotofácil, 200 concursos, 99 permutações, janela 30):
observado **8,933** acertos/concurso contra nulo **8,973 ± 0,207** (IC 95%: 8,548–9,333),
z = −0,19, **p = 0,59**. O pipeline não extrai informação da ordem temporal.

**Detalhe de potência que quase passa batido:** com R permutações, o menor p alcançável é
`1/(R+1)`. Com 19 permutações o mínimo é 0,05 — que **não é** menor que α = 0,05, então o
teste fica estruturalmente incapaz de rejeitar. O motor detecta isso e avisa
(`underpowered`, `runsNeededForAlpha = ⌊1/α⌋ = 20`) em vez de devolver um "não
significativo" que na prática significa "faltou permutação".

O teste roda **sob demanda**, nunca no caminho de geração: cada estatística executa o
pipeline completo sobre um histórico embaralhado (~1,3 ms por concurso avaliado).

**6.7 Fonte oficial dos dados — ✅ implementado.** O espelho `loteriascaixa-api.herokuapp.com` é um serviço de terceiros em Heroku (risco de descontinuação). O endpoint oficial da Caixa (`servicebus2.caixa.gov.br`) está na CSP mas é usado só como fallback. Inverter a ordem e cachear no Neon com validação de esquema.

*Implementado* em `js/services/drawSourcePolicy.js` (compartilhado entre navegador e
servidor), com 34 testes e nenhuma chamada de rede nos testes.

**O achado principal: a prioridade era fictícia.** No servidor, a escolha entre fontes era
`Promise.any([caixa, mirror])` — que retorna **a primeira resposta que chegar**, não a
primeira da lista. O espelho, sendo mais rápido, vencia quase sempre. A ordem do array
sugeria "oficial primeiro" e não significava nada. Agora a resolução é **sequencial**:
tenta a oficial, só então a seguinte. Um teste de regressão garante que o espelho
respondendo em 1 ms não derrota a oficial respondendo em 20 ms — e que o espelho nem
chega a ser consultado quando a oficial responde.

**A limitação real que precisava ser dita:** o endpoint oficial **não publica histórico
completo** (só o último concurso) e **não envia cabeçalhos CORS**, então no navegador ele
falha por política do browser. A política declara isso como capacidade
(`supportsHistory`, `corsFromBrowser`) em vez de deixar escondido numa URL. Consequências:
no servidor a ordem é oficial → espelho; no navegador a oficial é tentada primeiro mesmo
assim (a falha de CORS é imediata, custa uma viagem de rede) e cai para o espelho — se um
dia a Caixa habilitar CORS, nada precisa mudar. E o **histórico completo depende do
espelho**: isso é uma dependência real, agora documentada.

**Validação de esquema estrita** (`validateDraw`): concurso inteiro positivo, exatamente
`drawn` dezenas, dentro do intervalo, sem repetição. O registro inválido é **rejeitado com
motivo** (`esperadas 15 dezenas, recebidas 3`, `dezena fora do intervalo 1..25`, …) em vez
de ser filtrado até "parecer válido" — aceitar parcialmente um sorteio corrompido contamina
todas as estatísticas calculadas depois.

**Degradação é declarada, não silenciosa.** `resolveLatest` devolve `sourcesTried`,
`errors` e `degraded`; `/api/lottery/sync` repassa isso. Servir cache sem avisar seria
pior que falhar: o usuário analisaria uma base desatualizada sem saber.

**Bug latente encontrado no caminho:** o cliente lia `serverSync.synced[type].latest`, mas
o servidor devolve `lotteries[type].draws`. A chave nunca existiu — o concurso
recém-sincronizado era descartado em silêncio e `lastResult` era sempre `null` em modo
servidor. Corrigido, com aviso de degradação no console quando todas as fontes falham.

### Prioridade média — anti-crowd com base empírica

**6.8 Substituir as constantes do `AntiCrowdEngine` por dados — ✅ implementado (opção a + suporte à opção b).** As afirmações ("~65% das apostas concentram-se em…", penalidade de 0,25 para dezenas > 31) são plausíveis na literatura (Ziemba, Haigh, Cook & Clotfelter) mas estão **hardcoded sem fonte e sem calibração**. Duas saídas possíveis: (a) citar as fontes no código e nos comentários, mantendo os pesos como *priors* declarados; (b) calibrar com dados reais de popularidade (volumes de aposta por dezena, quando disponíveis em transparência da Caixa). A opção (a) é barata e já elimina a aparência de precisão fabricada.

*Implementado:* todas as constantes foram extraídas para `CROWD_PRIORS`, cada uma com
`basis` (`literatura` / `arbitrário` / `sem fonte`), `source` e `note`. O saldo é
desconfortável e agora está visível: **7 direções têm suporte publicado, 20 magnitudes não
têm** nenhum. As fontes citadas (registro `CROWD_SOURCES`) são Cook & Clotfelter (1993),
Clotfelter & Cook (1993), Haigh (1997), Simon (1998) e Ziemba et al. (1986) — todas sobre
loterias do Reino Unido e da América do Norte, **nenhuma sobre o Brasil**.

Duas afirmações foram **removidas** por não terem fonte:

- *"~65% das apostas humanas concentram-se em…"* — número sem origem verificável; saiu do
  cabeçalho e virou declaração de que a direção dos vieses é documentada.
- *"combinações com score alto têm até 2,4x menos divisões esperadas"* — não verificado e
  provavelmente falso na magnitude. O multiplicador de EV agora é descrito como o que é:
  uma escala para **ordenar** bilhetes por popularidade estimada, não uma promessa de
  valor esperado.

**Calibração pronta para uso (`AntiCrowdEngine.setCalibration`)**: recebe popularidade
observada por dezena + tamanho da amostra e passa a encolher o prior em direção ao dado,
com `λ = n/(n + 100.000)`. Com `n = 0` o prior é tudo; com `n = 10⁸`, 99,9% vem do dado.
`clearCalibration()` restaura exatamente o comportamento anterior.

**Por que não calibrei agora:** as fontes públicas consultadas neste projeto não expõem
volume de apostas por dezena. Inventar popularidade sintética e chamar de calibração seria
repetir o problema que este item existe para corrigir. Até existir dado real, o motor
reporta `calibrated: false`, e o relatório estatístico exibe:

```
Prêmio Sozinho (Anti-Crowd): prior de literatura —
7 direções documentadas, 20 magnitudes sem verificação
```

19 testes novos, incluindo um que impede um prior de `basis: 'literatura'` de existir sem
fonte citável.

### Prioridade média — engenharia

**6.9 CI + lint — ✅ implementado (CI).** Não havia workflow. Um `.github/workflows/ci.yml` de 15 linhas (`npm ci`, `npm test`, `npm run build`) impede regressões como o bug de intervalo, além de ativar Dependabot. Adicionar ESLint + Prettier (o código é consistente, a adoção tende a ser indolor).

*Implementado parcialmente:* `.github/workflows/ci.yml` com matriz Node 20/22
(`npm ci` + `npm test` + `npm run build`) e um job de guardas (`npm audit
--audit-level=high`, `node --check` em `js/`, `api/` e `server/`, e proibição de
`Math.random` no código de produção para preservar a reprodutibilidade).
O guarda de `Math.random` já reprovou um defeito real: `tests/backtest.test.js`
gerava histórico mock sem semente. **ESLint + Prettier seguem pendentes** —
exigem uma passada de formatação sobre todo o código, que merece commit próprio.

**6.10 Performance de memória — ✅ implementado.**
`analyze()` monta matrizes O(N²) de objetos (`pairMatrix` = 4.950 objetos na Mega, 4.950 na Quina, 10.000 na Lotomania) mais um array de todos os pares ordenado. *Correção:* `Int32Array(total*total)` triangular + memoização por `(últimoConcurso, janela)`.

*Correção do diagnóstico acima:* os números de objetos citados na primeira versão desta
auditoria estão errados. Pares são `C(total,2)` — **1.770** na Mega, **3.160** na Quina,
**4.950** na Lotomania. O valor 10.000 atribuído à Lotomania é a matriz **de Markov**
(`nextDrawGivenPrev`, `total²`), que a auditoria não contou e que era construída com um
objeto por célula tanto em `analyze()` quanto em `analyzeFast()`. Total real por chamada
na Lotomania: **19.900 objetos** (4.950 pares + 4.950 `topPairs` + 10.000 Markov).

*Implementado* em `js/engine/pairMatrix.js` e `js/engine/statisticalAnalyzer.js`
(18 testes; medições em [DESEMPENHO_ANALISE.md](./DESEMPENHO_ANALISE.md)):

- **`PairCountMatrix`**: um `Int32Array` de `(total+1)²` — **40 KB** no pior caso, em vez
  de milhares de objetos. `get`/`increment` normalizam `{a,b}`/`{b,a}` para a mesma célula.
- **Top-30 por seleção estável**, sem materializar `C(n,2)` objetos e ordená-los — a ordem
  é idêntica à de um `sort` decrescente estável, empates inclusive.
- **Markov em `Int32Array`**: a matriz `total × total` de contadores deixou de ser um objeto
  por célula. Como ela nunca saía da função, nada mais precisava saber.
- **`analyzeCached()`**: LRU de 4 janelas, chave `(total, pick, drawn, tamanho, concurso
  mais recente, mais antigo)`. Explícita (não escondida dentro de `analyze`), com
  `invalidateAnalysisCache()`, retorno em cópia defensiva das listas mutáveis e a
  heurística da chave documentada — se o miolo do histórico mudar sem alterar as pontas
  nem o tamanho, a cache não percebe.

O ganho é de **churn de alocação**, não de complexidade: o laço continua O(total²). Medido
no mesmo hardware, commit anterior × atual — heap retido 1,19 → 0,89 MB (Lotomania, 300
concursos), backtest de 200 concursos 3.802 → 3.416 ms (−10%), e cinco cálculos da mesma
janela 613 → 1 ms. Uma chamada isolada de `analyze` fica no mesmo patamar (117 → 111 ms),
e afirmar mais que isso seria inventar.

Um backtest de 200 concursos da Lotomania alocava ~2,99 milhões de objetos descartáveis;
agora aloca 200 buffers. Os resultados **não** mudaram: os testes comparam contagens,
top-30 e probabilidades de Markov contra implementações de referência escritas à parte.

**6.11 Decompor a interface — ✅ implementado.**
`index.html` tem 32 KB com markup e lógica de apresentação embutidos. Separar em componentes (ou ao menos templates) facilita auditar e testar a camada visual, hoje sem cobertura.

*Correção do diagnóstico:* o arquivo tem **34 KB / 555 linhas** e **não** contém lógica de
apresentação embutida no sentido literal — zero `onclick`, zero `<script>` inline, um único
módulo no fim do documento. O problema era outro e maior: **116 ids**, 44 botões, 6 canvas e
17 campos num único blob, sem nenhuma forma de verificar se o JS ainda encontra o que procura.
Testar "este botão existe" era impossível, porque não há como importar um `.html` em Node.

*Implementado* em `js/views/templates/` + `scripts/build-html.mjs` (20 testes; detalhes em
[INTERFACE.md](./INTERFACE.md)). O markup virou **9 módulos puros** (cabeçalho, login, overlay,
casca, três telas, modais, fechamento), `document.js` monta o documento e o `index.html` passou
a ser **saída de build** — byte a byte idêntica ao arquivo anterior, então a divisão não mudou
nada do que o navegador recebe.

O ganho real está nos testes, que antes não existiam:

- o `index.html` versionado é exatamente o que os templates geram (deriva entre fonte e saída
  é o jeito mais silencioso de perder uma tela);
- **89 ids procurados pelo JS conferidos contra os 116 do documento** — a única exceção é
  `printNowBtn`, que pertence à janela de impressão criada em runtime (`win.document`);
- todo `data-action` tem handler e nenhum handler ficou órfão (as duas direções);
- `data-screen` ↔ `id="screen-*"`, `data-tab` ↔ `id="stat-*"`, as 9 estratégias contra o
  despacho do motor, e as loterias contra `LotteryModel.CONFIG`;
- acessibilidade mínima (label ↔ id, campo com id, botão com texto, canvas com id) e higiene
  (sem `onclick` inline, um único script de aplicação, dependência externa só por HTTPS).

Deliberadamente **não** troquei o HTML estático por renderização em runtime: a tela ficaria em
branco até o módulo executar e, sem JS, sumiria até o aviso de responsabilidade — justamente o
texto que precisa existir sempre.

### Prioridade baixa

**6.12 Encerrar o `legacyHash` — ✅ implementado.** O hash legado (`h_…`, baseado em deslocamento de bits + base64 da senha) é reversível em milissegundos. Ele existe para migrar contas antigas — mas sem prazo, é uma porta aberta permanente. Definir data-limite e forçar redefinição de senha.

*Implementado:* a data-limite é **31/01/2027** (`LEGACY_HASH_SUNSET_ISO`), e ela vive num
módulo só — `shared/passwordPolicy.js` — importado pelo servidor (`server/security.js`) e
pelo cliente (`js/models/user.js`). Duas cópias da mesma data seriam duas chances de esquecer
uma delas.

- **antes do prazo**: o formato é aceito, a senha é convertida para bcrypt (API) ou PBKDF2
  (offline) no mesmo login, e a resposta leva `passwordUpgraded: true` — a interface avisa o
  usuário e manda definir uma senha nova enquanto ainda dá;
- **a partir do prazo**: a verificação é recusada **sem calcular o hash antigo**. O prazo é
  checado antes do cálculo justamente para não deixar no código um oráculo que confirme
  senhas a partir de um dump antigo. Há teste estrutural para essa ordem, não só para o
  resultado;
- **o resto do sistema não muda**: bcrypt e PBKDF2 continuam valendo depois do prazo, e uma
  conta convertida antes dele nunca mais esbarra na data.

Duas decisões de discrição: o login devolve a **mesma** mensagem de senha errada quando o
formato venceu — dizer "sua conta é antiga" transformaria qualquer senha num oráculo de
existência de conta; o motivo real vai para o log. Já em `change-password` e
`delete-account`, onde a sessão já está autenticada, a mensagem pode ser específica, e é.

E o prazo tem um alarme: `tests/legacyHashSunset.test.js` passa hoje com um diagnóstico
dizendo quantos dias faltam e, **no dia do vencimento, falha** se o verificador legado ainda
estiver no código. Prazo que não quebra nada não é prazo — é intenção. O teste também cobre
os dois lados da data com relógio injetado, para a suíte não envelhecer junto.

**Antes do vencimento, o dono do projeto precisa saber quantas contas ainda estão no formato
antigo** — a consulta está em [SECURITY.md](./SECURITY.md). Conta dormente que não fizer
login até a data fica sem acesso e precisa de redefinição pelo suporte: é o custo honesto de
encerrar um formato cuja senha já pode ter vazado.


**6.13 CSRF/Origin — ✅ implementado.** `SameSite=Lax` já bloqueia POST cross-site; adicionar verificação de `Origin`/`Sec-Fetch-Site` nos endpoints de mutação fecha a borda.

*Implementado:* a checagem que existia era pior que nenhuma — `if (origin && new URL(origin).host !== req.headers.host)`
é **fail-open** (requisição sem `Origin` passava direto), estourava 500 com `Origin: null`
e ignorava `Sec-Fetch-Site`. A política saiu do handler para `server/originPolicy.js`, uma
função pura e sem dependências, e virou **fail-closed** para `POST`, `PUT`, `PATCH` e `DELETE`:

- `Sec-Fetch-Site: cross-site` → nega, sem olhar mais nada;
- `Origin` ausente, vazio, `null`, malformado ou com esquema não-HTTP(S) → nega;
- `Origin` em `ALLOWED_ORIGINS` (lista opcional por env, separada por vírgula) → aceita;
- caso contrário, o host do `Origin` precisa estar entre `Host` e `X-Forwarded-Host` da requisição.

Mutação também passa a exigir `Content-Type: application/json` (415 se faltar), o que fecha
o furo do formulário HTML simples — o único tipo de requisição cross-site que não sofre
preflight. O 403 agora devolve `{ reason }`, para o log dizer *por que* negou em vez de só
*que* negou. `tests/csrf.test.js` cobre 22 casos: as decisões da política isoladas (inclusive
`Origin: null`, host desconhecido e `ALLOWED_ORIGINS`) e a borda do handler com requisição
falsa, sem tocar no banco. A defesa em camadas está descrita em
[SECURITY.md](./SECURITY.md): `SameSite=Lax` (cookie) → `Origin`/`Sec-Fetch-Site` (borda) →
`Content-Type` (anti-formulário).


**6.14 Atualizar a documentação — ✅ implementado.**
`AUDIT_REPORT.md` afirma "4 suítes passando" e "12 de 12 problemas resolvidos". Hoje são 29 arquivos de teste e 429 testes — e a auditoria atual encontrou 11 defeitos adicionais. Um relatório desatualizado é pior que nenhum.

*Implementado:* o `AUDIT_REPORT.md` foi **mantido como registro histórico e corrigido**
(ver [DOCUMENTACAO.md](./DOCUMENTACAO.md)). Três decisões:

- os números de teste da seção 3 ficaram rotulados como **saída da época** (4 casos), com o
  comando atual ao lado — apagar o registro histórico seria perder a evidência de que uma
  suíte de 4 casos sustentava afirmações grandes;
- as duas frases da seção 4 que **não se sustentaram** ("o modelo adaptativo apresentou o
  melhor alinhamento multifatorial" e "melhoria observada") foram substituídas pelas
  medições que existem hoje: sem ponderação +0,95% (p = 0,194), com ponderação −0,98%
  (p = 0,799), teste de permutação z = −0,19 (p = 0,59). Afirmar vantagem inexistente é pior
  que um relatório velho;
- este documento perdeu os números fixos que envelheciam: o cabeçalho agora traz um marcador
  (`<!-- suite: arquivos=N testes=M -->`) e `tests/docs.test.js` **falha na CI** se os
  documentos divergirem dos testes reais, se um link interno apontar para arquivo inexistente
  ou se um documento prometer previsão de dezenas. A verificação cara (rodar a suíte e
  comparar o total) entrou como passo próprio do job de guardas com `DOCS_VERIFY_SUITE=1`;
  localmente ela é pulada para não dobrar o tempo de `npm test`.
- de quebra, a CI passou a rodar `npm run check:html` — se alguém editar o `index.html` em
  vez dos templates, a divergência aparece no mesmo job.

A seção 11 registra o estado de cada item do roadmap e é a fonte única da verdade sobre
quantos testes existem.

---

## 7. O teto de precisão: a matemática que limita o projeto

Esta seção existe porque a auditoria técnica seria incompleta sem ela.

Em um sorteio idôneo, cada combinação válida tem **exatamente a mesma probabilidade**. Não existe modelo, histórico, IA ou teoria dos jogos que altere `1 / C(60,6) = 1 em 50.063.860`. Qualquer melhoria de "precisão preditiva" nesse sentido é matematicamente impossível — e o projeto, corretamente, já não promete isso.

Portanto, "precisão" aqui só pode significar quatro coisas legítimas, e é **nelas** que o esforço deve se concentrar:

1. **Precisão do processo** — o que esta auditoria atacou. Um p-value errado, um atraso mal medido ou um dado fabricado produzem conclusões falsas mesmo em um domínio onde a conclusão verdadeira é sempre "não há vantagem". A precisão do processo é o que separa *ferramenta estatística* de *gerador de números com aparência científica*.

2. **Redução de variância do portfólio** — jogos com alta diversificação (Jaccard baixo) não aumentam a chance de ganhar, mas tornam o resultado menos concentrado. Essa é uma métrica real e mensurável, e o projeto já a calcula corretamente (`calculateDiversificationScore`, matriz de fechamento com cobertura de pares).

3. **Valor esperado financeiro** — a única alavanca matematicamente real. `E[V] = P(ganhar) × Prêmio / E[ganhadores]`. Como `P(ganhar)` é constante, o único termo controlável é **`E[ganhadores]`**: jogar combinações menos populares aumenta o valor esperado porque reduz o rateio. A teoria está certa e o módulo `antiCrowdEngine` aponta na direção correta — mas precisa de calibração empírica (item 6.8) para ser mais que heurística.

4. **Custo** — apostar menos por concurso é a única variável que melhora o resultado esperado de forma garantida e determinística.

O valor real deste software é o que ele já faz bem: **demonstrar com rigor que as estratégias não batem o aleatório**, calcular probabilidades exatas, dimensionar o custo, e proteger o usuário de ilusões numéricas. Um sistema que diz "não há vantagem, e aqui está a prova estatística" é infinitamente mais útil do que um que exibe "Confiança: 99,9%". A auditoria moveu o projeto firmemente na primeira direção.

---

## 8. Como validar

```bash
npm install
npm test            # 429 testes em 29 arquivos, incluindo tests/precisionAudit.test.js (38)
npm run build       # build de produção
```

Os testes de precisão validam valores de referência independentes:

| Verificação | Referência externa | Tolerância |
| :--- | :--- | :--- |
| `χ²(3,841; gl=1)` | 0,0500 (tabela) | < 0,001 |
| `P(X ≥ 60 \| n=100, p=0,5)` | 0,028444 (tabela binomial) | < 1e-5 |
| `P(X ≥ 75 \| n=100, p=0,5)` | 2,8181e-7 | < 0,1% |
| q-values BH | `p.adjust(method="BH")` do R | < 1e-4 |
| `Φ⁻¹(0,975)` | 1,959964 | < 1e-6 |
| Taxa de falso positivo do teste Z | ~5% sob H0 | 3%–7% (Monte Carlo) |

Além disso, `tests/precisionAudit.test.js` reproduz o caso controlado que expõe o bug de intervalos (saídas a cada 10 concursos → `avgDelay` deve ser 10, não 15) e verifica que séries aleatórias **não** produzem sinais de Markov nem pares significativos.

---

## 9. Diferenças em relação ao `AUDIT_REPORT.md` existente

O relatório anterior declarava 12 problemas corrigidos e "4 suítes passando". A presente auditoria:

- **confirma** que os 12 problemas originais foram de fato tratados (todos os módulos existem e funcionam);
- **identifica 11 defeitos adicionais** introduzidos ou remanescentes naquela implementação — inclusive um que produz dados falsos;
- **corrige a alegação de "melhoria observada"**: o `AUDIT_REPORT.md` afirma que o modelo adaptativo apresentou "o melhor alinhamento multifatorial", mas nenhum teste de significância sustentava isso. Com o nulo analítico agora implementado, a conclusão correta é a que `ForecastPolicy` já emitia: **sem evidência de vantagem sobre o aleatório**. Isso não é um defeito do projeto — é o resultado científico honesto, e agora está demonstrado em vez de afirmado.

---

**Resumo final:** 11 defeitos corrigidos nesta auditoria (a suíte tinha então 151 testes), build limpo. Números atuais na seção 11. O projeto ganhou precisão não por adicionar complexidade, mas por remover três fontes de erro: um cálculo errado, testes que não testavam nada, e dados que não eram dados.

---

## 10. Adendo — Módulo de Projeções Futuras (v1.3)

Foi adicionado o `FutureProjectionEngine` (`js/engine/futureProjectionEngine.js`) com painel próprio na interface
(📊 Estatísticas → 🔭 Projeções) e 42 testes. Documentação completa em **[PROJECOES.md](./PROJECOES.md)**.

**O que ele projeta:** tempo até 50/90/99% de chance (geométrica exata), curva de sobrevivência, espera por dezena,
custo determinístico, retorno esperado por faixa oficial, taxa de acúmulo com Wilson 95% e cobertura de carteira
(hipergeométrica exata + limites de Bonferroni + Monte Carlo determinístico com IC quando o intervalo é largo).

**O que ele NÃO faz:** prever dezenas. Em sorteio idôneo isso é impossível, e o relatório anterior já havia
estabelecido isso do ponto de vista estatístico. O módulo existe porque "projetar o futuro" em loteria só tem
sentido como projeção do *processo*.

### 10.1 Novo achado crítico, encontrado ao construir este módulo

`ProbabilityEngine.calculatePortfolioProjection` exibia **"Ganho de Eficiência Combinatória: 5x"** e uma
"Projeção no Núcleo Gaussiano" com odds melhores que a carteira direta. A conta era:

```js
const effectiveSpace = Math.round((1 / p) * retentionRatio);
const coreProb = Math.min(1, tickets / effectiveSpace);          // poda tratada como ganho de odds
const orthogonalityFactor = 0.65 + 0.35 * (diversificationScore / 100); // constante inventada
const portfolioAnyPrizeProb = 1 - Math.pow(1 - pAny, tickets * orthogonalityFactor);
```

**Isto é falso.** Descartar combinações não altera a probabilidade de nenhuma combinação — o sorteio não sabe
o que o aplicativo descartou. A poda reduz o espaço *pesquisado*, não a chance de acerto.

**Corrigido:** `gaussianCorePortfolioOdds` agora é idêntico a `portfolioDirectOdds`, com
`gaussianCoreOddsAreUnchanged: true` e texto explicativo; a probabilidade de "qualquer prêmio" usa o limite
superior da união (`m × p`), que é válido; o fator de ortogonalidade foi removido. Rótulos em `app.js`,
`statistics.js` e nos exports foram reescritos. Teste de regressão impede a reintrodução.

Este achado reforça a conclusão da seção 7: a ameaça à precisão não era a matemática de base, e sim os
**multiplicadores inventados** que faziam um número honesto parecer melhor do que é.

---

## 11. Estado atual do roadmap

Esta seção é a **fonte única da verdade** sobre o que já foi feito. Ela é
verificada por `tests/docs.test.js`: o marcador do cabeçalho
(`<!-- suite: arquivos=N testes=M -->`) precisa bater com a suíte real, e os
links internos precisam apontar para arquivos que existem.

| Item | Assunto | Status | Onde está documentado |
| :-- | :--- | :--- | :--- |
| 6.1 | Multiplicidade da seleção de janelas | ✅ | seção 6 / `BacktestEngine` |
| 6.2 | Inferência sequencial (always-valid) | ✅ | [INFERENCIA_SEQUENCIAL.md](./INFERENCIA_SEQUENCIAL.md) |
| 6.3 | Encolhimento bayesiano das frequências | ✅ | [FREQUENCIAS.md](./FREQUENCIAS.md) |
| 6.4 | Peso proporcional à evidência | ✅ | seção 6 |
| 6.5 | Fim do preenchimento sintético | ✅ | seção 6 |
| 6.6 | Teste de permutação do pipeline | ✅ | seção 6 |
| 6.7 | Fonte oficial dos dados | ✅ | seção 6 |
| 6.8 | Anti-Crowd: direção × magnitude | ✅ | seção 6 |
| 6.9 | CI + lint | 🟡 CI completo; **ESLint pendente** | `.github/workflows/ci.yml` |
| 6.10 | Memória da análise | ✅ | [DESEMPENHO_ANALISE.md](./DESEMPENHO_ANALISE.md) |
| 6.11 | Interface decomposta e testada | ✅ | [INTERFACE.md](./INTERFACE.md) |
| 6.12 | Encerrar o `legacyHash` | ✅ (prazo: 31/01/2027) | [SECURITY.md](./SECURITY.md) |
| 6.13 | CSRF / Origin | ✅ | [SECURITY.md](./SECURITY.md) |
| 6.14 | Documentação atualizada | ✅ | [DOCUMENTACAO.md](./DOCUMENTACAO.md) |
| — | Módulo de projeções futuras | ✅ | [PROJECOES.md](./PROJECOES.md) |

**Contagem atual:** 29 arquivos de teste, 429 testes, `npm audit` 0, build
limpo, CI com 6 verificações.

O que **continua em aberto**, sem enfeite: ESLint/formatador no CI e a calibração
brasileira do Anti-Crowd — que depende de dado público que não existe, não de código.
O hash legado tem prazo correndo: em **31/01/2027** o verificador precisa sair do
código, e há um teste que falha nesse dia se ele ainda estiver lá.
