/**
 * ProbabilityEngine
 *
 * Calculates the theoretical hit distribution without simulation. In a fair
 * lottery, the number of hits in a ticket follows a hypergeometric law.
 */
export class ProbabilityEngine {
    static combinationCount(total, choose) {
        if (!Number.isInteger(total) || !Number.isInteger(choose) || choose < 0 || choose > total) return 0n;

        const k = Math.min(choose, total - choose);
        let result = 1n;
        for (let i = 1; i <= k; i++) {
            result = (result * BigInt(total - k + i)) / BigInt(i);
        }
        return result;
    }

    static probabilityToOdds(probability) {
        if (!Number.isFinite(probability) || probability <= 0) return 'n/a';
        if (probability >= 1) return '1 em 1';
        return `1 em ${Math.round(1 / probability).toLocaleString('pt-BR')}`;
    }

    /**
     * Returns P(H = k), P(H >= k), mean, standard deviation, and a central
     * 95% predictive interval for the next fair draw.
     */
    static hypergeometric(config, selectedCount = config?.pick) {
        const total = Number(config?.total);
        const drawn = Number(config?.drawn ?? config?.pick);
        const selected = Number(selectedCount);

        if (![total, drawn, selected].every(Number.isInteger) || total <= 0 || drawn < 0 || selected < 0 || drawn > total || selected > total) {
            return this.emptyResult();
        }

        const denominator = this.combinationCount(total, drawn);
        const minHits = Math.max(0, drawn - (total - selected));
        const maxHits = Math.min(selected, drawn);
        const distribution = {};
        const cumulativeProbabilities = {};

        for (let hits = minHits; hits <= maxHits; hits++) {
            const numerator = this.combinationCount(selected, hits) * this.combinationCount(total - selected, drawn - hits);
            distribution[hits] = Number(numerator) / Number(denominator);
        }

        let cumulative = 0;
        for (let hits = maxHits; hits >= minHits; hits--) {
            cumulative += distribution[hits] || 0;
            cumulativeProbabilities[hits] = cumulative;
        }
        for (let hits = 0; hits < minHits; hits++) cumulativeProbabilities[hits] = 1;
        for (let hits = maxHits + 1; hits <= drawn; hits++) cumulativeProbabilities[hits] = 0;

        const mean = (selected * drawn) / total;
        const variance = total > 1
            ? drawn * (selected / total) * (1 - (selected / total)) * ((total - drawn) / (total - 1))
            : 0;
        const predictionInterval = {
            confidenceLevel: 0.95,
            lower: this.quantile(distribution, minHits, maxHits, 0.025),
            upper: this.quantile(distribution, minHits, maxHits, 0.975)
        };
        const fullHitProbability = distribution[maxHits] || 0;

        return {
            method: 'Hipergeometrica exata',
            selectedCount: selected,
            drawnCount: drawn,
            minHits,
            maxHits,
            expectedHits: Number(mean.toFixed(6)),
            variance: Number(variance.toFixed(6)),
            stdDev: Number(Math.sqrt(variance).toFixed(6)),
            distribution,
            cumulativeProbabilities,
            predictionInterval,
            fullHitProbability,
            fullHitOdds: this.probabilityToOdds(fullHitProbability)
        };
    }

    static quantile(distribution, minHits, maxHits, threshold) {
        let cumulative = 0;
        for (let hits = minHits; hits <= maxHits; hits++) {
            cumulative += distribution[hits] || 0;
            if (cumulative >= threshold) return hits;
        }
        return maxHits;
    }

    static emptyResult() {
        return {
            method: 'Hipergeometrica exata', selectedCount: 0, drawnCount: 0, minHits: 0, maxHits: 0,
            expectedHits: 0, variance: 0, stdDev: 0, distribution: {}, cumulativeProbabilities: {},
            predictionInterval: { confidenceLevel: 0.95, lower: 0, upper: 0 }, fullHitProbability: 0, fullHitOdds: 'n/a'
        };
    }
}
