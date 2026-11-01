# Auditoria Técnica e Estatística — LotoSimSimulador

**Data:** 01/11/2026
**Escopo:** 61 arquivos · ~8.700 linhas de JavaScript · 12 módulos de motor estatístico · API serverless (Neon) · interface SPA
**Suíte de testes:** 113 → **151 testes** (100% passando), `npm run build` OK
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
| 12 | 🟡 Médio | Constantes do `AntiCrowdEngine` ("~65% das apostas…") sem fonte verificável | `js/engine/antiCrowdEngine.js` | 📋 Recomendado |
| 13 | 🟢 Baixo | `AUDIT_REPORT.md` desatualizado ("4 suítes", "12/12 resolvidos") | raiz | 📋 Recomendado |
| 14 | 🟢 Baixo | Sem CI, sem lint/format configurado; `.vscode/settings.json` só tem preferências de extensão | raiz | 📋 Recomendado |
| 15 | 🟢 Baixo | `legacyHash` (hash trivialmente reversível) continua aceito indefinidamente | `server/security.js` | 📋 Recomendado |
| 16 | 🟢 Baixo | `analyze()` aloca matrizes O(N²) de objetos a cada chamada; `index.html` monolítico de 32 KB | `statisticalAnalyzer.js`, `index.html` | 📋 Recomendado |

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

**6.2 Inferência sequencial (always-valid p-values) — 📋 recomendado.**
O usuário pode clicar em "gerar" repetidamente e trocar a janela até gostar do resultado. Com testes clássicos, olhar repetidamente infla o erro tipo I indefinidamente. *Correção:* mSPRT / testes sequenciais com correção de α sobre o número de gerações, ou um "orçamento de α" por sessão.

**6.3 Encolhimento bayesiano (empirical Bayes / James-Stein) das frequências — 📋 recomendado.**
As dezenas são ranqueadas por frequência bruta, mas a diferença entre "a mais quente" e "a mais fria" em 100 concursos está quase toda dentro do erro amostral. *Correção:* estimar `p_i = (count_i + α·p0) / (n + α)` com `α` calibrado pelo histórico (equivalente a um prior Dirichlet-multinomial). Isso substitui "quente/frio" por **posterior com intervalo de credibilidade** — a única forma honesta de mostrar esse tipo de métrica. O cartão "🔥 Quentes" deveria exibir a incerteza, não só 5 números.

**6.4 Reduzir o peso dos fatores sem evidência — 📋 recomendado.**
`markov` carrega 0,10 do score e `cooccurrence` 0,11 — mas a auditoria demonstrou que **nenhuma** transição de Markov sobrevive ao FDR em dados aleatórios, e que a co-ocorrência de pares é indistinguível de independência. Fatores que não podem ser distinguidos de ruído não deveriam somar 21% da decisão. *Correção:* encolher cada peso na proporção da evidência disponível (`peso_i ∝ força da evidência_i`), zerando-os quando o teste não rejeita H0.

### Prioridade alta — dados e validação

**6.5 Substituir o preenchimento sintético por estado vazio honesto.** Remover `ensureMinimumHistoryDepth`; exibir "histórico insuficiente para inferência" e oferecer sincronização. Validar continuidade dos concursos (sem lacunas, sem duplicatas) e armazenar um checksum por lote importado.

**6.6 Teste de permutação do pipeline completo.** Além do nulo analítico por concurso, embaralhar a ordem temporal do histórico N vezes e rodar o pipeline inteiro. Se o desempenho observado estiver dentro da distribuição nula, isso é conclusivo — e comunica melhor que um p-value.

**6.7 Fonte oficial dos dados.** O espelho `loteriascaixa-api.herokuapp.com` é um serviço de terceiros em Heroku (risco de descontinuação). O endpoint oficial da Caixa (`servicebus2.caixa.gov.br`) está na CSP mas é usado só como fallback. Inverter a ordem e cachear no Neon com validação de esquema.

### Prioridade média — anti-crowd com base empírica

**6.8 Substituir as constantes do `AntiCrowdEngine` por dados.** As afirmações ("~65% das apostas concentram-se em…", penalidade de 0,25 para dezenas > 31) são plausíveis na literatura (Ziemba, Haigh, Cook & Clotfelter) mas estão **hardcoded sem fonte e sem calibração**. Duas saídas possíveis: (a) citar as fontes no código e nos comentários, mantendo os pesos como *priors* declarados; (b) calibrar com dados reais de popularidade (volumes de aposta por dezena, quando disponíveis em transparência da Caixa). A opção (a) é barata e já elimina a aparência de precisão fabricada.

### Prioridade média — engenharia

**6.9 CI + lint.** Não há workflow. Um `.github/workflows/ci.yml` de 15 linhas (`npm ci`, `npm test`, `npm run build`) impede regressões como o bug de intervalo, além de ativar Dependabot. Adicionar ESLint + Prettier (o código é consistente, a adoção tende a ser indolor).

**6.10 Performance de memória.** `analyze()` monta matrizes O(N²) de objetos (`pairMatrix` = 4.950 objetos na Mega, 4.950 na Quina, 10.000 na Lotomania) mais um array de todos os pares ordenado. *Correção:* `Int32Array(total*total)` triangular + memoização por `(últimoConcurso, janela)`.

**6.11 Decompor a interface.** `index.html` tem 32 KB com markup e lógica de apresentação embutidos. Separar em componentes (ou ao menos templates) facilita auditar e testar a camada visual, hoje sem cobertura.

### Prioridade baixa

**6.12 Encerrar o `legacyHash`.** O hash legado (`h_…`, baseado em deslocamento de bits + base64 da senha) é reversível em milissegundos. Ele existe para migrar contas antigas — mas sem prazo, é uma porta aberta permanente. Definir data-limite e forçar redefinição de senha.

**6.13 CSRF/Origin.** `SameSite=Lax` já bloqueia POST cross-site; adicionar verificação de `Origin`/`Sec-Fetch-Site` nos endpoints de mutação fecha a borda.

**6.14 Atualizar a documentação.** `AUDIT_REPORT.md` afirma "4 suítes passando" e "12 de 12 problemas resolvidos". Hoje são 17 arquivos de teste e 151 testes — e a auditoria atual encontrou 11 defeitos adicionais. Um relatório desatualizado é pior que nenhum.

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
npm test            # 151 testes, incluindo tests/precisionAudit.test.js (38 novos)
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

**Resumo final:** 11 defeitos corrigidos, 151 testes verdes, build limpo. O projeto ganhou precisão não por adicionar complexidade, mas por remover três fontes de erro: um cálculo errado, testes que não testavam nada, e dados que não eram dados.
