/**
 * Tela de Conferência: último resultado oficial, seletor de loteria, entrada das
 * dezenas sorteadas e área de resultados.
 */

export function conferenceScreen() {
    return `        <!-- VIEW: CONFERENCE -->
        <div class="screen" id="screen-conference">
            <div class="section-title"><span>🏆</span> Resultado do Último Concurso</div>
            <div id="lastResultContainer">
                <div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">Sincronize os dados na aba Simulação</div></div>
            </div>

            <div class="section-title" style="margin-top:2rem;"><span>🔍</span> Conferidor de Jogos</div>
            <div class="drawn-numbers-input">
                <h3>🎯 Analisar Performance</h3>
                <div style="margin-bottom:0.75rem; display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
                    <select class="number-input" id="confLotteryType" style="width:auto;height:auto;padding:0.5rem 1rem;">
                        <option value="lotofacil">Lotofácil</option>
                        <option value="mega">Mega Sena</option>
                        <option value="lotomania">Lotomania</option>
                        <option value="quina">Quina</option>
                    </select>
                    <span style="font-size:0.8rem; color:var(--text-muted);" id="confHint"></span>
                    <button class="btn btn-secondary btn-sm" id="useLastBtn">📋 Copiar Último Sorteio</button>
                </div>
                <div class="input-row" id="confInputs"></div>
                <div style="margin-top:1rem;"><button class="btn btn-primary" id="confBtn">🔍 Iniciar Conferência</button></div>
            </div>
            <div id="confResults" class="conference-section"></div>
        </div>

`;
}
