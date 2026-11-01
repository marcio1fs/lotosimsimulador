/**
 * Modais de perfil, automação e informações do banco de dados.
 *
 * Todos fecham por `data-action="close-modal"`, o que mantém o contrato de
 * fechamento uniforme e verificável.
 */

export function modals() {
    return `
<!-- MODALS -->
<div class="modal-overlay" id="profileModal">
    <div class="modal-card">
        <div class="modal-header">
            <div class="modal-title">Configurações de Perfil</div>
            <button class="modal-close" data-action="close-modal">✕</button>
        </div>
        <div class="profile-avatar-large" id="profileAvatar">U</div>
        <div style="text-align:center;margin-bottom:1rem;">
            <div style="font-size:1.1rem;font-weight:700;" id="profileName"></div>
            <div style="font-size:0.8rem;color:var(--text-muted);" id="profileEmail"></div>
            <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.25rem;" id="profileJoined"></div>
        </div>
        <div class="profile-stats">
            <div class="profile-stat"><div class="profile-stat-value" id="profileGames">0</div><div class="profile-stat-label">Jogos</div></div>
            <div class="profile-stat"><div class="profile-stat-value" id="profileSims">0</div><div class="profile-stat-label">Sims</div></div>
            <div class="profile-stat"><div class="profile-stat-value" id="profileResults">0</div><div class="profile-stat-label">Análises</div></div>
        </div>
        <div class="form-group">
            <label class="form-label">Alterar Senha</label>
            <input type="password" class="form-input" id="currentPassword" placeholder="Senha atual">
            <input type="password" class="form-input" id="newPassword" placeholder="Nova senha" style="margin-top:0.5rem;">
            <input type="password" class="form-input" id="newPasswordConfirm" placeholder="Confirmar nova senha" style="margin-top:0.5rem;">
            <button class="btn btn-secondary btn-sm" style="margin-top:0.5rem; width: 100%;" id="changePassBtn">🔒 Salvar Nova Senha</button>
            <div style="margin-top:1rem; padding-top:0.75rem; border-top:1px solid rgba(239,68,68,0.2);">
                <label class="form-label" style="color:#f87171;">Zona de Privacidade (LGPD)</label>
                <input type="password" class="form-input" id="deleteAccountPassword" placeholder="Confirme sua senha para excluir a conta">
                <button class="btn btn-secondary btn-sm" style="margin-top:0.5rem; width:100%; border-color:rgba(239,68,68,0.4); color:#f87171;" id="deleteAccountBtn">🗑️ Excluir Minha Conta e Dados</button>
            </div>
        </div>
        <div style="margin-top:1.5rem;">
            <button class="btn btn-secondary" style="width:100%;" data-action="logout">🚪 Encerrar Sessão</button>
        </div>
    </div>
</div>

<div class="modal-overlay" id="autoModal">
    <div class="modal-card">
        <div class="modal-header">
            <div class="modal-title">🤖 Painel de Automação IA</div>
            <button class="modal-close" data-action="close-modal">✕</button>
        </div>
        <div class="auto-status-bar">
            <div class="status-item"><div class="data-status-dot green"></div><span>Sistema: <strong id="autoMasterStatus">Offline</strong></span></div>
            <div class="status-item"><span>Próximo Ciclo: <span class="next-run" id="nextRunTime">--</span></span></div>
            <div class="status-item"><span>Tasks Hoje: <strong id="execCountToday">0</strong></span></div>
        </div>
        <div class="auto-toggle-row">
            <div class="auto-toggle-info"><h4>🔄 Auto-Sync</h4><p>Sincroniza com a Caixa automaticamente</p></div>
            <label class="toggle-switch"><input type="checkbox" id="autoFetchToggle"><span class="toggle-slider"></span></label>
        </div>
        <div class="auto-toggle-row">
            <div class="auto-toggle-info"><h4>⚡ Auto-Gen</h4><p>Gera novos jogos a cada sorteio</p></div>
            <label class="toggle-switch"><input type="checkbox" id="autoGenerateToggle"><span class="toggle-slider"></span></label>
        </div>
        <div class="auto-toggle-row">
            <div class="auto-toggle-info"><h4>🔍 Auto-Review</h4><p>Notifica acertos automaticamente</p></div>
            <label class="toggle-switch"><input type="checkbox" id="autoConferenceToggle"><span class="toggle-slider"></span></label>
        </div>
        <div class="auto-toggle-row">
            <div class="auto-toggle-info"><h4>📊 Multi-Lottery</h4><p>Processa todas as loterias em paralelo</p></div>
            <label class="toggle-switch"><input type="checkbox" id="autoAllLotteriesToggle"><span class="toggle-slider"></span></label>
        </div>
        
        <div style="margin-top:1rem;">
            <div class="section-title" style="font-size:0.85rem;"><span>⏱️</span> Intervalo de Verificação</div>
            <div class="interval-selector">
                <button class="interval-btn" data-minutes="5">5min</button>
                <button class="interval-btn" data-minutes="15">15min</button>
                <button class="interval-btn active" data-minutes="30">30min</button>
                <button class="interval-btn" data-minutes="60">1h</button>
            </div>
        </div>
        
        <div style="margin-top:1.5rem;">
            <div class="section-title" style="font-size:0.85rem;"><span>📝</span> Log de Operações</div>
            <div class="auto-log" id="autoLog"></div>
        </div>
        <div style="margin-top:1rem; display:flex; gap:0.5rem;">
            <button class="btn btn-success btn-sm" id="runManualBtn" style="flex:1;">▶ Executar Task Agora</button>
            <button class="btn btn-secondary btn-sm" id="clearLogBtn">🗑️ Limpar</button>
        </div>
    </div>
</div>

<div class="modal-overlay" id="dbInfoModal">
    <div class="modal-card">
        <div class="modal-header">
            <div class="modal-title">🗄️ Gerenciamento de Dados Local</div>
            <button class="modal-close" data-action="close-modal">✕</button>
        </div>
        <div class="db-info-panel">
            <h4>Estrutura Híbrida (API Serverless / IndexedDB)</h4>
            <ul>
                <li><strong>users</strong>: Perfil e segurança</li>
                <li><strong>games</strong>: Repositório de jogos gerados</li>
                <li><strong>lottery_results</strong>: Cache de resultados oficiais</li>
                <li><strong>auto_settings</strong>: Configurações do Agente</li>
            </ul>
        </div>
        <div class="db-info-panel" style="margin-top:1rem; background:rgba(16,185,129,0.05); border-color:rgba(16,185,129,0.1);">
            <h4 style="color:var(--accent-green);">Métricas de Armazenamento</h4>
            <div id="dbStatsContent" style="font-size:0.8rem; padding:0.5rem 0;">Calculando...</div>
        </div>
    </div>
</div>

`;
}
