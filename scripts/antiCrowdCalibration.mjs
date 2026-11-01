#!/usr/bin/env node
/**
 * Calibração do AntiCrowdEngine pela linha de comando (item 6.8 da auditoria).
 *
 * Dois modos:
 *
 *   node scripts/antiCrowdCalibration.mjs --sensibilidade
 *       Mede o quanto o motor depende dos priors não calibrados. Não precisa de
 *       dado nenhum e responde à pergunta prática: a escolha muda?
 *
 *   node scripts/antiCrowdCalibration.mjs --file apostas.csv --total 60 --source "origem"
 *       Converte uma tabela de apostas por dezena em pesos calibrados, com
 *       intervalo de confiança por dezena. É o pipeline que fica pronto para o dia
 *       em que a tabela existir.
 *
 * `--json` devolve a saída em JSON (para colar em outro lugar ou versionar).
 */

import { readFile } from 'node:fs/promises';
import {
    parsePopularityCsv,
    deriveWeightsFromCounts,
    priorSensitivity,
    ticketScoreSensitivity,
    priorInfluence
} from '../js/engine/crowdCalibration.js';
import { AntiCrowdEngine } from '../js/engine/antiCrowdEngine.js';

const args = process.argv.slice(2);
const has = name => args.includes(`--${name}`);
const valueOf = (name, fallback = null) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const asJson = has('json');
const pct = value => `${(value * 100).toFixed(1)}%`;

function sair(mensagem, codigo = 1) {
    console.error(mensagem);
    process.exit(codigo);
}

async function modoSensibilidade() {
    const ranking = priorSensitivity();
    const ticket = ticketScoreSensitivity();
    const influencia = priorInfluence();

    if (asJson) {
        console.log(JSON.stringify({ ranking, ticket, influencia }, null, 2));
        return;
    }

    console.log('ANTI-CROWD — SENSIBILIDADE AOS PRIORS NÃO CALIBRADOS\n');
    console.log(`Priors de ordem perturbados: ${ranking.priorsPerturbed.length}`);
    console.log(`Priors de nota perturbados:  ${ticket.priorsPerturbed.length}`);
    console.log(`Perturbação: ±${pct(ranking.magnitude)} em cada prior, ${ranking.perturbations} sorteios.\n`);

    for (const [loteria, dados] of Object.entries(ranking.report)) {
        const nota = ticket.report[loteria];
        console.log(`── ${loteria} (${dados.total} dezenas)`);
        console.log(
            `   ordem das dezenas ........ ρ mediano ${dados.weightRankCorrelation.median} ` +
                `(pior caso ${dados.weightRankCorrelation.min})`
        );
        console.log(
            `   distribuição de amostragem  ${pct(dados.samplingShift.median)} da massa muda ` +
                `(pior caso ${pct(dados.samplingShift.max)})`
        );
        console.log(
            `   nota do bilhete .......... ρ mediano ${nota.scoreRankCorrelation.median} ` +
                `(pior caso ${nota.scoreRankCorrelation.min}), até ${nota.maxScoreShiftPoints} pontos`
        );
        console.log(
            `   faixa de risco ........... muda em ${pct(nota.riskLabelChangeShare.median)} dos bilhetes ` +
                `(pior caso ${pct(nota.riskLabelChangeShare.max)})`
        );
        console.log(
            `   multiplicador de EV ...... ${nota.evMultiplierRange.min}x a ${nota.evMultiplierRange.max}x ` +
                `(mediano ${nota.evMultiplierRange.baselineMedian}x)\n`
        );
    }

    console.log('PRIORS QUE MAIS MUDAM A ORDEM DAS DEZENAS (um de cada vez)\n');
    for (const [loteria, linhas] of Object.entries(influencia.report)) {
        console.log(`── ${loteria}`);
        for (const linha of linhas) {
            console.log(
                `   ρ ${String(linha.worstRho).padEnd(7)} ${linha.priors ?? linha.prior} ` +
                    `(${linha.basis}, ${linha.numbersAffected} dezenas afetadas)`
            );
        }
        console.log('');
    }
}

async function modoArquivo() {
    const caminho = valueOf('file');
    const total = Number(valueOf('total'));
    if (!caminho) sair('informe --file <caminho.csv> (ou use --sensibilidade)');
    if (!Number.isInteger(total) || total < 2) sair('informe --total <universo da loteria>, ex.: 60');

    let texto;
    try {
        texto = await readFile(caminho, 'utf8');
    } catch (erro) {
        sair(`não foi possível ler ${caminho}: ${erro.message}`);
    }

    const { counts, sampleSize, issues, lines } = parsePopularityCsv(texto);
    const validas = Object.keys(counts).length;
    if (validas < 2) sair(`a tabela precisa de ao menos duas dezenas válidas (encontrei ${validas})`);

    const relatorio = deriveWeightsFromCounts(counts, { total });
    const origem = valueOf('source', caminho);

    if (asJson) {
        console.log(
            JSON.stringify(
                {
                    source: origem,
                    sampleSize,
                    numbersCovered: relatorio.numbersCovered,
                    complete: relatorio.complete,
                    missing: relatorio.missing,
                    issues,
                    calibration: { popularityByNumber: counts, sampleSize, source: origem },
                    weights: relatorio.weights,
                    numbers: relatorio.numbers,
                    diagnostics: relatorio.diagnostics
                },
                null,
                2
            )
        );
        return;
    }

    console.log('ANTI-CROWD — CALIBRAÇÃO A PARTIR DE APOSTAS POR DEZENA\n');
    console.log(`Arquivo:  ${caminho}`);
    console.log(`Origem:   ${origem}`);
    console.log(`Linhas:   ${lines} (${validas} dezenas válidas, ${issues.length} observações)`);
    console.log(`Amostra:  ${sampleSize.toLocaleString('pt-BR')} apostas`);
    console.log(
        `Cobertura: ${relatorio.numbersCovered}/${total} dezenas${relatorio.complete ? '' : ' — INCOMPLETA'}\n`
    );

    for (const issue of issues) console.log(`   aviso linha ${issue.line}: ${issue.reason}`);

    console.log('\n   dezena   apostas      share     relativo   peso    faixa de peso (95%)');
    for (const item of relatorio.numbers) {
        console.log(
            `   ${String(item.number).padStart(4)}  ${String(item.count).padStart(9)}  ` +
                `${pct(item.share).padStart(7)}  ${item.relative.toFixed(3).padStart(8)}  ` +
                `${item.weight.toFixed(3)}  [${item.weightRange[0].toFixed(3)}, ${item.weightRange[1].toFixed(3)}]` +
                `${item.distinguishable ? '' : '  (indistinguível da média)'}`
        );
    }

    const diag = relatorio.diagnostics;
    console.log(
        `\n   Distinguíveis da média: ${diag.distinguishable} (por azar, esperaríamos ~${diag.expectedByChance})`
    );
    console.log(`   Menos apostadas: ${diag.leastPopular.join(', ')}`);
    console.log(`   Mais apostadas:  ${diag.mostPopular.join(', ')}`);
    console.log(`\n   ${diag.note}`);

    console.log('\nPara aplicar no motor:');
    console.log(
        `   AntiCrowdEngine.setCalibration({ popularityByNumber, sampleSize: ${sampleSize}, source: ${JSON.stringify(origem)} })`
    );
    console.log('   O JSON completo sai com --json (campo "calibration").');

    // Prova de que a calibração entra no motor e faz diferença.
    const exemplo = relatorio.diagnostics.leastPopular[0];
    const semCalibracao = AntiCrowdEngine.getNumberAntiCrowdWeight(exemplo, total);
    AntiCrowdEngine.setCalibration({ popularityByNumber: counts, sampleSize, source: origem });
    const comCalibracao = AntiCrowdEngine.getNumberAntiCrowdWeight(exemplo, total);
    const resumo = AntiCrowdEngine.getCalibration();
    AntiCrowdEngine.clearCalibration();

    console.log(`\n   Exemplo: dezena ${exemplo} (a menos apostada da tabela)`);
    console.log(`     peso com prior de literatura: ${semCalibracao}`);
    console.log(`     peso com a tabela aplicada:   ${comCalibracao}`);
    console.log(`     encolhimento aplicado:        λ = ${resumo.shrinkageLambda}`);
    console.log('   (λ = n/(n+100000): amostra pequena continua puxando para o prior)');
}

const modo = has('file') ? modoArquivo : modoSensibilidade;
modo().catch(erro => sair(`falhou: ${erro.message}`));
