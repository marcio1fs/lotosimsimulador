/**
 * Tela de Estatísticas: quatro abas (frequência, padrões, projeções, histórico), os
 * gráficos (Chart.js), o relatório de validação do modelo, o teste de permutação, o
 * benchmark de estratégias, o walk-forward e o ranking de jogos.
 *
 * As `<canvas>` daqui são os alvos de `StatisticsView`; os painéis vazios com `id`
 * são os pontos de montagem do relatório.
 */

export function statisticsScreen() {
    return `        <!-- VIEW: STATISTICS -->
        <div class="screen" id="screen-statistics">
            <div class="section-title"><span>📊</span> Dashboard Estatístico</div>
            <div class="tab-sub">
                <button class="tab-sub-btn active" data-tab="frequency">📈 Frequência</button>
                <button class="tab-sub-btn" data-tab="patterns">🧩 Padrões</button>
                <button class="tab-sub-btn" data-tab="projections">🔭 Projeções</button>
                <button class="tab-sub-btn" data-tab="history">📋 Histórico</button>
            </div>

            <div id="stat-frequency">
                <div id="statsNoData" class="empty-state">
                    <div class="empty-state-icon">📊</div><div class="empty-state-text">Dados necessários para gerar o relatório</div>
                </div>
                <div id="statsContent" style="display:none;">
                    <div class="stats-section">
                        <div class="stat-card">
                            <div class="stat-card-title"><span>🔥</span> Ranking de Saídas</div>
                            <div class="chart-container"><canvas id="freqChart"></canvas></div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-card-title"><span>⚖️</span> Distribuição Par/Ímpar</div>
                            <div class="chart-container"><canvas id="parityChart"></canvas></div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-card-title"><span>🗺️</span> Heatmap Global</div>
                            <div class="frequency-grid" id="freqGrid"></div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-card-title"><span>📈</span> Por Faixa Numérica</div>
                            <div class="chart-container"><canvas id="rangeChart"></canvas></div>
                        </div>
                    </div>
                </div>
            </div>

            <div id="stat-patterns" style="display:none;">
                <div id="patternsNoData" class="empty-state">
                    <div class="empty-state-icon">🧩</div><div class="empty-state-text">Gere simulações para ver análises e validações de estatísticas</div>
                </div>
                <div id="patternsContent" style="display:none;">
                    <div class="stats-section">
                        <div class="stat-card" style="grid-column:1/-1;">
                            <div class="stat-card-title"><span>📋</span> Relatório Final de Validação Estatística do Modelo</div>
                            <div id="modelReportPanel" style="padding:0.5rem;"><div style="text-align:center;color:var(--text-muted);font-size:0.8rem;">Gere jogos no modo Máxima Precisão para visualizar o relatório completo de validação estatística.</div></div>
                        </div>
                        <div class="stat-card" style="grid-column:1/-1;">
                            <div class="stat-card-title"><span>🎲</span> Teste de Permutação — a ordem temporal carrega informação?</div>
                            <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:0.6rem; line-height:1.5;">
                                Embaralha a ordem dos concursos 99 vezes, roda o pipeline inteiro em cada versão e compara com o desempenho na ordem real.
                                Se o resultado real cai no meio da distribuição nula, o pipeline <strong>não extrai nada</strong> da ordem do histórico — que é o esperado em sorteio idôneo.
                            </div>
                            <button class="btn btn-secondary btn-sm" id="btnPermutationTest">▶ Rodar teste (99 permutações)</button>
                            <div id="permutationResult" style="margin-top:0.75rem;"></div>
                        </div>
                        <div class="stat-card" style="grid-column:1/-1;">
                            <div class="stat-card-title"><span>🎯</span> Ranking de Estratégias vs Baseline Aleatória (Backtest Histórico)</div>
                            <table class="history-table">
                                <thead><tr><th>Estratégia</th><th>Média de Acertos</th><th>Baseline Aleatória</th><th>Diferença</th><th>Evolução Relativa</th><th>Significância</th><th>IC 95%</th></tr></thead>
                                <tbody id="strategyBenchmarkBody"></tbody>
                            </table>
                        </div>
                        <div class="stat-card">
                            <div class="stat-card-title"><span>📊</span> Distribuição de Score dos Jogos</div>
                            <div class="chart-container"><canvas id="probChart"></canvas></div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-card-title"><span>📉</span> Radar de Desempenho Multifatorial</div>
                            <div class="chart-container"><canvas id="comparisonChart"></canvas></div>
                        </div>
                        <div class="stat-card" style="grid-column:1/-1;">
                            <div class="stat-card-title"><span>🔬</span> Validação Walk-Forward e Detecção de Overfitting</div>
                            <div id="walkForwardPanel" style="padding:0.5rem;"><div style="text-align:center;color:var(--text-muted);font-size:0.8rem;">Gere simulações para ver a validação walk-forward</div></div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-card-title"><span>🎲</span> Distribuição Monte Carlo</div>
                            <div class="chart-container"><canvas id="monteCarloChart"></canvas></div>
                        </div>
                        <div class="stat-card" style="grid-column:1/-1;">
                            <div class="stat-card-title"><span>🏆</span> Ranking e Métricas Transparentes dos Jogos Gerados</div>
                            <table class="history-table">
                                <thead><tr><th>#</th><th>Identificador</th><th>Dezenas</th><th>Score do Modelo</th><th>Acertos Esperados (IC 95%)</th><th>Desempenho Histórico</th></tr></thead>
                                <tbody id="rankingBody"></tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>

            <div id="stat-projections" style="display:none;">
                <div id="projectionsEmpty" class="empty-state">
                    <div class="empty-state-icon">🔭</div>
                    <div class="empty-state-text">Selecione uma modalidade e carregue o histórico para projetar</div>
                </div>
                <div id="projectionsContent" style="display:none;"></div>
            </div>

            <div id="stat-history" style="display:none;">
                <div class="stat-card">
                    <div class="stat-card-title"><span>📋</span> Log de Atividades</div>
                    <table class="history-table">
                        <thead><tr><th>Data/Hora</th><th>Loteria</th><th>Estratégia</th><th>Jogos</th><th>Status</th></tr></thead>
                        <tbody id="historyBody">
                            <tr><td colspan="5" style="text-align:center;color:var(--text-muted);">Nenhum registro encontrado</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </main>
</div>
`;
}
