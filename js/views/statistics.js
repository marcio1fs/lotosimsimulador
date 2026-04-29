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
        const freq = resultsData.frequency;
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
        const freq = resultsData.frequency;
        const maxF = Math.max(...Object.values(freq));
        document.getElementById('freqGrid').innerHTML = Array.from({length: cfg.total}, (_, i) => {
            const f = freq[i+1] || 0; const intensity = f / maxF;
            return `<div class="freq-cell" style="background:hsla(220,60%,${15+intensity*35}%,${0.5+intensity*0.5});color:${intensity>0.5?'#fff':'var(--text-muted)'};">${String(i+1).padStart(2,'0')}<div class="freq-tooltip">${i+1}: ${f}x</div></div>`;
        }).join('');
    }

    static renderProbChart(games) {
        const sorted = [...games].sort((a, b) => parseFloat(b.probability) - parseFloat(a.probability));
        this._renderBar('probChart', sorted.map(g => `Jogo #${g.id}`), sorted.map(g => parseFloat(g.probability)), sorted.map((_, i) => `rgba(139,92,246,${0.3+(i/sorted.length)*0.7})`), true);
    }

    static renderComparisonChart(games, type, resultsData) {
        const cfg = LotteryModel.CONFIG[type];
        const freq = resultsData.frequency;
        const avg = games.map(g => g.numbers.reduce((s, n) => s + (freq[n]||0), 0) / cfg.pick);
        this._renderRadar('comparisonChart', games.map(g => `J${g.id}`), avg);
    }

    static renderRanking(games) {
        const sorted = [...games].sort((a, b) => parseFloat(b.probability) - parseFloat(a.probability));
        const maxP = parseFloat(sorted[0]?.probability) || 1;
        document.getElementById('rankingBody').innerHTML = sorted.map((g, i) => {
            const perf = (parseFloat(g.probability) / maxP * 100).toFixed(0);
            const cls = perf > 80 ? 'badge-green' : perf > 50 ? 'badge-gold' : 'badge-red';
            return `<tr><td>${i+1}</td><td><span class="badge badge-purple">#${g.id}</span></td><td style="font-size:0.75rem;">${g.numbers.map(n => String(n).padStart(2,'0')).join(' ')}</td><td><span class="badge badge-gold">${g.probability}%</span></td><td><span class="badge ${cls}">${perf}%</span></td></tr>`;
        }).join('');
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
