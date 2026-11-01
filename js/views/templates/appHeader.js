/**
 * Casca do app autenticado: `<header>` com contadores e menu do usuário, `<nav>`
 * com as três telas e a abertura do `<main>`.
 *
 * A navegação é declarativa (`data-screen`, `data-action`), o que permite testar
 * que todo destino existe sem executar JS no navegador.
 */

export function appHeader() {
    return `<!-- ==================== VIEW: APP ==================== -->
<div class="app-wrapper" id="appWrapper">
    <header class="app-header">
        <div class="logo-section">
            <div class="logo-icon">🎱</div>
            <div class="logo-text"><h1>Lotosimsimulador</h1><p>Agente Inteligente · Ativo</p></div>
        </div>
        <div class="header-right">
            <div class="header-stats">
                <div class="header-stat">
                    <div class="header-stat-value" id="totalGamesGenerated">0</div>
                    <div class="header-stat-label">Jogos</div>
                </div>
                <div class="header-stat">
                    <div class="header-stat-value" id="totalSimulations">0</div>
                    <div class="header-stat-label">Simulações</div>
                </div>
                <div class="header-stat">
                    <div class="header-stat-value" id="resultsAnalyzed">0</div>
                    <div class="header-stat-label">Análises</div>
                </div>
            </div>
            <div class="automation-indicator" id="autoIndicator" style="display:none;">
                <div class="pulse-dot"></div>
                <span>Auto ON</span>
            </div>
            <div class="user-menu" id="userMenu">
                <div class="user-avatar" id="userAvatarHeader">U</div>
                <div class="user-info">
                    <div class="user-name" id="userNameHeader">Usuário</div>
                    <div class="user-role">Acesso Premium</div>
                </div>
                <span style="color:var(--text-muted); font-size: 0.7rem;">▼</span>
                <div class="user-dropdown" id="userDropdown">
                    <div class="dropdown-header">
                        <div class="dropdown-header-name" id="dropdownName"></div>
                        <div class="dropdown-header-email" id="dropdownEmail"></div>
                    </div>
                    <button class="dropdown-item" data-action="open-profile">👤 Meu Perfil</button>
                    <button class="dropdown-item" data-action="open-auto">🤖 Automação</button>
                    <button class="dropdown-item" data-action="open-db-info">🗄️ Banco de Dados</button>
                    <button class="dropdown-item" data-action="export-data">📥 Exportar Dados</button>
                    <button class="dropdown-item danger" data-action="logout">🚪 Sair</button>
                </div>
            </div>
        </div>
    </header>

    <nav class="nav-tabs">
        <div class="nav-tab active" data-screen="simulation">🎲 Simulação</div>
        <div class="nav-tab" data-screen="conference">🔍 Conferência</div>
        <div class="nav-tab" data-screen="statistics">📊 Estatísticas</div>
    </nav>

    <main class="main-content">
`;
}
