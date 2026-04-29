/**
 * View: Auth - Login and Registration screens
 */
export class AuthView {
    static show() { 
        document.getElementById('authScreen').style.display = ''; 
        document.getElementById('appWrapper').classList.remove('active'); 
    }
    
    static hide() { 
        document.getElementById('authScreen').style.display = 'none'; 
        document.getElementById('appWrapper').classList.add('active'); 
    }
    
    static showForm(form) {
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
        document.getElementById(form + 'Form').classList.add('active');
        document.querySelector(`.auth-tab[data-view="${form}"]`).classList.add('active');
    }
    
    static clearErrors() {
        document.querySelectorAll('.form-error').forEach(e => { e.classList.remove('show'); e.textContent = ''; });
        document.querySelectorAll('.form-input').forEach(i => i.classList.remove('error'));
    }
    
    static showError(field, message) {
        const input = document.getElementById(field);
        const error = document.getElementById(field + 'Error') || input?.closest('.form-group')?.querySelector('.form-error');
        if (input) input.classList.add('error');
        if (error) { error.textContent = message; error.classList.add('show'); }
    }
    
    static setLoading(loading, btnId) {
        const btn = document.getElementById(btnId);
        btn.disabled = loading;
        btn.textContent = loading ? (btnId === 'loginBtn' ? 'Verificando...' : 'Criando conta...') : (btnId === 'loginBtn' ? 'Entrar' : 'Criar Conta');
    }
    
    static updateDbStatus(connected, message) {
        const dot = document.querySelector('.db-status-dot');
        const text = document.getElementById('dbStatusText');
        dot.className = 'db-status-dot' + (connected ? '' : message.includes('Erro') ? ' error' : ' loading');
        text.textContent = message;
    }
}
