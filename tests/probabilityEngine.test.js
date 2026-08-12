import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProbabilityEngine } from '../js/engine/probabilityEngine.js';

describe('ProbabilityEngine', () => {
    const mega = { total: 60, pick: 6, drawn: 6 };

    it('calculates the exact Mega-Sena full-hit odds', () => {
        const result = ProbabilityEngine.hypergeometric(mega, 6);
        assert.equal(result.fullHitOdds, '1 em 50.063.860');
        assert.equal(result.fullHitProbability, 1 / 50063860);
    });

    it('returns a distribution that sums to one and consistent cumulative odds', () => {
        const result = ProbabilityEngine.hypergeometric({ total: 25, pick: 15, drawn: 15 }, 15);
        const totalProbability = Object.values(result.distribution).reduce((sum, probability) => sum + probability, 0);
        assert.ok(Math.abs(totalProbability - 1) < 1e-12);
        assert.equal(result.cumulativeProbabilities[0], 1);
        assert.equal(result.cumulativeProbabilities[15], 1 / 3268760);
    });

    it('handles a ticket that contains more numbers than the draw', () => {
        const result = ProbabilityEngine.hypergeometric({ total: 100, pick: 50, drawn: 20 }, 50);
        assert.equal(result.expectedHits, 10);
        assert.equal(result.maxHits, 20);
        assert.ok(result.fullHitProbability > 0);
    });
});
