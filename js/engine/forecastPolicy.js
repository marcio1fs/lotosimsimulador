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

    static evaluate({ historySize = 0, backtest = null, strategy = 'adaptive', config, history = null }) {
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

        // --------------------------------------------------------------
        // BLOQUEIO DE DADOS SINTÉTICOS
        // Se qualquer concurso do histórico for de preenchimento (não oficial),
        // toda a inferência estatística perde validade — os números deixam de
        // representar o sorteio real e sim um gerador uniforme.
        // --------------------------------------------------------------
        const syntheticDraws = Array.isArray(history)
            ? history.filter(d => d && d.synthetic === true).length
            : 0;
        if (syntheticDraws > 0) {
            return {
                ...base,
                syntheticDraws,
                officialDraws: Math.max(0, historySize - syntheticDraws),
                status: 'SYNTHETIC_DATA',
                label: 'Histórico incompleto — amostra contém dados sintéticos',
                detail: `${syntheticDraws} de ${historySize} concursos são de preenchimento e não são resultados oficiais. `
                    + 'Backtest, p-value e testes de uniformidade foram calculados nessa mistura e NÃO devem ser interpretados como desempenho real. '
                    + 'Sincronize o histórico oficial para reativar a validação.'
            };
        }

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
