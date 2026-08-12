import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForecastPolicy } from '../js/engine/forecastPolicy.js';

const config = { total: 60, pick: 6 };

describe('ForecastPolicy', () => {
    it('nunca autoriza promessas de ganho', () => {
        const result = ForecastPolicy.evaluate({ historySize: 500, config });
        assert.equal(result.guarantee, false);
        assert.equal(result.canClaimPositiveReturn, false);
    });

    it('exige histórico e backtest suficientes antes de classificar evidência', () => {
        const result = ForecastPolicy.evaluate({ historySize: 20, config });
        assert.equal(result.status, 'INSUFFICIENT_HISTORY');
    });

    it('informa a chance matemática por combinação', () => {
        const result = ForecastPolicy.evaluate({ historySize: 20, config });
        assert.equal(result.probabilityPerCombination, '1 em 50.063.860');
    });
});
