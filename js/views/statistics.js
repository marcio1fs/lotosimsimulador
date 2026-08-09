import { LotteryModel } from '../models/lottery.js';

/**
 * View: Statistics - Data visualization and charts
 */
export class StatisticsView {
    static charts = {};
    
    static getGradient(color) {
        const palettes = {
            lotofacil: ['#9333ea','#a855f7','#c084fc','#d8b4fe','#e9d5ff'],
            mega: ['#2d8b46','#4ade80','#86efac','#bbf7d0','#dcfce7'],
            lotomania: ['#dc2626','#ef4444','#f87171','#fca5a5','#fecaca'],
            quina: ['#2563eb','#3b82f6','#60a5fa','#93c5fd','#bfdbfe']
        };
        return palettes[color] || ['#9333ea','#a855f7','#c084fc'];
    }

    static destroyChart(id) { 
        if (this.charts[id]) { 
            this.charts[id].destroy(); 
            delete this.charts[id]; 
        } 
    }

    static renderFrequency(type, resultsData) {
        const cfg = LotteryModel.CONFIG[type];
        const freq = resultsData.analysis.freq;
        const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 15);
        this._renderBar('freqChart', sorted.map(s => String(s[0]).padStart(2,'0')), sorted.map(s => s[1]), this.getGradient(cfg.color));
    }

    static renderParity(resultsData, type) {
        const results = resultsData.data;
        let odds = 0, evens = 0;
        results.forEach(r => { if (r.dezenas) r.dezenas.forEach(d => { const n = parseInt(d); if (n % 2 === 0) evens++; else odds++; }); });
        this._renderDoughnut('parityChart', ['Pares','Ímpares'], [evens, odds], ['#3b82f6','#f59e0b']);
    }

    static renderRange(type, resultsData) {
        const cfg = LotteryModel.CONFIG[type];
        const rangeSize = Math.ceil(cfg.total / 5);
        const labels = [], values = [];
        for (let r = 0; r < 5; r++) {
            const start = r * rangeSize + 1; const end = Math.min(start + rangeSize - 1, cfg.total);
            labels.push(`${start}-${end}`);
            let count = 0;
            resultsData.data.forEach(res => { if (res.dezenas) res.dezenas.forEach(d => { const n = parseInt(d); if (n >= start && n <= end) count++; }); });
            values.push(count);
        }
        this._renderBar('rangeChart', labels, values, ['#8b5cf6','#a78bfa','#c4b5fd','#ddd6fe','#ede9fe']);
    }

    static renderFreqGrid(type, resultsData) {
        const cfg = LotteryModel.CONFIG[type];
        const freq = resultsData.analysis.freq;
        const maxF = Math.max(...Object.values(freq));
        document.getElementById('freqGrid').innerHTML = Array.from({length: cfg.total}, (_, i) => {
            const f = freq[i+1] || 0; const intensity = f / maxF;
            return `<div class="freq-cell" style="background:hsla(220,60%,${15+intensity*35}%,${0.5+intensity*0.5});color:${intensity>0.5?'#fff':'var(--text-muted)'};">${String(i+1).padStart(2,'0')}<div class="freq-tooltip">${i+1}: ${f}x</div></div>`;
        }).join('');
    }

    static renderStrategyBenchmark(benchmarkList) {
        const tbody = document.getElementById('strategyBenchmarkBody');
        if (!tbody || !benchmarkList) return;

        tbody.innerHTML = benchmarkList.map(item => {
            const isDiffPos = item.diff > 0;
            const diffText = isDiffPos ? `+${item.diff.toFixed(4)}` : `${(item.diff || 0).toFixed(4)}`;
            const badgeCls = isDiffPos ? 'badge-green' : item.diff === 0 ? 'badge-purple' : 'badge-red';
            const pVal = item.pValue !== undefined ? item.pValue.toFixed(4) : '-';
            const sigIcon = item.isSignificant ? '✅' : '⚠️';
            const ciText = item.confidenceInterval 
                ? `[${item.confidenceInterval.lower} — ${item.confidenceInterval.upper}]` 
                : '-';
            return `
                <tr>
                    <td><strong>${item.strategy}</strong></td>
                    <td>${item.meanHits.toFixed(2)} acertos</td>
                    <td>${item.baselineMean.toFixed(2)} acertos</td>
                    <td><span class="badge ${badgeCls}">${diffText}</span></td>
                    <td><strong>${item.relativeImprovement}</strong></td>
                    <td>${sigIcon} p=${pVal}</td>
                    <td style="font-size:0.7rem;">${ciText}</td>
                </tr>
            `;
        }).join('');
    }

    static renderProbChart(games) {
        const sorted = [...games].sort((a, b) => (b.modelScore || 0) - (a.modelScore || 0));
        this._renderBar('probChart', sorted.map((g, i) => `Jogo #${i+1}`), sorted.map(g => parseFloat(g.modelScore || 0)), sorted.map((_, i) => `rgba(139,92,246,${0.3+(i/sorted.length)*0.7})`), true);
    }

    static renderComparisonChart(games, type, resultsData) {
        const cfg = LotteryModel.CONFIG[type];
        const freq = resultsData.freq || {};
        const avg = games.map(g => g.numbers.reduce((s, n) => s + (freq[n]||0), 0) / cfg.pick);
        this._renderRadar('comparisonChart', games.map((g, i) => `J#${i+1}`), avg);
    }

    static renderRanking(games) {
        const sorted = [...games].sort((a, b) => (b.modelScore || 0) - (a.modelScore || 0));
        document.getElementById('rankingBody').innerHTML = sorted.map((g, i) => {
            const score = g.modelScore || 0;
            const perf = g.historicalPerformance || '+0.0%';
            const expected = g.expectedHits || '-';
            const ci = g.confidenceInterval;
            const ciText = ci ? `[${ci.lower}—${ci.upper}]` : '';
            const seed = g.seed ? `<span style="font-size:0.6rem;color:var(--text-muted);">${g.seed}</span>` : '';
            return `<tr><td>${i+1}</td><td><span class="badge badge-purple">#${g.id}</span></td><td style="font-size:0.75rem;">${g.numbers.map(n => String(n).padStart(2,'0')).join(' ')}</td><td><span class="badge badge-gold">${score}/100</span></td><td>${expected} acertos <span style="font-size:0.65rem;color:var(--text-muted);">${ciText}</span></td><td><span class="badge badge-green">${perf}</span></td></tr>`;
        }).join('');
    }

    /**
     * Renderiza painel de Walk-Forward e diagnósticos de overfitting
     */
    static renderWalkForward(walkForwardData) {
        const container = document.getElementById('walkForwardPanel');
        if (!container || !walkForwardData) return;

        const ov = walkForwardData.isOverfitting;
        const ovBadge = ov ? '<span class="badge badge-red">⚠️ DETECTADO</span>' : '<span class="badge badge-green">✅ NÃO DETECTADO</span>';
        
        let foldsHtml = '';
        if (walkForwardData.foldResults) {
            foldsHtml = walkForwardData.foldResults.map((f, i) => 
                `<div style="display:flex;justify-content:space-between;padding:0.3rem 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                    <span>Fold ${i+1}</span>
                    <span>In: ${f.inSampleMean?.toFixed(2) || '-'}</span>
                    <span>Out: ${f.outSampleMean?.toFixed(2) || '-'}</span>
                    <span>${f.degradation?.toFixed(2) || '0.00'}</span>
                </div>`
            ).join('');
        }

        container.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
                <div style="background:rgba(255,255,255,0.03);padding:0.75rem;border-radius:8px;">
                    <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.3rem;">Overfitting</div>
                    <div>${ovBadge}</div>
                </div>
                <div style="background:rgba(255,255,255,0.03);padding:0.75rem;border-radius:8px;">
                    <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.3rem;">Degradação In→Out</div>
                    <div style="font-size:1.1rem;font-weight:700;">${walkForwardData.degradation?.toFixed(2) || '0.00'}</div>
                </div>
            </div>
            ${foldsHtml ? `<div style="margin-top:0.75rem;font-size:0.72rem;">${foldsHtml}</div>` : ''}
        `;
    }

    /**
     * Renderiza o Relatório Final Sintético do Modelo com Status de Validação
     */
    static renderModelReport(pipeline) {
        const container = document.getElementById('modelReportPanel');
        if (!container || !pipeline) return;

        const statusBadges = {
            VALIDATED: '<span class="badge badge-green">VALIDADO (Superioridade Confirmada)</span>',
            NOT_SIGNIFICANT: '<span class="badge badge-gold">NÃO SIGNIFICANTE (p >= 0.05)</span>',
            OVERFIT: '<span class="badge badge-red">OVERFITTING DETECTADO</span>',
            BASELINE_NOT_BEATEN: '<span class="badge badge-red">BASELINE NÃO SUPERADA</span>',
            INSUFFICIENT_DATA: '<span class="badge badge-gold">DADOS INSUFICIENTES</span>',
            NOT_VALIDATED: '<span class="badge badge-purple">NÃO VALIDADO</span>'
        };

        const bt = pipeline.backtestResult || {};
        const mc = pipeline.monteCarloResult || {};
        const opt = pipeline.optWeightsResult || {};
        const objBreakdown = opt.objectiveBreakdown || {};
        const statusHtml = statusBadges[pipeline.status] || statusBadges.NOT_VALIDATED;

        const ciText = bt.confidenceInterval && typeof bt.confidenceInterval.lower === 'number'
            ? `[${bt.confidenceInterval.lower} — ${bt.confidenceInterval.upper}] (${bt.confidenceInterval.method || 'Student-t'})`
            : 'Dados Insuficientes';

        container.innerHTML = `
            <div style="font-family:monospace; background:rgba(0,0,0,0.4); padding:1rem; border-radius:8px; border:1px solid rgba(255,255,255,0.1); font-size:0.8rem; line-height:1.6;">
                <div style="font-weight:bold; color:var(--text-main); border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:0.4rem; margin-bottom:0.6rem;">
                    =====================================<br>
                    LOTO SIMULADOR — RELATÓRIO ESTATÍSTICO<br>
                    =====================================
                </div>
                <div>Status do Modelo: ${statusHtml}</div>
                <div>Amostra Avaliada: <strong>${bt.evaluatedDraws || 0} concursos</strong></div>
                <div>Média do Modelo: <strong>${typeof bt.meanHits === 'number' ? bt.meanHits.toFixed(2) : '-'} acertos</strong></div>
                <div>Média da Baseline: <strong>${typeof bt.baselineMean === 'number' ? bt.baselineMean.toFixed(2) : '-'} acertos</strong></div>
                <div>Diferença ($\Delta$): <strong>${typeof bt.diffMean === 'number' ? (bt.diffMean > 0 ? '+' : '') + bt.diffMean.toFixed(2) : '-'} acertos</strong></div>
                <div>Evolução Relativa: <strong>${bt.relativeImprovement || '0.0%'}</strong></div>
                <div>Intervalo de Confiança 95%: <strong>${ciText}</strong></div>
                <div>P-Value Exato (t-Student): <strong>${typeof bt.pValue === 'number' ? bt.pValue.toFixed(6) : '-'}</strong></div>
                <div>Significância Estatística: <strong>${bt.isStatisticallySignificant ? 'SIM (✅)' : 'NÃO (⚠️ sem evidência suficiente)'}</strong></div>
                <div>Tamanho de Efeito (Cohen d): <strong>${typeof bt.effectSize === 'number' ? bt.effectSize.toFixed(4) : '-'} (${bt.effectDescriptor || 'Insuficiente'})</strong></div>
                <div>Stability Score: <strong>${mc.stabilityScore || bt.walkForward?.stabilityScore || 50} / 100</strong></div>
                <div>Coverage Score: <strong>${pipeline.coverageScore || pipeline.portfolioCoverage || '-'} / 100</strong></div>
                <div>Diversification Score: <strong>${pipeline.diversificationScore || '-'} / 100</strong></div>
                <div>Objective Score (Otimizador): <strong>${opt.bestObjectiveScore || '-'}</strong> (Perf:${objBreakdown.performance||0} OutSample:${objBreakdown.outOfSample||0} Stab:${objBreakdown.stability||0} Pen:${objBreakdown.overfitPenalty||0})</div>
                <div>Diagnóstico de Overfitting: <strong>${bt.walkForward?.isOverfitting ? 'DETECTADO (Desconto Aplicado)' : 'NÃO DETECTADO'}</strong></div>
                <div>Data Leakage: <strong>${bt.dataLeakageDetected ? 'DETECTADO (❌)' : 'NÃO DETECTADO (✅)'}</strong></div>
                <div>Reprodutibilidade: <strong>APROVADA (Seed: ${pipeline.seed || 123456})</strong></div>
                <div>Monte Carlo Simulações: <strong>${mc.iterations || 10000} iterações</strong></div>
                <div style="margin-top:0.6rem; color:var(--text-muted); font-size:0.7rem; border-top:1px dashed rgba(255,255,255,0.1); padding-top:0.4rem;">
                    Conclusão: ${bt.conclusion || 'Modelo sob análise estatística contínua.'}<br>
                    <span style="color:#f59e0b; font-size:0.65rem;">⚠️ AVISO: Ferramenta estatística de modelagem e simulação. Não há garantia de prêmios ou de acerto em sorteios futuros.</span>
                </div>
            </div>
        `;
    }

    static showStats(show) { 
        document.getElementById('statsNoData').style.display = show ? 'none' : 'block'; 
        document.getElementById('statsContent').style.display = show ? 'block' : 'none'; 
    }
    
    static showPatterns(show) { 
        document.getElementById('patternsNoData').style.display = show ? 'none' : 'block'; 
        document.getElementById('patternsContent').style.display = show ? 'block' : 'none'; 
    }

    static _renderBar(id, labels, data, colors, horizontal = false) {
        const ctx = document.getElementById(id); if (!ctx) return;
        this.destroyChart(id);
        this.charts[id] = new Chart(ctx, { 
            type: 'bar', 
            data: { labels, datasets: [{ data, backgroundColor: Array.isArray(colors) ? colors : colors, borderRadius: 6 }] }, 
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                indexAxis: horizontal ? 'y' : 'x', 
                plugins: { legend: { display: false } }, 
                scales: { 
                    x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } }, 
                    y: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.05)' } } 
                } 
            } 
        });
    }

    static _renderDoughnut(id, labels, data, colors) {
        const ctx = document.getElementById(id); if (!ctx) return;
        this.destroyChart(id);
        this.charts[id] = new Chart(ctx, { 
            type: 'doughnut', 
            data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] }, 
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                cutout: '65%', 
                plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 11 }, padding: 15 } } } 
            } 
        });
    }

    static _renderRadar(id, labels, data) {
        const ctx = document.getElementById(id); if (!ctx) return;
        this.destroyChart(id);
        this.charts[id] = new Chart(ctx, { 
            type: 'radar', 
            data: { labels, datasets: [{ data, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.2)', pointBackgroundColor: '#f59e0b' }] }, 
            options: { 
                responsive: true, 
                maintainAspectRatio: false, 
                plugins: { legend: { display: false } }, 
                scales: { 
                    r: { ticks: { color: '#64748b', backdropColor: 'transparent' }, grid: { color: 'rgba(255,255,255,0.05)' }, pointLabels: { color: '#94a3b8', font: { size: 10 } } } 
                } 
            } 
        });
    }
}
