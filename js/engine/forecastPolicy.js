/**
 * ForecastPolicy
 *
 * Regras de comunicação e validação para combinações futuras. Em loterias
 * idôneas, o histórico não altera a chance matemática de uma combinação
 * específica; por isso este módulo nunca autoriza promessas de ganho.
 */
import { ProbabilityEngine } from './probabilityEngine.js';

export class ForecastPolicy {
    static combinationCount(total, pick) {
        let result = 1n;
        for (let i = 1; i <= pick; i++) {
            result = (result * BigInt(total - pick + i)) / BigInt(i);
        }
        return result;
    }

    static evaluate({ historySize = 0, backtest = null, strategy = 'adaptive', config }) {
        const minimumHistory = 100;
        const minimumEvaluatedDraws = 30;
        const exactOdds = ProbabilityEngine.hypergeometric(config, config.pick);
        const base = {
            strategy,
            historySize,
            minimumHistory,
            evaluatedDraws: backtest?.evaluatedDraws ?? 0,
            probabilityPerCombination: exactOdds.fullHitOdds,
            probabilityLabel: `Chance de acertar todas as ${exactOdds.maxHits} dezenas sorteadas`,
            guarantee: false,
            canClaimPositiveReturn: false,
            disclaimer: 'Nenhuma combinação é previsão de resultado ou garantia de prêmio. Em sorteios idôneos, todas as combinações válidas têm a mesma chance matemática.'
        };

        if (historySize < minimumHistory) {
            return {
                ...base,
                status: 'INSUFFICIENT_HISTORY',
                label: 'Dados insuficientes para validação histórica',
                detail: `São necessários ao menos ${minimumHistory} concursos para classificar o desempenho histórico.`
            };
        }

        if (!backtest || base.evaluatedDraws < minimumEvaluatedDraws) {
            return {
                ...base,
                status: 'INSUFFICIENT_BACKTEST',
                label: 'Backtest insuficiente',
                detail: `São necessários ao menos ${minimumEvaluatedDraws} concursos avaliados sem vazamento de dados.`
            };
        }

        if (backtest.diffMean <= 0 || !backtest.isStatisticallySignificant) {
            return {
                ...base,
                status: 'NO_EVIDENCE_OF_ADVANTAGE',
                label: 'Sem evidência de vantagem sobre o aleatório',
                detail: 'O histórico não demonstrou desempenho estatisticamente superior à seleção aleatória.'
            };
        }

        if (backtest.walkForward?.isOverfitting) {
            return {
                ...base,
                status: 'OVERFITTING_RISK',
                label: 'Risco de sobreajuste detectado',
                detail: 'O desempenho histórico não se manteve de forma consistente na validação temporal.'
            };
        }

        return {
            ...base,
            status: 'HISTORICAL_EVIDENCE_ONLY',
            label: 'Evidência histórica limitada',
            detail: 'O modelo passou em critérios históricos, mas isso não prevê sorteios futuros nem altera as chances matemáticas da aposta.'
        };
    }
}
