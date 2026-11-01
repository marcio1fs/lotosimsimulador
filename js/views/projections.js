/**
 * ProjectionsView — Painel de Projeções Futuras
 *
 * Renderiza as projeções do FutureProjectionEngine. Toda a linguagem aqui é
 * deliberadamente conservadora: são projeções do PROCESSO (probabilidades, espera,
 * custo, retorno esperado), nunca previsão de dezenas.
 */

import { FutureProjectionEngine, DRAW_FREQUENCY_PER_WEEK } from '../engine/futureProjectionEngine.js';

const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v, d = 0) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (v, d = 2) => `${(Number(v || 0) * 100).toFixed(d)}%`;
const fmtBig = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    if (n >= 1e12) return `${(n / 1e12).toFixed(1)} trilhões`;
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)} bilhões`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)} milhões`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)} mil`;
    return fmtNum(n);
};

export class ProjectionsView {
    static _last = null;

    /**
     * @param {Object} params
     * @param {Object} params.config - configuração da modalidade
     * @param {Array} params.games - jogos gerados (opcional)
     * @param {Array} params.history - histórico de concursos (opcional)
     * @param {number} params.draws - horizonte de concursos (padrão 52)
     */
    static render({ config, games = [], history = [], draws = 52, ticketCount = null }) {
        const container = document.getElementById('projectionsContent');
        const emptyState = document.getElementById('projectionsEmpty');
        if (!container || !config) return;

        const tickets = Array.isArray(games) && games.length > 0
            ? games.map(g => g.numbers).filter(n => Array.isArray(n) && n.length === config.pick)
            : null;
        const effectiveTickets = ticketCount || (tickets ? tickets.length : 1);

        const projection = FutureProjectionEngine.project({
            config,
            ticketCount: effectiveTickets,
            draws,
            history,
            tickets: tickets && tickets.length === effectiveTickets ? tickets : null
        });
        if (!projection) return;
        ProjectionsView._last = projection;

        if (emptyState) emptyState.style.display = 'none';
        container.style.display = 'block';

        const drawsPerWeek = DRAW_FREQUENCY_PER_WEEK[config.total] || 3;
        const h = projection.horizon;
        const fin = projection.financial;
        const wait = projection.waitingTime;
        const cov = projection.coverage;
        const acc = projection.accumulation;

        const milestoneCards = h.milestones.map(m => `
            <div style="flex:1; min-width:150px; background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:0.7rem;">
                <div style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">Chance acumulada de ${m.confidenceLabel}</div>
                <div style="font-size:1.05rem; font-weight:800; color:var(--text-main); margin:0.2rem 0;">${m.humanized}</div>
                <div style="font-size:0.7rem; color:var(--text-muted);">${fmtBig(m.draws)} concursos</div>
            </div>`).join('');

        const tierRows = Object.entries(cov.tiers)
            .sort((a, b) => Number(b[0]) - Number(a[0]))
            .map(([k, t]) => `
                <tr>
                    <td><strong>${k} acerto${Number(k) > 1 ? 's' : ''}</strong></td>
                    <td>${t.exactlyOdds || '—'}</td>
                    <td>${t.exact ? 'exato' : `entre ${fmtPct(t.lowerBound, 3)} e ${fmtPct(t.upperBound, 3)}`}</td>
                    <td style="color:var(--text-muted); font-size:0.7rem;">${t.method || ''}${t.monteCarlo ? ` (${fmtNum(t.monteCarlo.iterations)} sim.)` : ''}</td>
                </tr>`).join('');

        const survivalRows = h.survival.map(s => `
            <tr>
                <td>${fmtNum(s.draws)} concursos <span style="color:var(--text-muted);">(~${fmtNum(s.weeks, 0)} semanas)</span></td>
                <td>${fmtPct(s.probabilityNoWin, 6)}</td>
                <td>${fmtPct(s.probabilityAtLeastOneWin, 6)}</td>
            </tr>`).join('');

        const finRows = fin.tiers.map(t => `
            <tr>
                <td><strong>${t.hits} acertos</strong></td>
                <td>${t.odds}</td>
                <td>${fmtBRL(t.prize)}</td>
                <td>${fmtBRL(t.expectedReturn)}</td>
            </tr>`).join('');

        const accBlock = acc.available ? `
            <div style="display:flex; flex-wrap:wrap; gap:1rem;">
                <div style="flex:1; min-width:140px;">
                    <div style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase;">Taxa de acúmulo</div>
                    <div style="font-size:1.4rem; font-weight:800;">${fmtPct(acc.rate, 1)}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">IC 95%: ${fmtPct(acc.wilson.lower, 1)} – ${fmtPct(acc.wilson.upper, 1)}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">${acc.accumulatedDraws} de ${acc.sampleSize} concursos acumularam</div>
                </div>
                <div style="flex:1; min-width:140px;">
                    <div style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase;">Sequência atual</div>
                    <div style="font-size:1.4rem; font-weight:800;">${acc.currentStreak}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">recorde: ${acc.longestStreak} · média: ${acc.averageStreak}</div>
                </div>
                <div style="flex:1; min-width:140px;">
                    <div style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase;">P(acumular 2× seguidas)</div>
                    <div style="font-size:1.4rem; font-weight:800;">${fmtPct(acc.probabilityOfTwoInARow, 2)}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">estimativa pontual</div>
                </div>
            </div>
            <div style="margin-top:0.6rem; font-size:0.68rem; color:var(--text-muted);">${acc.caveat}</div>
        ` : `
            <div style="font-size:0.78rem; color:var(--text-muted);">${acc.reason || 'Dados de acúmulo indisponíveis.'}</div>
        `;

        container.innerHTML = `
            <div class="stats-section">
                <div class="stat-card" style="grid-column:1/-1; border-left:3px solid var(--accent-green);">
                    <div class="stat-card-title"><span>🔭</span> O que este painel projeta — e o que ele não faz</div>
                    <div style="font-size:0.8rem; line-height:1.65; color:var(--text-main);">
                        <strong>Não prevê dezenas.</strong> Em sorteio idôneo toda combinação tem exatamente a mesma chance,
                        e o histórico não altera o próximo resultado.<br>
                        <strong>Projeta com exatidão matemática:</strong> quanto tempo até uma probabilidade alvo,
                        curva de sobrevivência, espera por dezena, cobertura da carteira, custo determinístico e
                        retorno esperado por faixa oficial.<br>
                        <span style="font-size:0.72rem; color:var(--text-muted);">${projection.disclaimer}</span>
                    </div>
                </div>

                <div class="stat-card" style="grid-column:1/-1;">
                    <div class="stat-card-title"><span>⏳</span> Tempo até a "certeza estatística" — ${config.name}</div>
                    <div style="display:flex; flex-wrap:wrap; gap:0.8rem; margin:0.6rem 0;">
                        ${milestoneCards}
                    </div>
                    <div style="font-size:0.72rem; color:var(--text-muted); line-height:1.6;">
                        Carteira de <strong>${h.ticketCount}</strong> jogo(s) · odds por concurso <strong>${h.portfolioOdds}</strong>
                        · ${h.drawsPerWeek} sorteios/semana · espera média até o primeiro acerto:
                        <strong>${fmtBig(h.expectedDrawsToWin)} concursos</strong> (<strong>${fmtNum(h.expectedYearsToWin, 0)} anos</strong>).<br>
                        ${h.note}
                    </div>
                </div>

                <div class="stat-card">
                    <div class="stat-card-title"><span>📉</span> Curva de Sobrevivência</div>
                    <table class="history-table">
                        <thead><tr><th>Horizonte</th><th>P(nenhum acerto máximo)</th><th>P(≥1 acerto máximo)</th></tr></thead>
                        <tbody>${survivalRows}</tbody>
                    </table>
                </div>

                <div class="stat-card">
                    <div class="stat-card-title"><span>⏱️</span> Espera por uma Dezena</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; font-size:0.78rem; margin-bottom:0.5rem;">
                        <div>Atraso médio esperado: <strong>${wait.expectedDraws} concursos</strong></div>
                        <div>Odds por concurso: <strong>${wait.oddsPerDraw}</strong></div>
                        <div>Mediana: <strong>${wait.medianDraws} concursos</strong></div>
                        <div>P90: <strong>${wait.p90Draws} · P99: ${wait.p99Draws}</strong></div>
                        <div>P(sair em ≤ ${wait.horizonDraws}): <strong>${fmtPct(wait.probabilityWithinHorizon, 1)}</strong></div>
                        <div>P(ausente em ${wait.horizonDraws}): <strong>${fmtPct(wait.probabilityAbsentWithinHorizon, 2)}</strong></div>
                    </div>
                    <div style="font-size:0.68rem; color:var(--text-muted); line-height:1.55;">${wait.note}</div>
                </div>

                <div class="stat-card" style="grid-column:1/-1;">
                    <div class="stat-card-title"><span>🛡️</span> Cobertura da Carteira (${cov.ticketCount} jogo${cov.ticketCount > 1 ? 's' : ''})</div>
                    <table class="history-table">
                        <thead><tr><th>Faixa</th><th>Odds por bilhete (exatamente k)</th><th>Probabilidade da carteira</th><th>Método</th></tr></thead>
                        <tbody>${tierRows}</tbody>
                    </table>
                    <div style="margin-top:0.5rem; font-size:0.72rem; line-height:1.6;">
                        Prêmio máximo da carteira: <strong>${cov.jackpot.odds}</strong> (${cov.jackpot.exact ? 'valor exato' : 'limites calculados'}).<br>
                        P(ao menos um prêmio qualquer): <strong>${fmtPct(cov.anyPrize.probability, 4)}</strong>
                        ${cov.anyPrize.exact ? '(exato)' : `(limites: ${fmtPct(cov.anyPrize.lowerBound ?? 0, 4)} – ${fmtPct(cov.anyPrize.upperBound, 4)})`}.<br>
                        <span style="color:var(--text-muted); font-size:0.68rem;">${cov.note}</span>
                    </div>
                </div>

                <div class="stat-card">
                    <div class="stat-card-title"><span>💰</span> Projeção Financeira (${fin.draws} concursos)</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.45rem; font-size:0.78rem; margin-bottom:0.6rem;">
                        <div>Custo por concurso: <strong>${fmtBRL(fin.costPerDraw)}</strong></div>
                        <div>Custo total: <strong style="color:#f87171;">${fmtBRL(fin.totalCost)}</strong></div>
                        <div>Retorno esperado: <strong>${fmtBRL(fin.expectedReturnTotal)}</strong></div>
                        <div>Resultado esperado: <strong style="color:${fin.expectedNet < 0 ? '#f87171' : 'var(--accent-green)'};">${fmtBRL(fin.expectedNet)}</strong></div>
                        <div>Taxa de retorno: <strong>${fmtPct(fin.expectedReturnRate, 2)}</strong></div>
                        <div>Perda por real: <strong>${fmtBRL(fin.expectedLossPerReal)}</strong></div>
                    </div>
                    <table class="history-table">
                        <thead><tr><th>Faixa</th><th>Odds</th><th>Prêmio estimado</th><th>Retorno esperado</th></tr></thead>
                        <tbody>${finRows}</tbody>
                    </table>
                    <div style="margin-top:0.5rem; font-size:0.68rem; color:var(--text-muted); line-height:1.55;">${fin.caveat}</div>
                </div>

                <div class="stat-card">
                    <div class="stat-card-title"><span>📈</span> Projeção de Acúmulo do Prêmio</div>
                    ${accBlock}
                </div>
            </div>`;
    }

    /** Chamado quando ainda não há dados suficientes. */
    static showEmpty(message = 'Selecione uma modalidade e carregue o histórico.') {
        const container = document.getElementById('projectionsContent');
        const emptyState = document.getElementById('projectionsEmpty');
        if (container) container.style.display = 'none';
        if (emptyState) {
            emptyState.style.display = 'block';
            const text = emptyState.querySelector('.empty-state-text');
            if (text) text.textContent = message;
        }
    }
}
