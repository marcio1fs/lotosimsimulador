# Máxima diversificação: a única alavanca que não é previsão

Estratégia `diversified` da tela de simulação. Motor em `js/engine/diversificationEngine.js`.

---

## 1. A pergunta que originou isso

A tela oferecia nove estratégias: fechamento, máxima precisão, prêmio sozinho, Markov, melhor
jogo, adaptativo, ponderado, quentes e frios. Todas escolhem **quais** dezenas marcar — e
como toda combinação de 15 entre 25 tem a mesma chance (1 em 3.268.760), nenhuma pode
aumentar a probabilidade de acerto.

Isso deixa uma pergunta legítima: com o **mesmo orçamento**, existe alguma forma de melhorar
a chance de *ganhar alguma coisa*? Existe. Não tem a ver com prever o sorteio, e sim com a
correlação entre os jogos da carteira.

## 2. A medição

Lotofácil, **10 jogos** por estratégia, **300 mil sorteios uniformes** simulados por carteira
(semente fixa), contando em quantos deles a carteira continha ao menos um jogo com 11+ acertos
— a menor faixa premiada.

| carteira | dezenas usadas | P(≥1 jogo com 11+) | P(≥12) | P(≥13) |
| :--- | :---: | :---: | :---: | :---: |
| 🎯 Fechamento + Annealing | 19 | 44,3% | 12,0% | 1,32% |
| 🏆 Melhor jogo | 22 | 47,6% | 13,0% | 1,39% |
| 🧊 Frios | 22 | 47,6% | 12,9% | 1,38% |
| 🔥 Quentes | 22 | 48,0% | 13,0% | 1,38% |
| 💎 Prêmio sozinho (EV+) | 21 | 48,0% | 13,0% | 1,38% |
| ⚖️ Ponderado | 22 | 48,0% | 13,1% | 1,38% |
| ⛓️ Markov | 22 | 49,2% | 13,4% | 1,41% |
| 🤖 Modelo adaptativo | 22 | 49,6% | 13,5% | 1,42% |
| 🛡️ Máxima precisão | 23 | 50,6% | 13,7% | 1,46% |
| — 10 jogos aleatórios (controle) | 25 | 64,8% | 16,5% | 1,45% |
| 🧩 **Máxima diversificação** | **25** | **78,0%** | **17,9%** | 1,49% |

Referências: por jogo, P(≥11 acertos) = **10,589%** (hipergeométrica exata); a união de 10
jogos *independentes* seria 67,35%.

Três leituras que os números sustentam:

1. **As estratégias estatísticas não superam o aleatório.** Todas ficam entre 44% e 51%,
   contra 64,8% de dez jogos sorteados sem critério — porque restringem a carteira a 19–23
   dezenas e fazem os jogos se parecerem entre si. Jogos parecidos erram juntos.
2. **O fechamento é o pior neste critério** (44,3%): ele comprime tudo num pool de 19
   dezenas. O que ganha em troca é garantia condicional — se (e somente se) as 15 dezenas
   sorteadas caírem **todas** dentro do pool, o pior caso sobe de 8 para 12 acertos. Isso
   acontece em **0,119%** dos sorteios (C(19,15)/C(25,15) = 3.876 em 3.268.760).
3. **Diversificar vale 13 pontos percentuais.** Com o mesmo número de jogos e o mesmo custo,
   uma carteira que divide as 25 dezenas igualmente entre os jogos e evita sobreposição sobe
   para 78%.

## 3. Como o motor funciona

Não usa histórico, Markov, atraso nem frequência histórica. Ele recebe só a configuração da
modalidade (`total`, `pick`, filtros de paridade e soma), a quantidade de jogos,
`fixed`/`excluded` e a semente.

Recozimento simulado sobre três objetivos simultâneos:

| objetivo | o que empurra | por quê |
| :--- | :--- | :--- |
| **frequência** | cada dezena perto de `count × livres / disponíveis` | carteira equilibrada cobre o universo |
| **sobreposição** | minimiza Σ(interseção par a par)² | quadraticar pune dois jogos quase iguais, não a média |
| **filtros** | par/ímpar e soma dentro da faixa da modalidade | restrição dura (penalidade 500), para a carteira obedecer às mesmas regras das outras |

Detalhes de implementação que importam:

- **Determinístico**: `SeededRandom` com semente fixa. Mesma semente, mesma carteira — há
  teste para isso.
- **Incremental**: cada passo troca uma dezena livre de um jogo e atualiza o custo por
  diferença (interseções daquele jogo + duas frequências), sem recalcular a matriz. 60 mil
  passos custam ~40 ms; a geração completa com pontuação fica em ~90 ms.
- **Filtros como restrição dura**: a carteira sai com `filterViolations: 0`, não "quase".
- **`fixed` e `excluded` continuam valendo**: as fixas ocupam as primeiras posições e nunca
  são trocadas; as excluídas nem entram no universo.
- **Metadados** voltam junto (`games.diversificationMetadata`) e a tela mostra: dezenas
  distintas, frequência por dezena, sobreposição média/máxima e cobertura de pares.

## 4. O que ela não faz

- **Não aumenta a chance de acertar o prêmio principal.** Continua 1 em 3.268.760 por jogo.
  O que cresce é a chance de *algum* jogo premiado em faixa baixa.
- **Não prevê.** E isso é testado: dois históricos diferentes produzem a mesma carteira para
  a mesma semente (`tests/diversification.test.js`).
- **Não é ganho de valor esperado.** O ganho é em frequência de prêmio pequeno. P(≥13) quase
  não muda (1,45% → 1,49%).
- **Não está no benchmark de estratégias** (`executeBenchmark`): o benchmark roda o gerador
  centenas de vezes dentro de um backtest, e o recozimento custaria segundos por execução.
  A comparação relevante dela é Monte Carlo (seção 2), não acerto em histórico.
- **Tem um custo de EV**: como usa as 25 dezenas igualmente, ela inclui as dezenas "populares"
  (7, 13, 10, 17, 21, 22, 25) na mesma proporção do resto. O score anti-multidão medido cai de
  ~85,5 (aleatório) para ~81,4, e o multiplicador de EV de ~1,23x para ~1,20x. Direção
  pequena e magnitude não calibrada — ver [ANTICROWD_CALIBRACAO.md](./ANTICROWD_CALIBRACAO.md).
  Quem quiser o contrário (EV em vez de frequência) deve usar **Prêmio sozinho**.

## 5. Como usar

Na tela de simulação, escolher **🧩 MÁXIMA DIVERSIFICAÇÃO**, definir a carteira (10, 20 ou
35 jogos) e gerar. Vale para qualquer modalidade — o motor é genérico e há teste para
Mega-Sena (6 de 60).

Pela API interna:

```js
const games = LotteryModel.generateSmartGames('lotofacil', historico, 'diversified', [], [], 10, 'full', 123456);
games.diversificationMetadata; // { distinctNumbers, frequencyMin, meanOverlap, pairCoveragePct, ... }
```

## 6. Reprodutibilidade

```bash
node --test tests/diversification.test.js     # 14 testes
```

Os 14 testes cobrem: tamanho e unicidade dos jogos, equilíbrio de frequência, sobreposição
menor que a aleatória, filtros de paridade/soma, determinismo por semente, `fixed`/`excluded`,
outra modalidade, metadados, erros de configuração impossível, o efeito medido (Monte Carlo de
20 mil sorteios) e a integração com `GameGenerator`, `LotteryModel` e a tela.

## 7. Limitações honestas

1. **A medição usa histórico sintético uniforme** — não há acesso à API da Caixa neste
   ambiente de desenvolvimento. Mas é exatamente o modelo nulo correto: sorteio uniforme e
   independente. E o teste de permutação do app (`tests/permutationTest.test.js`) já mostrou
   que a ordem do histórico real não é explorável.
2. **Os números são de Lotofácil com 10 jogos.** Com 20 ou 35 jogos o ganho absoluto muda (a
   carteira já é grande), e outras modalidades têm outra estrutura de faixas premiadas.
   `P(≥11)` foi a faixa escolhida por ser a menor premiada na Lotofácil.
3. **A "cobertura de pares" de 100% aqui é de pares do universo de 25** — diferente da
   cobertura de pares *dentro de um pool* que o fechamento promete. As duas coisas não são
   comparáveis, ainda que usem o mesmo nome.
4. **O ganho medido é em frequência de prêmio pequeno.** Se o objetivo for prêmio grande ou
   EV, esta estratégia não é a resposta.
5. **O motor não substitui o fechamento quando a garantia é o objetivo.** Se a pessoa quer a
   promessa condicional ("se as 15 caírem no meu pool, tenho 12 pontos garantidos"), o
   fechamento é o instrumento — só saiba que o cenário tem 0,119% de chance.

## 8. Resumo de uma linha

Nenhuma estratégia prevê o sorteio; mas, com o mesmo dinheiro, uma carteira espalhada tem
**78%** de chance de conter algum jogo premiado contra **44%** do fechamento que a tela
oferecia como padrão — e essa diferença é correlação, não adivinhação.
