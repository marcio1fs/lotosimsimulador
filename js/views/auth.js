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
        const target = document.getElementById(form + 'Form');
        if (target) target.classList.add('active');
        // `forgot` e `reset` não têm aba: quando elas aparecem, nenhuma aba fica ativa
        // (o `?.` evita o TypeError que existiria ao buscar aba inexistente).
        document.querySelector(`.auth-tab[data-view="${form}"]`)?.classList.add('active');
        this.clearNotices();
    }

    /** Zera as caixas de aviso (não são erro — são resposta do servidor). */
    static clearNotices() {
        document.querySelectorAll('.form-notice').forEach(n => {
            n.textContent = '';
            n.classList.remove('show');
        });
    }

    /** Mostra uma resposta informativa abaixo do formulário. */
    static showNotice(id, message, type = 'info') {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = message;
        el.classList.remove('show', 'danger');
        if (type === 'danger') el.classList.add('danger');
        el.classList.add('show');
    }

    static clearErrors() {
        document.querySelectorAll('.form-error').forEach(e => {
            e.classList.remove('show');
            e.textContent = '';
        });
        document.querySelectorAll('.form-input').forEach(i => i.classList.remove('error'));
    }

    static showError(field, message) {
        const input = document.getElementById(field);
        const error =
            document.getElementById(field + 'Error') || input?.closest('.form-group')?.querySelector('.form-error');
        if (input) input.classList.add('error');
        if (error) {
            error.textContent = message;
            error.classList.add('show');
        }
    }

    static setLoading(loading, btnId) {
        const btn = document.getElementById(btnId);
        if (!btn) return;
        const labels = {
            loginBtn: ['Verificando...', 'Entrar'],
            regBtn: ['Criando conta...', 'Criar Conta'],
            forgotBtn: ['Enviando...', 'Enviar link'],
            resetBtn: ['Salvando...', 'Salvar senha nova']
        };
        const [busy, idle] = labels[btnId] || ['Aguarde...', 'Enviar'];
        btn.disabled = loading;
        btn.textContent = loading ? busy : idle;
    }

    static updateDbStatus(connected, message) {
        const dot = document.querySelector('.db-status-dot');
        const text = document.getElementById('dbStatusText');
        dot.className = 'db-status-dot' + (connected ? '' : message.includes('Erro') ? ' error' : ' loading');
        text.textContent = message;
    }
}
