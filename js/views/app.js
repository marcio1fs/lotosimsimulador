import { LotteryModel } from '../models/lottery.js';

/**
 * View: App - Main dashboard and screens
 */
export class AppView {
    static setUser(user) {
        const initials = user.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        document.getElementById('userAvatarHeader').textContent = initials;
        document.getElementById('userNameHeader').textContent = user.name;
        document.getElementById('dropdownName').textContent = user.name;
        document.getElementById('dropdownEmail').textContent = user.email;
        document.getElementById('profileAvatar').textContent = initials;
        document.getElementById('profileName').textContent = user.name;
        document.getElementById('profileEmail').textContent = user.email;
        document.getElementById('profileJoined').textContent = `Membro desde: ${new Date(user.createdAt).toLocaleDateString('pt-BR')}`;
    }

    static updateStats(stats) {
        document.getElementById('totalGamesGenerated').textContent = stats.gamesGenerated;
        document.getElementById('totalSimulations').textContent = stats.simulations;
        document.getElementById('resultsAnalyzed').textContent = stats.resultsAnalyzed;
        document.getElementById('profileGames').textContent = stats.gamesGenerated;
        document.getElementById('profileSims').textContent = stats.simulations;
        document.getElementById('profileResults').textContent = stats.resultsAnalyzed;
    }

    static showScreen(screen) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        const targetScreen = document.getElementById('screen-' + screen);
        const targetTab = document.querySelector(`.nav-tab[data-screen="${screen}"]`);
        if (targetScreen) targetScreen.classList.add('active');
        if (targetTab) targetTab.classList.add('active');
    }

    static toggleUserDropdown(show) {
        document.getElementById('userDropdown').classList.toggle('show', show);
    }

    static showToast(message, type = 'success') {
        const existing = document.querySelector('.toast'); if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    static setLoading(show, steps) {
        document.getElementById('loadingOverlay').classList.toggle('active', show);
        if (steps) document.getElementById('loadingSteps').textContent = steps;
    }

    static setAgentStatus(text, loading) {
        const el = document.getElementById('agentStatus');
        el.textContent = text;
        el.className = 'agent-status' + (loading ? ' loading' : '');
    }

    static setDataStatus(connected, count, time) {
        document.getElementById('dataDot').className = 'data-status-dot' + (connected ? ' green' : '');
        document.getElementById('dataStatusText').textContent = connected ? 'Conectado à API' : 'Sem conexão';
        document.getElementById('dataCount').textContent = count;
        document.getElementById('lastFetchTime').textContent = time;
    }

    static setLotteryStatus(type, text, ready) {
        const el = document.getElementById('status-' + type);
        if (el) { el.textContent = text; el.className = 'lottery-card-status' + (ready ? ' ready' : ''); }
    }

    static renderLotteryCards(type) {
        document.querySelectorAll('.lottery-card').forEach(c => c.classList.toggle('selected', c.dataset.type === type));
    }

    static renderStrategies(strategy) {
        document.querySelectorAll('.strategy-option').forEach(o => o.classList.toggle('selected', o.dataset.strategy === strategy));
    }

    static renderNumberSelectors(type, fixed = [], excluded = []) {
        const cfg = LotteryModel.CONFIG[type];
        const containers = {
            fixed: document.getElementById('fixedNumbers'),
            excluded: document.getElementById('excludedNumbers')
        };

        if (!containers.fixed || !containers.excluded) return;

        const renderPool = (container, list, otherList, className) => {
            container.innerHTML = Array.from({length: cfg.total}, (_, i) => {
                const num = i + 1;
                const isSelected = list.includes(num);
                const isDisabled = otherList.includes(num);
                return `<div class="selector-ball ${isSelected ? className : ''} ${isDisabled ? 'disabled' : ''}" 
                             data-num="${num}" data-type="${className}">${String(num).padStart(2,'0')}</div>`;
            }).join('');
        };

        renderPool(containers.fixed, fixed, excluded, 'fixed');
        renderPool(containers.excluded, excluded, fixed, 'excluded');
    }

    static renderInsights(type, resultsData) {
        const results = resultsData.data;
        const analysis = resultsData.analysis;
        if (!results || !analysis) return;
        const cfg = LotteryModel.CONFIG[type];
        const freq = resultsData.freq || analysis.freqAbsolute || {};
        const atraso = resultsData.atraso || analysis.currentDelay || {};

        if (!freq || Object.keys(freq).length === 0) return;

        const entries = Object.entries(freq).map(([num, f]) => ({ num: parseInt(num), freq: f }));
        const sorted = [...entries].sort((a, b) => b.freq - a.freq);
        const hot = sorted.slice(0, 5);
        const cold = sorted.slice(-5).reverse();
        
        const atrasoEntries = Object.entries(atraso).map(([num, a]) => ({ num: parseInt(num), atraso: a }));
        const mostDelayed = [...atrasoEntries].sort((a, b) => b.atraso - a.atraso).slice(0, 3);

        document.getElementById('insightsContainer').style.display = 'block';
        document.getElementById('insightsGrid').innerHTML = `
            <div class="insight-card"><div class="insight-card-title">📊 Resultados</div><div class="insight-card-value">${results.length}</div></div>
            <div class="insight-card"><div class="insight-card-title">🔥 Quentes</div><div class="insight-card-value">${hot.map(h => String(h.num).padStart(2, '0')).join(', ')}</div></div>
            <div class="insight-card"><div class="insight-card-title">🧊 Frios</div><div class="insight-card-value">${cold.map(c => String(c.num).padStart(2, '0')).join(', ')}</div></div>
            <div class="insight-card"><div class="insight-card-title">⏱️ Atrasados</div><div class="insight-card-value">${mostDelayed.map(d => String(d.num).padStart(2, '0')).join(', ')}</div><div class="insight-card-detail">Concursos: ${mostDelayed[0].atraso}</div></div>
            <div class="insight-card"><div class="insight-card-title">📈 Amostragem</div><div class="insight-card-value">${results.length > 0 ? 'Real' : 'Vazia'}</div></div>`;
    }


    static renderGames(games, type) {
        const cfg = LotteryModel.CONFIG[type];
        const exportActions = document.getElementById('exportActions');
        
        if (!games || !games.length) { 
            this.renderEmptyGames(); 
            if (exportActions) exportActions.style.display = 'none';
            return; 
        }

        if (exportActions) exportActions.style.display = 'flex';

        const policy = games.forecastPolicy || games[0]?.forecastPolicy;
        const policyNotice = policy ? `
            <div style="grid-column:1/-1;padding:0.9rem 1rem;border-radius:10px;background:rgba(245,158,11,0.10);border:1px solid rgba(245,158,11,0.35);font-size:0.78rem;line-height:1.45;color:var(--text-main);">
                <strong>Uso responsável — ${policy.label}</strong><br>
                ${policy.detail}<br>
                <span style="color:var(--text-muted)">${policy.probabilityLabel || 'Chance por combinacao'}: ${policy.probabilityPerCombination}. ${policy.disclaimer}</span>
            </div>` : '';

        document.getElementById('gamesGrid').innerHTML = policyNotice + games.map((g, i) => {
            const stats = typeof g.stats === 'string' ? JSON.parse(g.stats) : g.stats;
            const explanations = typeof g.explanations === 'string' ? JSON.parse(g.explanations) : (g.explanations || []);
            const modelScore = g.modelScore || 0;
            const perf = g.historicalPerformance ? g.historicalPerformance : 'Sem dados';
            const expectedHitsDisplay = typeof g.expectedHits === 'number' ? `${g.expectedHits} acertos` : 'Dados estatísticos insuficientes';
            const ci = g.confidenceInterval;
            const seed = g.seed;
            const mc = g.monteCarlo;
            const coverage = g.portfolioCoverage;
            const projection = g.futureProjection;

            // Badge de significância
            const sigBadge = g.statisticallySignificant === true || g.isStatisticallySignificant === true 
                ? '<span class="badge badge-green" style="font-size:0.6rem;">✅ Significante</span>'
                : g.statisticallySignificant === false || g.isStatisticallySignificant === false
                    ? '<span class="badge badge-gold" style="font-size:0.6rem;">⚠️ Não-significante</span>'
                    : '';

            const ciMethodText = ci && ci.method ? ` (${ci.method})` : '';

            return `
            <div class="game-card animate-in" style="animation-delay:${i*0.05}s">
                <div class="game-card-header">
                    <span class="game-number">${cfg.icon} Jogo #${i+1}</span>
                    <span class="game-prob badge-purple">Score: ${modelScore}/100</span>
                </div>
                
                <div class="game-metrics-row" style="display:flex; flex-wrap:wrap; gap:0.5rem; font-size:0.72rem; color:var(--text-muted); margin-bottom:0.75rem; background:rgba(255,255,255,0.03); padding:0.5rem 0.6rem; border-radius:6px;">
                    <div>Histórico: <strong style="color:var(--accent-green);">${perf}</strong></div>
                    <div>Esperado: <strong>${expectedHitsDisplay}</strong></div>
                    ${ci && typeof ci.lower === 'number' ? `<div>IC 95%${ciMethodText}: <strong>[${ci.lower} — ${ci.upper}]</strong></div>` : ''}
                    ${sigBadge}
                </div>

                <div class="game-balls">
                    ${g.numbers.map((n, ni) => `<div class="ball ${cfg.color} ball-animate" style="animation-delay:${(i*0.05)+(ni*0.03)}s">${String(n).padStart(2,'0')}</div>`).join('')}
                </div>

                ${stats ? `
                <div class="game-stats">
                    <div class="game-stat-item">
                        <div class="game-stat-label">Pares</div>
                        <div class="game-stat-value">${stats.evens}</div>
                    </div>
                    <div class="game-stat-item">
                        <div class="game-stat-label">Primos</div>
                        <div class="game-stat-value">${stats.primes}</div>
                    </div>
                    <div class="game-stat-item">
                        <div class="game-stat-label">Soma</div>
                        <div class="game-stat-value">${stats.sum}</div>
                    </div>
                    ${coverage ? `<div class="game-stat-item"><div class="game-stat-label">Cobertura</div><div class="game-stat-value">${coverage}%</div></div>` : ''}
                </div>
                ` : ''}

                ${mc ? `
                <div style="margin-top:0.5rem; font-size:0.7rem; color:var(--text-muted); background:rgba(139,92,246,0.05); padding:0.4rem 0.6rem; border-radius:6px; border:1px solid rgba(139,92,246,0.1);">
                    <span style="font-weight:600;">🎲 Monte Carlo:</span> Estabilidade ${mc.stabilityScore}/100 · ${mc.iterations} sims
                </div>
                ` : ''}

                ${projection ? `
                <div style="margin-top:0.5rem; font-size:0.7rem; color:var(--text-muted); background:rgba(59,130,246,0.06); padding:0.45rem 0.6rem; border-radius:6px; border:1px solid rgba(59,130,246,0.18);">
                    <span style="font-weight:600;">Proximo sorteio (calculo exato):</span>
                    media de ${projection.expectedHits} acertos · faixa central de 95%: ${projection.predictionInterval.lower}-${projection.predictionInterval.upper} · acerto maximo: ${projection.fullHitOdds}<br>
                    <span style="font-size:0.64rem;">${projection.disclaimer}</span>
                </div>
                ` : ''}

                ${explanations && explanations.length > 0 ? `
                <div class="game-explanations" style="margin-top:0.75rem; font-size:0.72rem; color:var(--text-muted); border-top:1px dashed rgba(255,255,255,0.1); padding-top:0.5rem;">
                    <div style="font-weight:600; color:var(--text-main); margin-bottom:0.25rem;">🔍 Motivos da Seleção:</div>
                    ${explanations.slice(0, 3).map(exp => `<div style="margin-bottom:0.15rem;">${exp}</div>`).join('')}
                </div>
                ` : ''}

                ${seed ? `<div style="font-size:0.6rem; color:var(--text-muted); margin-top:0.4rem; opacity:0.6;">Seed: ${seed}</div>` : ''}
            </div>`;
        }).join('');
    }

    static renderEmptyGames() {
        document.getElementById('gamesGrid').innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="empty-state-icon">🤖</div><div class="empty-state-text">Sincronize os dados e clique em "Gerar Jogos Inteligentes"</div></div>';
    }

    static renderConferenceInputs(type) {
        const cfg = LotteryModel.CONFIG[type];
        const drawnCount = cfg.drawn || cfg.pick;
        document.getElementById('confHint').textContent = `Digite as ${drawnCount} dezenas sorteadas`;
        document.getElementById('confInputs').innerHTML = Array.from({length: drawnCount}, (_, i) => `<input type="number" class="number-input" min="1" max="${cfg.total}" placeholder="${String(i+1).padStart(2,'0')}" id="conf-${i}">`).join('');
    }

    static renderLastResult(type, lastResult) {
        if (!lastResult) { 
            document.getElementById('lastResultContainer').innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">Dados não disponíveis para esta loteria</div></div>'; 
            return; 
        }
        const cfg = LotteryModel.CONFIG[type];
        document.getElementById('lastResultContainer').innerHTML = `
            <div class="last-result-card animate-in">
                <div class="last-result-header"><div><h3>${cfg.icon} Concurso #${lastResult.concurso} - ${cfg.name}</h3></div></div>
                <div class="last-result-info" style="margin-bottom:1.5rem;"><span>📅 ${lastResult.data}</span>${lastResult.valor ? `<span>💰 ${lastResult.valor}</span>` : ''}${lastResult.acumulado ? '<span class="badge badge-gold">ACUMULOU!</span>' : ''}</div>
                <div class="last-result-balls">${lastResult.dezenas.map((d, i) => `<div class="ball ${cfg.color} ball-animate" style="animation-delay:${i*0.05}s;width:45px;height:45px;font-size:0.9rem;font-weight:800;">${d}</div>`).join('')}</div>
            </div>`;
    }

    static renderConferenceResults(results, type, lastResult) {
        const cfg = LotteryModel.CONFIG[type];
        const drawnCount = cfg.drawn || cfg.pick;
        const totalHits = results.reduce((s, r) => s + r.hitCount, 0);
        const maxHits = Math.max(...results.map(r => r.hitCount));
        const avgHits = (totalHits / results.length).toFixed(1);
        let html = `<div class="results-panel animate-in"><h3 style="font-size:0.9rem;margin-bottom:1rem;">Relatório de Conferência</h3>
            <div class="result-summary">
                <div class="result-item"><div class="result-item-value neutral">${results.length}</div><div class="result-item-label">Jogos</div></div>
                <div class="result-item"><div class="result-item-value neutral">${totalHits}</div><div class="result-item-label">Acertos totais</div></div>
                <div class="result-item"><div class="result-item-value ${maxHits>0?'win':'lose'}">${maxHits}/${drawnCount}</div><div class="result-item-label">Melhor Jogo</div></div>
                <div class="result-item"><div class="result-item-value neutral">${avgHits}</div><div class="result-item-label">Média</div></div>
            </div>`;
        if (lastResult?.dezenas) {
            html += `<div style="margin-bottom:1rem;padding:0.75rem;background:rgba(255,255,255,0.03);border-radius:10px;"><div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.5rem;">Dezenas Sorteadas:</div>
                <div style="display:flex;gap:0.3rem;flex-wrap:wrap;">${lastResult.dezenas.map(d => `<div class="ball ${cfg.color} small">${d}</div>`).join('')}</div></div>`;
        }
        results.forEach(r => {
            const pct = ((r.hitCount / drawnCount) * 100).toFixed(0);
            const bar = pct > 50 ? 'green' : pct > 20 ? 'gold' : 'purple';
            html += `<div style="padding:0.75rem 0;border-bottom:1px solid rgba(255,255,255,0.05);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;"><span style="font-size:0.8rem;font-weight:600;">Jogo #${r.id}</span><span class="badge ${r.hitCount>0?'badge-green':'badge-red'}">${r.hitCount}/${drawnCount} acertos</span></div>
                <div style="display:flex;gap:0.3rem;flex-wrap:wrap;margin-bottom:0.5rem;">${r.numbers.map(n => `<div class="ball ${cfg.color} ${r.hits?.includes(n)?'hit':'miss'}" style="width:30px;height:30px;font-size:0.65rem;">${String(n).padStart(2,'0')}</div>`).join('')}</div>
                <div class="progress-bar-container"><div class="progress-label"><span>Percentual de Acerto</span><span>${pct}%</span></div><div class="progress-bar"><div class="progress-fill ${bar}" style="width:${pct}%"></div></div></div></div>`;
        });
        html += '</div>';
        document.getElementById('confResults').innerHTML = html;
    }

    static renderHistory(history) {
        const tbody = document.getElementById('historyBody');
        if (!history.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">Nenhuma simulação registrada</td></tr>'; return; }
        tbody.innerHTML = history.map(h => `<tr><td>${h.date}</td><td><span class="badge badge-purple">${h.lottery}</span></td><td>${h.strategy}</td><td>${h.games}</td><td><span class="badge badge-green">Concluído</span></td></tr>`).join('');
    }

    static renderAutoLog(log) {
        const container = document.getElementById('autoLog');
        if (!container) return;
        container.innerHTML = log.map(e => `<div class="auto-log-entry"><span class="auto-log-time">${e.time}</span><span class="auto-log-type ${e.type}">${e.type==='fetch'?'🔄':e.type==='generate'?'⚡':e.type==='conference'?'🔍':e.type==='error'?'❌':'ℹ️'} ${e.message}</span></div>`).join('');
    }

    static updateAutoUI(state) {
        document.getElementById('autoFetchToggle').checked = state.autoFetch;
        document.getElementById('autoGenerateToggle').checked = state.autoGenerate;
        document.getElementById('autoConferenceToggle').checked = state.autoConference;
        document.getElementById('autoAllLotteriesToggle').checked = state.autoAllLotteries;
        document.getElementById('autoMasterStatus').textContent = state.active ? 'Ativo' : 'Offline';
        document.getElementById('execCountToday').textContent = state.execCountToday;
        if (state.nextRun) {
            const diff = Math.round((state.nextRun - new Date()) / 60000);
            document.getElementById('nextRunTime').textContent = diff > 0 ? diff + 'min' : 'Agora';
        }
        document.querySelectorAll('.interval-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.minutes) === state.intervalMinutes));
        document.getElementById('autoIndicator').style.display = state.active ? 'flex' : 'none';
    }
}
