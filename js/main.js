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
import { ProjectionsView } from './views/projections.js';
import { StatisticalAnalyzer } from './engine/statisticalAnalyzer.js';

let currentUser = null;
let currentSession = null;
const appState = {
    currentLottery: 'lotofacil',
    currentStrategy: 'wheeling',
    currentTimeWindow: 100,
    currentBatchSize: 10,
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
            const label = Database.useApi
                ? '✅ Banco Nuvem (Neon Segura) conectado'
                : '✅ Banco Local (IndexedDB) conectado';
            AuthView.updateDbStatus(true, label);
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

        const [stats, sims, games] = await Promise.all([
            UserModel.getStats(user.id),
            Database.getAllByIndex('simulations', 'userId', user.id),
            Database.getAllByIndex('games', 'userId', user.id)
        ]);

        appState.totalGamesGenerated = stats.gamesGenerated || 0;
        appState.totalSimulations = stats.simulations || 0;
        AppView.updateStats(stats);

        const sortedSims = [...(sims || [])].sort((a, b) => (b.id || 0) - (a.id || 0));
        appState.simulationHistory = sortedSims.map(x => ({
            date: new Date(x.createdAt).toLocaleString('pt-BR'),
            lottery: LotteryModel.CONFIG[x.lotteryType]?.name || x.lotteryType,
            strategy: x.strategy,
            games: x.gamesCount || x.totalGames || 10,
            resultsAnalyzed: x.resultsCount || 0
        }));
        AppView.renderHistory(appState.simulationHistory);

        if (games && games.length > 0) {
            const recentGames = [...games]
                .sort((a, b) => (b.id || 0) - (a.id || 0))
                .slice(0, 10)
                .reverse();
            appState.generatedGames = recentGames.map(x => {
                let numbers = x.numbers;
                if (typeof numbers === 'string') {
                    try {
                        numbers = JSON.parse(numbers);
                    } catch (_) {}
                }
                let statsObj = x.stats;
                if (typeof statsObj === 'string') {
                    try {
                        statsObj = JSON.parse(statsObj);
                    } catch (_) {}
                }
                let explanations = x.explanations;
                if (typeof explanations === 'string') {
                    try {
                        explanations = JSON.parse(explanations);
                    } catch (_) {}
                }
                return {
                    numbers: Array.isArray(numbers) ? numbers : [],
                    modelScore: x.modelScore || x.model_score,
                    historicalPerformance: x.historicalPerformance || x.historical_performance,
                    expectedHits: x.expectedHits || x.expected_hits,
                    confidenceLevel: x.confidenceLevel || x.confidence_level,
                    probabilityType: x.probabilityType || x.probability_type,
                    explanations: Array.isArray(explanations) ? explanations : [],
                    stats: statsObj || null,
                    id: x.id
                };
            });
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
        document.querySelectorAll('.auth-tab').forEach(tab =>
            tab.addEventListener('click', () => {
                AuthView.clearErrors();
                AuthView.showForm(tab.dataset.view);
            })
        );

        document.querySelectorAll('[data-action="switch-register"]').forEach(l =>
            l.addEventListener('click', e => {
                e.preventDefault();
                AuthView.clearErrors();
                AuthView.showForm('register');
            })
        );

        document.querySelectorAll('[data-action="switch-login"]').forEach(l =>
            l.addEventListener('click', e => {
                e.preventDefault();
                AuthView.clearErrors();
                AuthView.showForm('login');
            })
        );

        document.getElementById('loginForm').addEventListener('submit', async e => {
            e.preventDefault();
            AuthView.clearErrors();
            const email = document.getElementById('loginEmail').value.trim().toLowerCase();
            const password = document.getElementById('loginPassword').value;
            const remember = document.getElementById('rememberMe').checked;

            AuthView.setLoading(true, 'loginBtn');
            const result = await AuthController.login(email, password, remember);
            AuthView.setLoading(false, 'loginBtn');

            if (result.success) {
                // Item 6.12: a senha vinha do formato antigo e foi convertida agora.
                AppView.showToast(
                    result.passwordUpgraded
                        ? '✅ Login realizado! Sua senha antiga foi convertida — defina uma nova em Perfil.'
                        : '✅ Login realizado com sucesso!',
                    'success'
                );
                setTimeout(() => this.afterLogin(result.user, result.session), 500);
            } else {
                AuthView.showError(result.field === 'email' ? 'loginEmail' : 'loginPassword', result.error);
            }
        });

        document.getElementById('registerForm').addEventListener('submit', async e => {
            e.preventDefault();
            AuthView.clearErrors();
            const name = document.getElementById('regName').value.trim();
            const email = document.getElementById('regEmail').value.trim().toLowerCase();
            const password = document.getElementById('regPassword').value;
            const confirm = document.getElementById('regPasswordConfirm').value;

            let hasError = false;
            if (name.length < 3) {
                AuthView.showError('regName', 'Nome deve ter pelo menos 3 caracteres');
                hasError = true;
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                AuthView.showError('regEmail', 'E-mail inválido');
                hasError = true;
            }
            if (password.length < 8) {
                AuthView.showError('regPassword', 'Mínimo 8 caracteres');
                hasError = true;
            }
            if (password !== confirm) {
                AuthView.showError('regPasswordConfirm', 'Senhas não coincidem');
                hasError = true;
            }
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
                console.error('Erro fatal ao registrar:', err);
                AuthView.setLoading(false, 'regBtn');
                AuthView.showError('regEmail', 'Erro no servidor: ' + (err.message || 'Falha ao conectar'));
            }
        });

        document.querySelectorAll('.password-toggle').forEach(btn =>
            btn.addEventListener('click', () => {
                const input = document.getElementById(btn.dataset.target);
                if (input) {
                    input.type = input.type === 'password' ? 'text' : 'password';
                    btn.textContent = input.type === 'password' ? '👁️' : '🙈';
                }
            })
        );

        document.querySelectorAll('.nav-tab').forEach(tab =>
            tab.addEventListener('click', () => {
                AppView.showScreen(tab.dataset.screen);
                if (tab.dataset.screen === 'statistics') this.updateStats();
                if (tab.dataset.screen === 'conference') {
                    const type = document.getElementById('confLotteryType').value;
                    AppView.renderConferenceInputs(type);
                    AppView.renderLastResult(type, appState.resultsData[type]?.lastResult);
                }
            })
        );

        document.querySelectorAll('.tab-sub-btn').forEach(btn =>
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-sub-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                ['frequency', 'patterns', 'projections', 'history'].forEach(tab => {
                    document.getElementById(`stat-${tab}`).style.display = 'none';
                });
                document.getElementById(`stat-${btn.dataset.tab}`).style.display = 'block';
            })
        );

        document.querySelectorAll('.lottery-card').forEach(card =>
            card.addEventListener('click', () => {
                appState.currentLottery = card.dataset.type;
                appState.fixedNumbers = [];
                appState.excludedNumbers = [];
                AppView.renderLotteryCards(card.dataset.type);
                AppView.renderNumberSelectors(appState.currentLottery, [], []);
                if (appState.resultsData[appState.currentLottery]) {
                    LotteryController.recomputeWindow(
                        appState.resultsData,
                        appState.currentLottery,
                        appState.currentTimeWindow
                    );
                    AppView.renderInsights(appState.currentLottery, appState.resultsData[appState.currentLottery]);
                }
            })
        );

        document.addEventListener('click', e => {
            const ball = e.target.closest('.selector-ball');
            if (!ball || ball.classList.contains('disabled')) return;

            const num = parseInt(ball.dataset.num, 10);
            const type = ball.dataset.type;
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

        document.querySelectorAll('.strategy-option').forEach(opt =>
            opt.addEventListener('click', () => {
                appState.currentStrategy = opt.dataset.strategy;
                AppView.renderStrategies(opt.dataset.strategy);
            })
        );

        document.querySelectorAll('.window-btn[data-window]').forEach(btn =>
            btn.addEventListener('click', () => {
                document.querySelectorAll('.window-btn[data-window]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const winVal = btn.dataset.window;
                appState.currentTimeWindow = winVal === 'full' ? 'full' : parseInt(winVal, 10);
                if (appState.resultsData[appState.currentLottery]) {
                    const updated = LotteryController.recomputeWindow(
                        appState.resultsData,
                        appState.currentLottery,
                        appState.currentTimeWindow
                    );
                    if (updated) {
                        AppView.renderInsights(appState.currentLottery, updated);
                    }
                }
            })
        );

        document.querySelectorAll('.batch-size-btn[data-count]').forEach(btn =>
            btn.addEventListener('click', () => {
                document.querySelectorAll('.batch-size-btn[data-count]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                appState.currentBatchSize = parseInt(btn.dataset.count, 10) || 10;
            })
        );

        document.getElementById('fetchBtn').addEventListener('click', () => this.fetchResults());
        document.getElementById('generateBtn').addEventListener('click', () => this.generateGames());
        document
            .getElementById('btnPermutationTest')
            ?.addEventListener('click', e => this.runPermutationTest(e.currentTarget));

        document.getElementById('confLotteryType').addEventListener('change', e => {
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

        document.getElementById('exportTxtBtn')?.addEventListener('click', () => this.exportGames('txt'));
        document.getElementById('exportPdfBtn')?.addEventListener('click', () => this.exportGames('pdf'));

        document.getElementById('userMenu').addEventListener('click', e => {
            e.stopPropagation();
            AppView.toggleUserDropdown(true);
        });

        document.addEventListener('click', e => {
            if (!e.target.closest('.user-menu')) AppView.toggleUserDropdown(false);
        });

        document.querySelectorAll('.dropdown-item[data-action], .btn[data-action="logout"]').forEach(item =>
            item.addEventListener('click', e => {
                e.stopPropagation();
                AppView.toggleUserDropdown(false);
                const action = item.dataset.action;
                if (action === 'logout') {
                    AutomationController.stop();
                    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
                    AuthController.logout(currentSession?.id).then(() => {
                        currentUser = null;
                        currentSession = null;
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
            })
        );

        document.getElementById('changePassBtn')?.addEventListener('click', async () => {
            if (!currentUser) return;
            const currentPass = document.getElementById('currentPassword').value;
            const newPass = document.getElementById('newPassword').value;
            const confirmPass = document.getElementById('newPasswordConfirm').value;

            if (!currentPass || !newPass || !confirmPass) {
                AppView.showToast('⚠️ Preencha todos os campos de senha!', 'error');
                return;
            }
            if (newPass.length < 8) {
                AppView.showToast('⚠️ A nova senha deve ter no mínimo 8 caracteres!', 'error');
                return;
            }
            if (newPass !== confirmPass) {
                AppView.showToast('⚠️ As senhas novas não coincidem!', 'error');
                return;
            }

            const res = await AuthController.changePassword(currentUser.id, currentPass, newPass);
            if (res.success) {
                document.getElementById('currentPassword').value = '';
                document.getElementById('newPassword').value = '';
                document.getElementById('newPasswordConfirm').value = '';
                AppView.showToast('🔒 Senha atualizada com segurança!', 'success');
            } else {
                AppView.showToast(`❌ ${res.error}`, 'error');
            }
        });

        document.getElementById('deleteAccountBtn')?.addEventListener('click', async () => {
            if (!currentUser) return;
            const passInput = document.getElementById('deleteAccountPassword');
            const password = passInput?.value || '';
            if (!password) {
                AppView.showToast('⚠️ Confirme sua senha para excluir a conta!', 'error');
                return;
            }
            if (
                !window.confirm(
                    'Tem certeza absoluta? Todos os seus jogos, simulações e dados pessoais serão removidos permanentemente (LGPD).'
                )
            ) {
                return;
            }
            const res = await AuthController.deleteAccount(currentUser.id, password);
            if (res.success) {
                AutomationController.stop();
                if (passInput) passInput.value = '';
                document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
                currentUser = null;
                currentSession = null;
                AuthView.show();
                AppView.showToast('🗑️ Conta e dados excluídos permanentemente.', 'success');
            } else {
                AppView.showToast(`❌ ${res.error}`, 'error');
            }
        });

        document.getElementById('runManualBtn')?.addEventListener('click', async () => {
            if (!currentUser) return;
            AppView.showToast('🤖 Executando ciclo manual de automação...', 'info');
            await this.runAutoCycle();
            AppView.showToast('✅ Task de automação concluída!', 'success');
        });

        document.getElementById('clearLogBtn')?.addEventListener('click', () => {
            AutomationModel.state.log = [];
            AppView.renderAutoLog([]);
            AppView.showToast('🗑️ Log de operações limpo!', 'info');
        });

        document.querySelectorAll('[data-action="close-modal"]').forEach(btn =>
            btn.addEventListener('click', () => {
                document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
            })
        );

        const autoToggles = ['autoFetchToggle', 'autoGenerateToggle', 'autoConferenceToggle', 'autoAllLotteriesToggle'];
        autoToggles.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('change', () => this.toggleAutomation(id));
            }
        });

        document.querySelectorAll('.interval-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const minutes = parseInt(btn.dataset.minutes, 10);
                AutomationModel.state.intervalMinutes = minutes;

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
        AppView.setLoading(true, 'Consultando base de dados oficial e calibrando Cadeias de Markov...');

        try {
            const results = await LotteryController.fetchAllResults(
                currentUser.id,
                ['lotofacil', 'mega', 'lotomania', 'quina'],
                appState.currentTimeWindow
            );
            Object.assign(appState.resultsData, results);
            appState.dataReady = true;

            for (const type of Object.keys(results)) {
                AppView.setLotteryStatus(type, results[type].data.length + ' concursos', true);
            }

            const currentData = results[appState.currentLottery];
            AppView.setDataStatus(
                true,
                currentData.data.length + ' concursos',
                'Atualizado: ' + new Date().toLocaleTimeString()
            );
            AppView.setAgentStatus('✅ Base de dados atualizada', false);
            document.getElementById('generateBtn').disabled = false;

            AppView.renderInsights(appState.currentLottery, currentData);
            AppView.renderNumberSelectors(appState.currentLottery, appState.fixedNumbers, appState.excludedNumbers);

            const totalAnalyzed = Object.values(results).reduce((s, r) => s + r.data.length, 0);
            const stats = await UserModel.incrementStats(currentUser.id, { resultsAnalyzed: totalAnalyzed });
            AppView.updateStats(stats);

            AppView.showToast('✅ Sincronização concluída!', 'success');
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
        const batchCount = appState.currentBatchSize || 10;
        AppView.setLoading(true, `Agente IA rodando Poda Gaussiana + Simulated Annealing para ${batchCount} jogos...`);
        const type = appState.currentLottery;
        const rd = appState.resultsData[type];
        if (!rd) {
            AppView.setLoading(false);
            return;
        }

        try {
            const games = await LotteryController.generateGames(
                currentUser.id,
                type,
                appState.currentStrategy,
                rd,
                appState.fixedNumbers,
                appState.excludedNumbers,
                appState.currentTimeWindow,
                batchCount
            );
            appState.generatedGames = games;

            const stats = await UserModel.incrementStats(currentUser.id, {
                gamesDelta: games.length,
                simulationsDelta: 1
            });

            appState.totalGamesGenerated = stats.gamesGenerated;
            appState.totalSimulations = stats.simulations;
            AppView.updateStats(stats);
            AppView.renderGames(games, type);

            appState.simulationHistory.unshift({
                date: new Date().toLocaleString('pt-BR'),
                lottery: LotteryModel.CONFIG[type].name,
                strategy: appState.currentStrategy,
                games: games.length,
                resultsAnalyzed: rd.data.length
            });
            AppView.renderHistory(appState.simulationHistory);
            AppView.showToast(`✅ ${games.length} jogos de alta precisão gerados!`, 'success');
        } catch (e) {
            console.error('Generation error:', e);
            AppView.showToast('❌ Erro ao gerar jogos', 'error');
        } finally {
            AppView.setLoading(false);
        }
    }

    static async updateStats() {
        const type = appState.currentLottery;
        const rd = appState.resultsData[type];
        if (!rd || !rd.analysis) {
            StatisticsView.showStats(false);
            StatisticsView.showPatterns(false);
            ProjectionsView.showEmpty('Selecione uma modalidade e carregue o histórico para projetar.');
            return;
        }

        // Painel de projeções: usa o histórico real (para a taxa de acúmulo) e os
        // jogos gerados (para a cobertura exata da carteira).
        try {
            ProjectionsView.render({
                config: LotteryModel.CONFIG[type],
                games: appState.generatedGames || [],
                history: rd.data || [],
                draws: 52
            });
        } catch (e) {
            console.warn('Falha ao renderizar projeções:', e);
            ProjectionsView.showEmpty('Não foi possível calcular as projeções.');
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

            if (appState.generatedGames.modelPipeline) {
                StatisticsView.renderModelReport(appState.generatedGames.modelPipeline);
                if (appState.generatedGames.modelPipeline.backtestResult?.walkForward) {
                    StatisticsView.renderWalkForward(appState.generatedGames.modelPipeline.backtestResult.walkForward);
                }
                if (appState.generatedGames.modelPipeline.monteCarloResult) {
                    StatisticsView.renderMonteCarloChart(appState.generatedGames.modelPipeline.monteCarloResult);
                }
            } else if (appState.generatedGames[0]?.monteCarlo) {
                StatisticsView.renderMonteCarloChart(appState.generatedGames[0].monteCarlo);
            }
        }

        if (rd.data && rd.data.length > 0) {
            const benchmark = await LotteryController.runStrategyBenchmarkAsync(rd.data, LotteryModel.CONFIG[type]);
            StatisticsView.renderStrategyBenchmark(benchmark);
        }
    }

    /**
     * Teste de permutação sob demanda: embaralha a ordem dos concursos N vezes e
     * roda o pipeline em cada versão. Responde se a ordem temporal carrega
     * informação — pergunta que o p-valor do backtest não responde.
     */
    static async runPermutationTest(button) {
        const type = appState.currentLottery;
        const rd = appState.resultsData[type];
        if (!rd?.data || rd.data.length < 20) {
            StatisticsView.renderPermutationTest({
                available: false,
                reason: 'Histórico insuficiente (mínimo de 20 concursos) para o teste de permutação.'
            });
            return;
        }

        const original = button ? button.textContent : null;
        if (button) {
            button.disabled = true;
            button.textContent = '⏳ Rodando permutações...';
        }
        try {
            const result = await LotteryController.runPermutationTestAsync(rd.data, LotteryModel.CONFIG[type], {
                runs: 99,
                windowSize: 30,
                seed: 123456
            });
            StatisticsView.renderPermutationTest(result);
        } catch (err) {
            StatisticsView.renderPermutationTest({
                available: false,
                reason: `Falha ao executar o teste: ${err?.message || err}`
            });
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = original;
            }
        }
    }

    static exportGames(format) {
        if (!appState.generatedGames.length) return;
        const cfg = LotteryModel.CONFIG[appState.currentLottery];
        const proj =
            appState.generatedGames.portfolioProjection ||
            appState.generatedGames[0]?.futureProjection?.portfolioProjection;
        const wheelMeta = appState.generatedGames.wheelMetadata || appState.generatedGames[0]?.wheelMetadata;

        if (format === 'pdf') {
            this.exportPrintableVolanteSheet(cfg, proj, wheelMeta);
            return;
        }

        let content = `LOTOSIMSIMULADOR - JOGOS INTELIGENTES (${cfg.name})\n`;
        content += `Data: ${new Date().toLocaleString('pt-BR')}\n`;
        content += `Estratégia: ${appState.currentStrategy.toUpperCase()}\n`;
        if (proj) {
            content += `Premio maximo da carteira (exato): ${proj.portfolioDirectOdds}\n`;
            content += `Observacao: a poda de ${proj.spacePrunedPercentage} reduz o espaco gerado, nao a probabilidade de acerto.\n`;
            if (proj.financial) {
                content += `Custo Oficial da Carteira: ${proj.financial.totalInvestmentFormatted} (${proj.ticketCount} jogos x ${proj.financial.unitPriceFormatted})\n`;
            }
        }
        if (wheelMeta) {
            content += `Grupo de Elite (${wheelMeta.elitePoolSize} dezenas): ${wheelMeta.elitePool.map(n => String(n).padStart(2, '0')).join(', ')}\n`;
            content += `Cobertura de Pares no Grupo: ${wheelMeta.pairCoverageGuaranteePct}%\n`;
        }
        content += `------------------------------------------\n\n`;

        appState.generatedGames.forEach((g, i) => {
            const nums = g.numbers.map(n => String(n).padStart(2, '0')).join(' - ');
            content += `JOGO #${i + 1} [Score: ${g.modelScore}/100 | Gauss: ${g.gaussianQualityIndex || 85}% | EV ≈ ${g.expectedValueMultiplier || 1.1}x]\n`;
            content += `${nums}\n\n`;
        });

        const blob = new Blob([content], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `jogos_${appState.currentLottery}_${Date.now()}.txt`;
        a.click();
        AppView.showToast('📥 Arquivo TXT gerado com sucesso!', 'success');
    }

    /**
     * Gera uma Folha de Volantes 2D Real para Impressão / Salvamento em PDF (100% compatível com CSP estrita)
     */
    static exportPrintableVolanteSheet(cfg, proj, wheelMeta) {
        const { cols } = StatisticalAnalyzer.getGridDimensions(cfg.total);
        const fin = proj?.financial;

        const cardsHtml = appState.generatedGames
            .map((g, idx) => {
                const numSet = new Set(g.numbers);
                let gridCells = '';
                for (let n = 1; n <= cfg.total; n++) {
                    const marked = numSet.has(n);
                    gridCells += `<div class="cell ${marked ? 'marked' : ''}">${String(n).padStart(2, '0')}</div>`;
                }
                return `
                <div class="volante-card">
                    <div class="volante-header">
                        <strong>JOGO #${idx + 1} (${cfg.name})</strong>
                        <span>Score: ${g.modelScore}/100 · Gauss: ${g.gaussianQualityIndex || 85}% · EV ≈ ${g.expectedValueMultiplier || 1.1}x</span>
                    </div>
                    <div class="numbers-line">${g.numbers.map(n => String(n).padStart(2, '0')).join(' - ')}</div>
                    <div class="volante-grid" style="grid-template-columns: repeat(${cols}, 1fr);">
                        ${gridCells}
                    </div>
                </div>
            `;
            })
            .join('');

        const printHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Volantes Oficiais - ${cfg.name} - Lotosimsimulador</title>
    <style>
        body { font-family: Arial, sans-serif; color: #111827; margin: 20px; background: #fff; }
        .header { border-bottom: 2px solid #10b981; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-start; }
        .summary-box { background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 8px; padding: 12px; margin-bottom: 18px; font-size: 12px; line-height: 1.5; }
        .grid-wrapper { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
        .volante-card { border: 1.5px solid #374151; border-radius: 8px; padding: 10px; page-break-inside: avoid; }
        .volante-header { display: flex; justify-content: space-between; font-size: 11px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin-bottom: 6px; }
        .numbers-line { font-size: 11px; font-weight: bold; color: #047857; margin-bottom: 8px; text-align: center; }
        .volante-grid { display: grid; gap: 3px; }
        .cell { border: 1px solid #9ca3af; border-radius: 3px; text-align: center; font-size: 10px; padding: 3px 0; color: #4b5563; }
        .cell.marked { background: #111827; color: #fff; font-weight: bold; border-color: #111827; }
        @media print { .no-print { display: none; } body { margin: 8px; } }
    </style>
</head>
<body>
    <div class="no-print" style="margin-bottom:14px;">
        <button id="printNowBtn" style="padding:8px 16px;background:#10b981;color:#fff;border:none;border-radius:6px;font-weight:bold;cursor:pointer;">🖨️ Imprimir / Salvar como PDF</button>
    </div>
    <div class="header">
        <div>
            <h2 style="margin:0;">🎱 Lotosimsimulador — Folha de Volantes (${cfg.name})</h2>
            <div style="font-size:12px;color:#6b7280;">Estratégia: ${appState.currentStrategy.toUpperCase()} · Gerado em ${new Date().toLocaleString('pt-BR')}</div>
        </div>
        <div style="text-align:right;font-size:12px;">
            <strong>${appState.generatedGames.length} Bilhetes</strong><br>
            ${fin ? `Investimento: <strong>${fin.totalInvestmentFormatted}</strong>` : ''}
        </div>
    </div>
    <div class="summary-box">
        ${proj ? `<div><strong>Projeção Combinatória:</strong> 1 Jogo: ${proj.rawSingleOdds} | Carteira (${proj.ticketCount} jogos distintos): <strong>${proj.portfolioDirectOdds}</strong> | P(≥ 1 prêmio ≥ ${proj.minPrizeTier} pts): ≤ ${proj.anyPrizePortfolioOdds} (${proj.anyPrizePortfolioProbability}%) <span style="color:#94a3b8;">— poda de ${proj.spacePrunedPercentage} não altera odds</span></div>` : ''}
        ${wheelMeta ? `<div><strong>Matriz de Fechamento (${wheelMeta.elitePoolSize} dezenas):</strong> [${wheelMeta.elitePool.map(n => String(n).padStart(2, '0')).join(', ')}] — Cobertura de Pares: ${wheelMeta.pairCoverageGuaranteePct}%</div>` : ''}
    </div>
    <div class="grid-wrapper">${cardsHtml}</div>
</body>
</html>`;

        const win = window.open('', '_blank');
        if (win) {
            win.document.write(printHtml);
            win.document.close();
            win.document.getElementById('printNowBtn')?.addEventListener('click', () => win.print());
            setTimeout(() => {
                try {
                    win.focus();
                    win.print();
                } catch (_) {}
            }, 350);
            AppView.showToast('📄 Folha de Volantes PDF aberta para impressão!', 'success');
        } else {
            const blob = new Blob([printHtml], { type: 'text/html' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `volantes_${appState.currentLottery}_${Date.now()}.html`;
            a.click();
            AppView.showToast('📄 Folha de Volantes baixada!', 'success');
        }
    }

    static conferenceCheck() {
        const type = document.getElementById('confLotteryType').value;
        const cfg = LotteryModel.CONFIG[type];
        const drawnCount = cfg.drawn || cfg.pick;
        const drawn = [];

        for (let i = 0; i < drawnCount; i++) {
            const val = parseInt(document.getElementById(`conf-${i}`).value, 10);
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

    static toggleAutomation(id) {
        const key = id.replace('Toggle', '').toLowerCase();
        if (key === 'autofetch') AutomationModel.state.autoFetch = document.getElementById(id).checked;
        else if (key === 'autogenerate') AutomationModel.state.autoGenerate = document.getElementById(id).checked;
        else if (key === 'autoconference') AutomationModel.state.autoConference = document.getElementById(id).checked;
        else if (key === 'autoalllotteries')
            AutomationModel.state.autoAllLotteries = document.getElementById(id).checked;

        AutomationModel.state.active =
            AutomationModel.state.autoFetch ||
            AutomationModel.state.autoGenerate ||
            AutomationModel.state.autoConference;

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
        const [gameCount, simCount, resultsCount] = await Promise.all([
            currentUser ? Database.count('games') : 0,
            currentUser ? Database.count('simulations') : 0,
            Database.count('lottery_results')
        ]);

        document.getElementById('dbStatsContent').innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
                <div>🎲 Seus Jogos: <strong>${gameCount}</strong></div>
                <div>📊 Suas Sims: <strong>${simCount}</strong></div>
                <div>📋 Concursos em Cache: <strong>${resultsCount}</strong></div>
                <div>🔒 Backend: <strong>${Database.useApi ? 'API Serverless (Neon)' : 'IndexedDB Local'}</strong></div>
            </div>`;
    }

    static async exportData() {
        try {
            const [games, sims, stats] = await Promise.all([
                Database.getAllByIndex('games', 'userId', currentUser.id),
                Database.getAllByIndex('simulations', 'userId', currentUser.id),
                UserModel.getStats(currentUser.id)
            ]);
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
