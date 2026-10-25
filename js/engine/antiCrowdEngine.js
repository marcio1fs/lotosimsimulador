/**
 * AntiCrowdEngine - Motor de Teoria dos Jogos e Anti-Viés Comportamental ("Modo Prêmio Sozinho")
 *
 * Fundamento em Teoria dos Jogos Aplicada a Loterias:
 * Embora todas as combinações tenham a mesma probabilidade física de sorteio P(x),
 * os apostadores humanos NÃO escolhem combinações de forma uniforme.
 *
 * Estudos empíricos (Haigh, Ziemba, et al.) demonstram que ~65% das apostas humanas
 * concentram-se em:
 *   1. Datas de aniversário e meses (01 a 31, especialmente 01 a 12);
 *   2. Números da sorte culturais (07, 13, 17, 22, 25);
 *   3. Progressões aritméticas (ex: 05-10-15-20-25-30 ou 02-04-06-08...);
 *   4. Colunas ou diagonais simétricas desenhadas no volante;
 *   5. Dezenas com mesmo dígito final (terminações repetidas, ex: 07-17-27-37);
 *   6. Repetição elevada do resultado do concurso anterior.
 *
 * Ao minimizar a popularidade humana (Crowd Bias) mantendo o bilhete dentro da Zona
 * Central da Curva de Gauss, o Valor Esperado Financeiro E[V] = P(ganhar) × (Prêmio / E[Ganhadores])
 * aumenta significativamente por reduzir o risco de divisão de prêmio (prize splitting).
 */

import { StatisticalAnalyzer } from './statisticalAnalyzer.js';

export const LUCKY_CROWD_NUMBERS = new Set([7, 13, 10, 17, 21, 22, 25, 33]);

export class AntiCrowdEngine {
    /**
     * Calcula o peso de anti-popularidade individual de uma dezena (0 a 1, onde 1 = menos apostada pela multidão)
     */
    static getNumberAntiCrowdWeight(num, total) {
        let score = 0.70;

        // Em loterias com universo > 31 (Mega-Sena 60, Quina 80, Lotomania 100), dezenas > 31 fogem do viés de aniversário
        if (total > 31) {
            if (num > 31) {
                score += 0.25; // Forte bônus anti-aniversário
            } else if (num <= 12) {
                score -= 0.22; // Penalidade: sobreposição dia + mês (01..12 são as mais jogadas por humanos)
            } else {
                score -= 0.10; // Penalidade moderada: dias do mês (13..31)
            }
        } else {
            // Na Lotofácil (1..25), dezenas centrais/ímpares iniciais e 07/13/25 têm viés humano ligeiramente maior
            if (num === 1 || num === 25) score -= 0.08;
        }

        // Penaliza números fetiche/sorte da multidão
        if (LUCKY_CROWD_NUMBERS.has(num)) {
            score -= 0.10;
        }

        // Penaliza múltiplos redondos de 5 e 10 (muito marcados em apostas rápidas manuais)
        if (num % 10 === 0) {
            score -= 0.08;
        } else if (num % 5 === 0) {
            score -= 0.04;
        }

        return Number(Math.max(0.15, Math.min(1.0, score)).toFixed(4));
    }

    /**
     * Avalia o Índice de Prêmio Sozinho (Anti-Crowd Score de 0 a 100) e o Multiplicador Estimado de Valor Esperado (EV)
     */
    static evaluateTicketAntiCrowd(numbers, config, analysis = null) {
        const sorted = [...numbers].sort((a, b) => a - b);
        const len = sorted.length;
        const total = config.total;
        if (len === 0) {
            return {
                antiCrowdScore: 50,
                expectedValueMultiplier: 1.0,
                crowdRiskLevel: 'MÉDIO',
                birthdayRatio: 0,
                hasArithmeticProgression: false,
                details: []
            };
        }

        const details = [];
        let penaltyPoints = 0;
        let bonusPoints = 0;

        // 1. Análise de Viés de Aniversário (01 a 31) e Meses (01 a 12)
        const birthdayCount = sorted.filter(n => n <= 31).length;
        const monthCount = sorted.filter(n => n <= 12).length;
        const birthdayRatio = birthdayCount / len;

        if (total > 31) {
            const expectedBirthdayRatio = 31 / total; // ~0.516 na Mega, ~0.387 na Quina
            if (birthdayRatio <= expectedBirthdayRatio) {
                bonusPoints += 22 * (1 - birthdayRatio / Math.max(0.1, expectedBirthdayRatio));
                details.push(`+ Proteção Anti-Aniversário: ${len - birthdayCount}/${len} dezenas acima do dia 31`);
            } else {
                const excess = (birthdayRatio - expectedBirthdayRatio) / (1 - expectedBirthdayRatio);
                penaltyPoints += 35 * excess;
                if (birthdayRatio >= 0.80) {
                    details.push(`- Alto risco de divisão: ${birthdayCount}/${len} dezenas na faixa de datas (01-31)`);
                }
            }

            if (monthCount >= Math.ceil(len * 0.5)) {
                penaltyPoints += 12;
            }
        }

        // 2. Detecção de Progressão Aritmética (ex: espaçamento constante d entre 3+ dezenas consecutivas)
        const diffs = [];
        for (let i = 0; i < len - 1; i++) {
            diffs.push(sorted[i + 1] - sorted[i]);
        }
        const uniqueDiffs = new Set(diffs);
        const hasFullAP = len >= 4 && uniqueDiffs.size === 1;
        let equalDiffStreak = 1;
        let maxEqualDiffStreak = 1;
        for (let i = 1; i < diffs.length; i++) {
            if (diffs[i] === diffs[i - 1]) {
                equalDiffStreak++;
                if (equalDiffStreak > maxEqualDiffStreak) maxEqualDiffStreak = equalDiffStreak;
            } else {
                equalDiffStreak = 1;
            }
        }

        const hasArithmeticProgression = hasFullAP || (len <= 6 && maxEqualDiffStreak >= 3) || (len >= 15 && maxEqualDiffStreak >= 6);
        if (hasArithmeticProgression) {
            penaltyPoints += 25;
            details.push(`- Padrão de progressão aritmética detectado (muito jogado por humanos)`);
        } else {
            bonusPoints += 10;
            details.push(`+ Quebra de simetria aritmética (espaçamentos irregulares orgânicos)`);
        }

        // 3. Concentração de Terminações (mesmo último dígito, ex: 04, 14, 24, 34)
        const lastDigits = {};
        sorted.forEach(n => {
            const d = n % 10;
            lastDigits[d] = (lastDigits[d] || 0) + 1;
        });
        const maxSameEnding = Math.max(0, ...Object.values(lastDigits));
        const expectedMaxEnding = Math.max(2, Math.ceil(len / 5));
        if (maxSameEnding > expectedMaxEnding) {
            penaltyPoints += (maxSameEnding - expectedMaxEnding) * 10;
            details.push(`- Concentração na mesma coluna/terminação (${maxSameEnding} dezenas)`);
        } else {
            bonusPoints += 8;
        }

        // 4. Concentração de Números Fetiche / Sorte
        const luckyCount = sorted.filter(n => LUCKY_CROWD_NUMBERS.has(n)).length;
        const expectedLucky = (len * LUCKY_CROWD_NUMBERS.size) / total;
        if (luckyCount > expectedLucky + 1.5) {
            penaltyPoints += (luckyCount - expectedLucky) * 6;
        } else if (luckyCount <= Math.ceil(expectedLucky)) {
            bonusPoints += 6;
        }

        // 5. Geometria de Linhas/Colunas (Evitar linhas ou colunas totalmente preenchidas na Mega/Quina)
        const geom = StatisticalAnalyzer.analyzeTicketGeometry(sorted, total);
        if (total >= 60 && (geom.maxInSingleRow >= 4 || geom.maxInSingleCol >= 3)) {
            penaltyPoints += 15;
            details.push(`- Desenho linear no volante (alta incidência de apostas manuais)`);
        }

        // 6. Cópia excessiva do último sorteio
        const lastDraw = analysis?.lastDrawNumbers || [];
        if (lastDraw.length > 0) {
            const overlap = sorted.filter(n => lastDraw.includes(n)).length;
            const maxNormalOverlap = Math.ceil((len * (config.drawn || len)) / total) + 1;
            if (overlap > maxNormalOverlap) {
                penaltyPoints += (overlap - maxNormalOverlap) * 8;
            }
        }

        const rawScore = 65 + bonusPoints - penaltyPoints;
        const antiCrowdScore = Number(Math.max(5, Math.min(99, rawScore)).toFixed(1));

        // Multiplicador Estimado de Valor Esperado (EV Multiplier)
        // Na Mega-Sena/Quina, combinações com score anti-multidão alto têm até 2.4x menos divisões esperadas
        const scaleFactor = total >= 60 ? 1.45 : 0.65;
        const expectedValueMultiplier = Number((1.0 + ((antiCrowdScore - 50) / 100) * scaleFactor).toFixed(2));

        let crowdRiskLevel = 'BAIXO (Ideal p/ Prêmio Sozinho)';
        if (antiCrowdScore < 45) crowdRiskLevel = 'ALTO (Combinação Popular)';
        else if (antiCrowdScore < 68) crowdRiskLevel = 'MODERADO';

        return {
            antiCrowdScore,
            expectedValueMultiplier: Math.max(0.5, expectedValueMultiplier),
            crowdRiskLevel,
            birthdayRatio: Number((birthdayRatio * 100).toFixed(1)),
            hasArithmeticProgression,
            details
        };
    }
}
