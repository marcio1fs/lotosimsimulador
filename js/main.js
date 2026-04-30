import { Database } from './db/database.js';
import { AuthController } from './controllers/auth.js';
import { LotteryController } from './controllers/lottery.js';
import { AutomationController } from './controllers/automation.js';
import { UserModel } from './models/user.js';
import { LotteryModel } from './models/lottery.js';
import { AutomationModel } from './models/automation.js';
import { AuthView } from './views/auth.js';
import { AppView } from './views/app.js';
import { StatisticsView } from './views/statistics.js';

let currentUser = null;
let currentSession = null;
const appState = { 
    currentLottery: 'lotofacil', 
    currentStrategy: 'weighted', 
    generatedGames: [], 
    simulationHistory: [], 
    resultsData: {}, 
    fixedNumbers: [],
    excludedNumbers: [],
    totalGamesGenerated: 0, 
    totalSimulations: 0, 
    dataReady: false 
};

class AppController {
    static async init() {
        try {
            await Database.init();
            AuthView.updateDbStatus(true, '✅ Banco de dados conectado');
        } catch (e) {
            AuthView.updateDbStatus(false, '❌ Erro ao conectar banco de dados');
            return;
        }

        const sessionResult = await AuthController.validateSession();
        if (sessionResult) {
            this.afterLogin(sessionResult.user, sessionResult.session);
        }

        this.bindEvents();
        AppView.renderConferenceInputs(appState.currentLottery);
        AppView.renderNumberSelectors(appState.currentLottery, appState.fixedNumbers, appState.excludedNumbers);
    }

    static async afterLogin(user, session) {
        currentUser = user; 
        currentSession = session;
        AppView.setUser(user);
        AuthView.hide();

        const stats = await UserModel.getStats(user.id);
        appState.totalGamesGenerated = stats.gamesGenerated;
        appState.totalSimulations = stats.simulations;
        AppView.updateStats(stats);

        const sims = await Database.getAllByIndex('simulations', 'userId', user.id);
        appState.simulationHistory = sims.reverse().map(x => ({ 
            date: new Date(x.createdAt).toLocaleString('pt-BR'), 
            lottery: LotteryModel.CONFIG[x.lotteryType]?.name || x.lotteryType, 
            strategy: x.strategy, 
            games: x.gamesCount||10, 
            resultsAnalyzed: x.resultsCount||0 
        }));
        AppView.renderHistory(appState.simulationHistory);

        const games = await Database.getAllByIndex('games', 'userId', user.id);
        if (games.length > 0) {
            appState.generatedGames = games.slice(-10).map(x => ({ 
                numbers: JSON.parse(x.numbers), 
                probability: x.probability, 
                stats: x.stats ? JSON.parse(x.stats) : null,
                id: x.id 
            }));
            AppView.renderGames(appState.generatedGames, appState.currentLottery);
        }

        if (AutomationModel.state.active) {
            AutomationController.start(() => this.runAutoCycle());
        }
        
        if (AutomationModel.state.autoFetch) {
            setTimeout(() => this.runAutoCycle(), 1000);
        }
    }

    static bindEvents() {
        // Auth tabs
        document.querySelectorAll('.auth-tab').forEach(tab => tab.addEventListener('click', () => { 
            AuthView.clearErrors(); 
            AuthView.showForm(tab.dataset.view); 
        }));
        
        document.querySelectorAll('[data-action="switch-register"]').forEach(l => l.addEventListener('click', (e) => { 
            e.preventDefault(); 
            AuthView.clearErrors(); 
            AuthView.showForm('register'); 
        }));
        
        document.querySelectorAll('[data-action="switch-login"]').forEach(l => l.addEventListener('click', (e) => { 
            e.preventDefault(); 
            AuthView.clearErrors(); 
            AuthView.showForm('login'); 
        }));

        // Login
        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault(); 
            AuthView.clearErrors();
            const email = document.getElementById('loginEmail').value.trim().toLowerCase();
            const password = document.getElementById('loginPassword').value;
            const remember = document.getElementById('rememberMe').checked;
            
            AuthView.setLoading(true, 'loginBtn');
            const result = await AuthController.login(email, password, remember);
            AuthView.setLoading(false, 'loginBtn');
            
            if (result.success) {
                AppView.showToast('✅ Login realizado com sucesso!', 'success');
                setTimeout(() => this.afterLogin(result.user, result.session), 500);
            } else {
                AuthView.showError(result.field === 'email' ? 'loginEmail' : 'loginPassword', result.error);
            }
        });

        // Register
        document.getElementById('registerForm').addEventListener('submit', async (e) => {
            e.preventDefault(); 
            AuthView.clearErrors();
            const name = document.getElementById('regName').value.trim();
            const email = document.getElementById('regEmail').value.trim().toLowerCase();
            const password = document.getElementById('regPassword').value;
            const confirm = document.getElementById('regPasswordConfirm').value;
            
            let hasError = false;
            if (name.length < 3) { AuthView.showError('regName', 'Nome deve ter pelo menos 3 caracteres'); hasError = true; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { AuthView.showError('regEmail', 'E-mail inválido'); hasError = true; }
            if (password.length < 6) { AuthView.showError('regPassword', 'Mínimo 6 caracteres'); hasError = true; }
            if (password !== confirm) { AuthView.showError('regPasswordConfirm', 'Senhas não coincidem'); hasError = true; }
            if (hasError) return;
            
            AuthView.setLoading(true, 'regBtn');
            try {
                const result = await AuthController.register(name, email, password);
                AuthView.setLoading(false, 'regBtn');
                
                if (result.success) {
                    AppView.showToast('✅ Conta criada com sucesso!', 'success');
                    setTimeout(() => { 
                        AuthView.showForm('login'); 
                        document.getElementById('loginEmail').value = email; 
                    }, 500);
                } else {
                    AuthView.showError('regEmail', result.error);
                }
            } catch (err) {
                console.error("Erro fatal ao registrar:", err);
                AuthView.setLoading(false, 'regBtn');
                AuthView.showError('regEmail', 'Erro no servidor: ' + (err.message || 'Falha ao conectar'));
            }
        });

        // Password toggle
        document.querySelectorAll('.password-toggle').forEach(btn => btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.target);
            if (input) { 
                input.type = input.type === 'password' ? 'text' : 'password'; 
                btn.textContent = input.type === 'password' ? '👁️' : '🙈'; 
            }
        }));

        // Nav tabs
        document.querySelectorAll('.nav-tab').forEach(tab => tab.addEventListener('click', () => {
            AppView.showScreen(tab.dataset.screen);
            if (tab.dataset.screen === 'statistics') this.updateStats();
            if (tab.dataset.screen === 'conference') { 
                const type = document.getElementById('confLotteryType').value;
                AppView.renderConferenceInputs(type); 
                AppView.renderLastResult(type, appState.resultsData[type]?.lastResult); 
            }
        }));



        // Sub tabs (Estatísticas)
        document.querySelectorAll('.tab-sub-btn').forEach(btn => btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-sub-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            ['frequency', 'patterns', 'history'].forEach(tab => {
                document.getElementById(`stat-${tab}`).style.display = 'none';
            });
            document.getElementById(`stat-${btn.dataset.tab}`).style.display = 'block';
        }));

        // Lottery cards
        document.querySelectorAll('.lottery-card').forEach(card => card.addEventListener('click', () => {
            appState.currentLottery = card.dataset.type;
            appState.fixedNumbers = [];
            appState.excludedNumbers = [];
            AppView.renderLotteryCards(card.dataset.type);
            AppView.renderNumberSelectors(appState.currentLottery, [], []);
            if (appState.resultsData[appState.currentLottery]) {
                AppView.renderInsights(appState.currentLottery, appState.resultsData[appState.currentLottery]);
            }
        }));

        // Number Selector interaction
        document.addEventListener('click', (e) => {
            const ball = e.target.closest('.selector-ball');
            if (!ball || ball.classList.contains('disabled')) return;
            
            const num = parseInt(ball.dataset.num);
            const type = ball.dataset.type; // 'fixed' or 'excluded'
            const cfg = LotteryModel.CONFIG[appState.currentLottery];

            if (type === 'fixed') {
                if (appState.fixedNumbers.includes(num)) {
                    appState.fixedNumbers = appState.fixedNumbers.filter(n => n !== num);
                } else if (appState.fixedNumbers.length < cfg.pick - 1) {
                    appState.fixedNumbers.push(num);
                } else {
                    AppView.showToast(`⚠️ Máximo de ${cfg.pick - 1} dezenas fixas!`, 'info');
                }
            } else {
                if (appState.excludedNumbers.includes(num)) {
                    appState.excludedNumbers = appState.excludedNumbers.filter(n => n !== num);
                } else {
                    appState.excludedNumbers.push(num);
                }
            }
            AppView.renderNumberSelectors(appState.currentLottery, appState.fixedNumbers, appState.excludedNumbers);
        });

        // Strategies
        document.querySelectorAll('.strategy-option').forEach(opt => opt.addEventListener('click', () => {
            appState.currentStrategy = opt.dataset.strategy;
            AppView.renderStrategies(opt.dataset.strategy);
        }));

        // Fetch button
        document.getElementById('fetchBtn').addEventListener('click', () => this.fetchResults());

        // Generate button
        document.getElementById('generateBtn').addEventListener('click', () => this.generateGames());

        // Conference
        document.getElementById('confLotteryType').addEventListener('change', (e) => {
            const type = e.target.value;
            AppView.renderConferenceInputs(type);
            AppView.renderLastResult(type, appState.resultsData[type]?.lastResult);
        });
        
        document.getElementById('useLastBtn').addEventListener('click', () => {
            const type = document.getElementById('confLotteryType').value;
            const last = appState.resultsData[type]?.lastResult;
            if (!last?.dezenas) { 
                AppView.showToast('⚠️ Busque os dados primeiro!', 'error'); 
                return; 
            }
            last.dezenas.forEach((d, i) => { 
                const input = document.getElementById(`conf-${i}`); 
                if (input) input.value = d; 
            });
            AppView.showToast('✅ Dezenas copiadas!', 'success');
        });
        
        document.getElementById('confBtn').addEventListener('click', () => this.conferenceCheck());

        // Export Buttons
        document.getElementById('exportTxtBtn')?.addEventListener('click', () => this.exportGames('txt'));
        document.getElementById('exportPdfBtn')?.addEventListener('click', () => this.exportGames('txt')); // Simula PDF como TXT formatado por enquanto

        // User menu
        document.getElementById('userMenu').addEventListener('click', (e) => {
            e.stopPropagation();
            AppView.toggleUserDropdown(true);
        });
        
        document.addEventListener('click', (e) => { 
            if (!e.target.closest('.user-menu')) AppView.toggleUserDropdown(false); 
        });

        // Dropdown actions
        document.querySelectorAll('.dropdown-item[data-action]').forEach(item => item.addEventListener('click', (e) => {
            e.stopPropagation();
            AppView.toggleUserDropdown(false);
            const action = item.dataset.action;
            if (action === 'logout') {
                AuthController.logout(currentSession?.id).then(() => { 
                    AuthView.show(); 
                    AppView.showToast('👋 Até logo!', 'success'); 
                });
            }
            if (action === 'open-profile') document.getElementById('profileModal').classList.add('active');
            if (action === 'open-auto') { 
                document.getElementById('autoModal').classList.add('active'); 
                AppView.updateAutoUI(AutomationModel.state); 
                AppView.renderAutoLog(AutomationModel.state.log); 
            }
            if (action === 'open-db-info') { 
                document.getElementById('dbInfoModal').classList.add('active'); 
                this.showDbInfo(); 
            }
            if (action === 'export-data') this.exportData();
        }));

        // Close modals
        document.querySelectorAll('[data-action="close-modal"]').forEach(btn => btn.addEventListener('click', () => {
            document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
        }));

        // Automation Toggles
        const autoToggles = ['autoFetchToggle', 'autoGenerateToggle', 'autoConferenceToggle', 'autoAllLotteriesToggle'];
        autoToggles.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => this.toggleAutomation(id));
            }
        });

        // Automation Interval Buttons
        document.querySelectorAll('.interval-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const minutes = parseInt(btn.dataset.minutes);
                AutomationModel.state.intervalMinutes = minutes;
                
                // Restart timer se estiver ativo
                if (AutomationModel.state.active) {
                    AutomationController.start(() => this.runAutoCycle());
                }
                
                AutomationModel.save(currentUser.id);
                AppView.updateAutoUI(AutomationModel.state);
                AutomationModel.addLog('info', `Intervalo alterado para ${minutes}min`);
                AppView.renderAutoLog(AutomationModel.state.log);
            });
        });
    }

    static async fetchResults() {
        const btn = document.getElementById('fetchBtn');
        btn.disabled = true;
        AppView.setAgentStatus('Sincronizando...', true);
        AppView.setLoading(true, 'Consultando base de dados oficial...');
        
        try {
            const results = await LotteryController.fetchAllResults(currentUser.id, ['lotofacil','mega','lotomania','quina']);
            Object.assign(appState.resultsData, results);
            appState.dataReady = true;
            
            for (const type of Object.keys(results)) {
                AppView.setLotteryStatus(type, results[type].data.length + ' concursos', true);
            }
            
            const currentData = results[appState.currentLottery];
            AppView.setDataStatus(true, currentData.data.length + ' concursos', 'Atualizado: ' + new Date().toLocaleTimeString());
            AppView.setAgentStatus('✅ Base de dados atualizada', false);
            document.getElementById('generateBtn').disabled = false;
            
            AppView.renderInsights(appState.currentLottery, currentData);
            AppView.renderNumberSelectors(appState.currentLottery, appState.fixedNumbers, appState.excludedNumbers);
            
            const stats = await UserModel.getStats(currentUser.id);
            stats.resultsAnalyzed = Object.values(results).reduce((s, r) => s + r.data.length, 0);
            await UserModel.updateStats(currentUser.id, stats);
            AppView.updateStats(stats);
            
            AppView.showToast(`✅ Sincronização concluída!`, 'success');
        } catch (e) {
            console.error('Fetch error:', e);
            AppView.showToast('❌ Falha na sincronização', 'error');
            AppView.setAgentStatus('❌ Erro de conexão', false);
        } finally {
            AppView.setLoading(false);
            btn.disabled = false;
        }
    }

    static async generateGames() {
        AppView.setLoading(true, 'Agente IA analisando padrões...');
        const type = appState.currentLottery;
        const rd = appState.resultsData[type];
        if (!rd) { AppView.setLoading(false); return; }
        
        try {
            const games = await LotteryController.generateGames(
                currentUser.id, 
                type, 
                appState.currentStrategy, 
                rd, 
                appState.fixedNumbers, 
                appState.excludedNumbers
            );
            appState.generatedGames = games;
            
            const stats = await UserModel.getStats(currentUser.id);
            stats.gamesGenerated += 10; 
            stats.simulations += 1;
            await UserModel.updateStats(currentUser.id, stats);
            
            appState.totalGamesGenerated = stats.gamesGenerated;
            appState.totalSimulations = stats.simulations;
            AppView.updateStats(stats);
            AppView.renderGames(games, type);
            
            appState.simulationHistory.unshift({ 
                date: new Date().toLocaleString('pt-BR'), 
                lottery: LotteryModel.CONFIG[type].name, 
                strategy: appState.currentStrategy, 
                games: 10, 
                resultsAnalyzed: rd.data.length 
            });
            AppView.renderHistory(appState.simulationHistory);
            AppView.showToast(`✅ 10 novos jogos inteligentes gerados!`, 'success');
        } catch (e) {
            console.error('Generation error:', e);
            AppView.showToast('❌ Erro ao gerar jogos', 'error');
        } finally {
            AppView.setLoading(false);
        }
    }

    static exportGames(format) {
        if (!appState.generatedGames.length) return;
        const cfg = LotteryModel.CONFIG[appState.currentLottery];
        let content = `LOTOSIMSIMULADOR - JOGOS INTELIGENTES (${cfg.name})\n`;
        content += `Data: ${new Date().toLocaleString('pt-BR')}\n`;
        content += `Estratégia: ${appState.currentStrategy.toUpperCase()}\n`;
        content += `------------------------------------------\n\n`;

        appState.generatedGames.forEach((g, i) => {
            const nums = g.numbers.map(n => String(n).padStart(2, '0')).join(' - ');
            content += `JOGO #${i+1} [Confiança: ${g.probability}%]\n`;
            content += `${nums}\n\n`;
        });

        const blob = new Blob([content], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `jogos_${appState.currentLottery}_${Date.now()}.txt`;
        a.click();
        AppView.showToast('📥 Arquivo gerado com sucesso!', 'success');
    }

    static conferenceCheck() {
        const type = document.getElementById('confLotteryType').value;
        const cfg = LotteryModel.CONFIG[type];
        const drawnCount = cfg.drawn || cfg.pick;
        const drawn = [];
        
        for (let i = 0; i < drawnCount; i++) {
            const val = parseInt(document.getElementById(`conf-${i}`).value);
            if (!val || val < 1 || val > cfg.total) { 
                AppView.showToast('⚠️ Informe todas as dezenas!', 'error'); 
                return; 
            }
            drawn.push(val);
        }
        
        if (appState.generatedGames.length === 0) { 
            AppView.showToast('⚠️ Nenhuma simulação ativa!', 'error'); 
            return; 
        }
        
        const results = appState.generatedGames.map(g => {
            const hits = g.numbers.filter(n => drawn.includes(n));
            return { ...g, hits, hitCount: hits.length };
        });
        
        AppView.renderConferenceResults(results, type, appState.resultsData[type]?.lastResult);
    }

    static updateStats() {
        const type = appState.currentLottery;
        const rd = appState.resultsData[type];
        if (!rd || !rd.analysis) { 
            StatisticsView.showStats(false); 
            StatisticsView.showPatterns(false); 
            return; 
        }
        
        StatisticsView.showStats(true);
        StatisticsView.renderFrequency(type, rd);
        StatisticsView.renderParity(rd, type);
        StatisticsView.renderRange(type, rd);
        StatisticsView.renderFreqGrid(type, rd);
        
        if (appState.generatedGames.length > 0) {
            StatisticsView.showPatterns(true);
            StatisticsView.renderProbChart(appState.generatedGames);
            StatisticsView.renderComparisonChart(appState.generatedGames, type, rd);
            StatisticsView.renderRanking(appState.generatedGames);
        }
    }

    static toggleAutomation(id) {
        const key = id.replace('Toggle','').toLowerCase(); // 'autofetch'
        if (key === 'autofetch') AutomationModel.state.autoFetch = document.getElementById(id).checked;
        else if (key === 'autogenerate') AutomationModel.state.autoGenerate = document.getElementById(id).checked;
        else if (key === 'autoconference') AutomationModel.state.autoConference = document.getElementById(id).checked;
        else if (key === 'autoalllotteries') AutomationModel.state.autoAllLotteries = document.getElementById(id).checked;
        
        AutomationModel.state.active = AutomationModel.state.autoFetch || AutomationModel.state.autoGenerate || AutomationModel.state.autoConference;
        
        if (AutomationModel.state.active) {
            AutomationController.start(() => this.runAutoCycle());
        } else {
            AutomationController.stop();
        }
        
        AutomationModel.save(currentUser.id);
        AppView.updateAutoUI(AutomationModel.state);
        AutomationModel.addLog('info', `Config: ${key} = ${document.getElementById(id).checked ? 'ON' : 'OFF'}`);
        AppView.renderAutoLog(AutomationModel.state.log);
    }

    static async runAutoCycle() {
        if (!currentUser) return;
        await AutomationController.executeCycle(currentUser.id, appState);
        AppView.updateAutoUI(AutomationModel.state);
        AppView.renderAutoLog(AutomationModel.state.log);
        
        if (document.getElementById('screen-simulation').classList.contains('active')) {
            AppView.renderGames(appState.generatedGames, appState.currentLottery);
        }
    }

    static async showDbInfo() {
        const userCount = await Database.count('users');
        const sessionCount = await Database.count('sessions');
        const gameCount = currentUser ? (await Database.getAllByIndex('games', 'userId', currentUser.id)).length : 0;
        const simCount = currentUser ? (await Database.getAllByIndex('simulations', 'userId', currentUser.id)).length : 0;
        const resultsCount = await Database.count('lottery_results');
        
        document.getElementById('dbStatsContent').innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
                <div>👤 Usuários: <strong>${userCount}</strong></div>
                <div>🔑 Sessões: <strong>${sessionCount}</strong></div>
                <div>🎲 Jogos: <strong>${gameCount}</strong></div>
                <div>📊 Sims: <strong>${simCount}</strong></div>
                <div>📋 Resultados: <strong>${resultsCount}</strong></div>
                <div>💾 Storage: <strong>IndexedDB</strong></div>
            </div>`;
    }

    static async exportData() {
        try {
            const games = await Database.getAllByIndex('games', 'userId', currentUser.id);
            const sims = await Database.getAllByIndex('simulations', 'userId', currentUser.id);
            const stats = await UserModel.getStats(currentUser.id);
            const data = { 
                user: { name: currentUser.name, email: currentUser.email }, 
                exportDate: new Date().toISOString(), 
                games, 
                simulations: sims, 
                stats 
            };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a'); 
            a.href = URL.createObjectURL(blob);
            a.download = `loto_mais_export_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            AppView.showToast('📥 Exportação concluída!', 'success');
        } catch (e) { 
            AppView.showToast('❌ Erro ao exportar dados', 'error'); 
        }
    }
}


document.addEventListener('DOMContentLoaded', () => AppController.init());

