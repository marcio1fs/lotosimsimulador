/**
 * Tela de Simulação: seletor de loteria, painel do agente (atualizar/gerar), janela
 * temporal, tamanho da carteira, estratégias, filtros de dezenas fixas e excluídas,
 * grid de jogos e aviso de responsabilidade.
 *
 * É a maior seção do app e a que mais cresceu; isolá-la é o que permite revisar uma
 * mudança de estratégia sem ler 34 KB de markup.
 */

export function simulationScreen() {
    return `        <!-- VIEW: SIMULATION -->
        <div class="screen active" id="screen-simulation">
            <div class="section-title"><span>🎯</span> Escolha a Loteria</div>
            <div class="lottery-selector">
                <div class="lottery-card selected" data-type="lotofacil">
                    <div class="lottery-card-icon">🟣</div>
                    <div class="lottery-card-name">Lotofácil</div>
                    <div class="lottery-card-desc">25 números · 15 dezenas</div>
                    <div class="lottery-card-status" id="status-lotofacil">Aguardando dados...</div>
                </div>
                <div class="lottery-card" data-type="mega">
                    <div class="lottery-card-icon">🟢</div>
                    <div class="lottery-card-name">Mega Sena</div>
                    <div class="lottery-card-desc">60 números · 6 dezenas</div>
                    <div class="lottery-card-status" id="status-mega">Aguardando dados...</div>
                </div>
                <div class="lottery-card" data-type="lotomania">
                    <div class="lottery-card-icon">🔴</div>
                    <div class="lottery-card-name">Lotomania</div>
                    <div class="lottery-card-desc">100 números · 50 dezenas</div>
                    <div class="lottery-card-status" id="status-lotomania">Aguardando dados...</div>
                </div>
                <div class="lottery-card" data-type="quina">
                    <div class="lottery-card-icon">🔵</div>
                    <div class="lottery-card-name">Quina</div>
                    <div class="lottery-card-desc">80 números · 5 dezenas</div>
                    <div class="lottery-card-status" id="status-quina">Aguardando dados...</div>
                </div>
            </div>

            <div class="agent-panel">
                <div class="agent-header">
                    <div class="agent-title">
                        <div class="agent-avatar">🤖</div>
                        <div>
                            <div class="agent-name">Agente IA de Análise</div>
                            <div class="agent-status" id="agentStatus">Sincronizando dados...</div>
                        </div>
                    </div>
                    <div class="agent-controls">
                        <button class="btn btn-secondary btn-sm" id="fetchBtn">🔄 Atualizar Dados</button>
                        <button class="btn btn-primary" id="generateBtn" disabled>⚡ Gerar Jogos Inteligentes</button>
                    </div>
                </div>
                <div class="data-status-bar">
                    <div class="data-status-item">
                        <div class="data-status-dot" id="dataDot"></div>
                        <span id="dataStatusText">Sem conexão com API</span>
                    </div>
                    <div class="data-status-item"><span id="dataCount">0 concursos</span></div>
                    <div class="data-status-item"><span id="lastFetchTime">-</span></div>
                </div>

                <div class="section-title" style="font-size:0.85rem; margin-top:1.5rem;"><span>🗓️</span> Janela Temporal e Tamanho da Carteira</div>
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
                    <div class="time-window-selector">
                        <button class="window-btn" data-window="20">20 concursos</button>
                        <button class="window-btn" data-window="50">50 concursos</button>
                        <button class="window-btn active" data-window="100">100 concursos</button>
                        <button class="window-btn" data-window="200">200 concursos</button>
                        <button class="window-btn" data-window="500">500 concursos</button>
                        <button class="window-btn" data-window="full">Completo</button>
                    </div>
                    <div class="time-window-selector" id="batchSizeSelector" title="Quantidade de jogos na carteira/fechamento">
                        <button class="window-btn batch-size-btn active" data-count="10">10 Jogos</button>
                        <button class="window-btn batch-size-btn" data-count="20">20 Jogos (Fechamento)</button>
                        <button class="window-btn batch-size-btn" data-count="35">35 Jogos (Alta Cobertura)</button>
                    </div>
                </div>

                <div class="section-title" style="font-size:0.85rem; margin-top:1.5rem;"><span>🧠</span> Estratégia de Geração Estatística, Combinatória e Teoria dos Jogos</div>
                <div class="strategy-options">
                    <div class="strategy-option selected" data-strategy="wheeling">
                        <div class="strategy-option-name">🎯 FECHAMENTO + ANNEALING</div>
                        <div class="strategy-option-desc">Matriz Schoenheim + Poda Gauss</div>
                    </div>
                    <div class="strategy-option" data-strategy="maximum_precision">
                        <div class="strategy-option-name">🛡️ MÁXIMA PRECISÃO</div>
                        <div class="strategy-option-desc">Walk-Forward + Markov + Fechamento</div>
                    </div>
                    <div class="strategy-option" data-strategy="anti_crowd">
                        <div class="strategy-option-name">💎 PRÊMIO SOZINHO (EV+)</div>
                        <div class="strategy-option-desc">Anti-Multidão (Evita Rateio)</div>
                    </div>
                    <div class="strategy-option" data-strategy="markov">
                        <div class="strategy-option-name">⛓️ CADEIAS DE MARKOV</div>
                        <div class="strategy-option-desc">Transição Temporal (t-1 → t)</div>
                    </div>
                    <div class="strategy-option" data-strategy="best_game">
                        <div class="strategy-option-name">🏆 MELHOR JOGO</div>
                        <div class="strategy-option-desc">Backtest auto-otimizado</div>
                    </div>
                    <div class="strategy-option" data-strategy="adaptive">
                        <div class="strategy-option-name">🤖 Modelo Adaptativo</div>
                        <div class="strategy-option-desc">Multifatorial + Ciclo</div>
                    </div>
                    <div class="strategy-option" data-strategy="weighted">
                        <div class="strategy-option-name">⚖️ Ponderado</div>
                        <div class="strategy-option-desc">Frequência histórica</div>
                    </div>
                    <div class="strategy-option" data-strategy="hot">
                        <div class="strategy-option-name">🔥 Quentes</div>
                        <div class="strategy-option-desc">Maior saída recente</div>
                    </div>
                    <div class="strategy-option" data-strategy="cold">
                        <div class="strategy-option-name">🧊 Frios</div>
                        <div class="strategy-option-desc">Retorno de atrasos</div>
                    </div>
                </div>

                <div class="advanced-filters">
                    <div class="filter-group">
                        <div class="section-title" style="font-size:0.8rem; margin-top:1rem;"><span>📌</span> Fixar Dezenas (Obrigatórias)</div>
                        <div class="number-selector" id="fixedNumbers"></div>
                    </div>
                    <div class="filter-group">
                        <div class="section-title" style="font-size:0.8rem; margin-top:1rem;"><span>🚫</span> Excluir Dezenas (Bloqueadas)</div>
                        <div class="number-selector" id="excludedNumbers"></div>
                    </div>
                </div>
            </div>

            <div id="insightsContainer" style="display:none;">
                <div class="section-title"><span>📊</span> Insights Recentes (Top 100)</div>
                <div class="insights-grid" id="insightsGrid"></div>
            </div>

            <div class="section-title" style="display:flex; justify-content:space-between; align-items:center;">
                <span>🎲 Jogos Sugeridos</span>
                <div class="export-actions" id="exportActions" style="display:none;">
                    <button class="btn btn-secondary btn-sm" id="exportPdfBtn">🖨️ Imprimir Volantes (PDF)</button>
                    <button class="btn btn-secondary btn-sm" id="exportTxtBtn">📝 TXT</button>
                </div>
            </div>
            <div class="games-grid" id="gamesGrid">
                <div class="empty-state" style="grid-column:1/-1;">
                    <div class="empty-state-icon">🤖</div>
                    <div class="empty-state-text">Clique em "Atualizar Dados" para começar a análise</div>
                </div>
            </div>

            <div class="disclaimer">
                <div class="disclaimer-icon">⚠️</div>
                <div>Este é um simulador baseado em estatísticas reais. Loterias são jogos de azar. Jogue com moderação e responsabilidade.</div>
            </div>
        </div>

`;
}
