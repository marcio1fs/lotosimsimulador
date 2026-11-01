/**
 * Tela de autenticação: abas Entrar/Criar Conta, formulários e status do banco.
 *
 * Os ids daqui (`loginForm`, `registerForm`, `loginEmail`, `loginPassword`,
 * `registerName`, `registerEmail`, `registerPassword`, `dbStatus`, `dbStatusText`)
 * são os pontos de contato de `js/controllers/auth.js` com o DOM.
 *
 * Só markup: nenhuma decisão de estado acontece aqui.
 */

export function authScreen() {
    return `<!-- ==================== VIEW: AUTH ==================== -->
<div class="auth-container" id="authScreen">
    <div class="auth-card">
        <div class="auth-logo">
            <div class="auth-logo-icon">🎱</div>
            <h2>Lotosimsimulador</h2>
            <p>Agente Inteligente · Automação Completa</p>
        </div>
        <div class="db-status" id="dbStatus">
            <div class="db-status-dot loading"></div>
            <span id="dbStatusText">Conectando ao banco de dados...</span>
        </div>
        <div class="auth-tabs">
            <button class="auth-tab active" data-view="login">Entrar</button>
            <button class="auth-tab" data-view="register">Criar Conta</button>
        </div>
        
        <!-- Login Form -->
        <form class="auth-form active" id="loginForm">
            <div class="form-group">
                <label class="form-label">E-mail</label>
                <input type="email" class="form-input" id="loginEmail" placeholder="seu@email.com" required>
            </div>
            <div class="form-group">
                <label class="form-label">Senha</label>
                <div class="password-wrapper">
                    <input type="password" class="form-input" id="loginPassword" placeholder="••••••••" required>
                    <button type="button" class="password-toggle" data-target="loginPassword">👁️</button>
                </div>
                <div class="form-error" id="loginEmailError"></div>
            </div>
            <div class="form-checkbox">
                <input type="checkbox" id="rememberMe">
                <label for="rememberMe">Lembrar-me por 30 dias</label>
            </div>
            <button type="submit" class="auth-btn" id="loginBtn">Entrar</button>
            <div class="auth-footer">Não tem conta? <a href="#" data-action="switch-register">Criar conta</a></div>
        </form>

        <!-- Register Form -->
        <form class="auth-form" id="registerForm">
            <div class="form-group">
                <label class="form-label">Nome Completo</label>
                <input type="text" class="form-input" id="regName" placeholder="Seu nome" required>
                <div class="form-error" id="regNameError"></div>
            </div>
            <div class="form-group">
                <label class="form-label">E-mail</label>
                <input type="email" class="form-input" id="regEmail" placeholder="seu@email.com" required>
                <div class="form-error" id="regEmailError"></div>
            </div>
            <div class="form-group">
                <label class="form-label">Senha</label>
                <div class="password-wrapper">
                    <input type="password" class="form-input" id="regPassword" placeholder="Mínimo 8 caracteres" required>
                    <button type="button" class="password-toggle" data-target="regPassword">👁️</button>
                </div>
                <div class="password-strength"><div class="password-strength-fill" id="strengthFill"></div></div>
                <div class="password-strength-text" id="strengthText"></div>
                <div class="form-error" id="regPasswordError"></div>
            </div>
            <div class="form-group">
                <label class="form-label">Confirmar Senha</label>
                <div class="password-wrapper">
                    <input type="password" class="form-input" id="regPasswordConfirm" placeholder="Repita a senha" required>
                    <button type="button" class="password-toggle" data-target="regPasswordConfirm">👁️</button>
                </div>
                <div class="form-error" id="regPasswordConfirmError"></div>
            </div>
            <div class="form-checkbox">
                <input type="checkbox" id="agreeTerms" required>
                <label for="agreeTerms">Concordo com os termos de uso</label>
            </div>
            <button type="submit" class="auth-btn" id="regBtn">Criar Conta</button>
            <div class="auth-footer">Já tem conta? <a href="#" data-action="switch-login">Entrar</a></div>
        </form>
    </div>
</div>

`;
}
