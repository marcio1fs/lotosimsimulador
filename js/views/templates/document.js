/**
 * Montagem do documento — os templates são as partes, este é o encaixe.
 *
 * POR QUE ISSO EXISTE (item 6.11 da auditoria)
 * --------------------------------------------
 * O `index.html` tinha 34 KB em um único arquivo: cabeçalho, tela de login,
 * overlay, casca do app, três telas e três modais. Qualquer revisão exigia
 * rolar o arquivo inteiro, e a camada visual não tinha **nenhum** teste — não
 * por falta de vontade, mas porque não havia como importar markup de um
 * `index.html` em Node.
 *
 * Agora cada seção é um módulo que devolve uma string, sem DOM e sem estado.
 * O documento é montado a partir delas e escrito em `index.html` por
 * `scripts/build-html.mjs`; `tests/uiTemplates.test.js` falha se o arquivo
 * versionado divergir dos templates.
 *
 * A saída é **byte a byte** igual à do `index.html` anterior à divisão: a
 * refatoração não mudou uma vírgula do que o navegador recebe, e isso é
 * verificado antes e depois.
 */

import { documentHead } from './documentHead.js';
import { authScreen } from './authScreen.js';
import { loadingOverlay } from './loadingOverlay.js';
import { appHeader } from './appHeader.js';
import { simulationScreen } from './simulationScreen.js';
import { conferenceScreen } from './conferenceScreen.js';
import { statisticsScreen } from './statisticsScreen.js';
import { modals } from './modals.js';
import { scripts } from './scripts.js';

/** Ordem em que as partes aparecem no documento. */
export const DOCUMENT_SECTIONS = [
    { id: 'head', render: documentHead, description: 'cabeçalho, fontes e CSS' },
    { id: 'auth', render: authScreen, description: 'tela de login e registro' },
    { id: 'loading', render: loadingOverlay, description: 'overlay de carregamento' },
    { id: 'shell', render: appHeader, description: 'header, navegação e abertura do main' },
    { id: 'simulation', render: simulationScreen, description: 'tela de simulação' },
    { id: 'conference', render: conferenceScreen, description: 'tela de conferência' },
    { id: 'statistics', render: statisticsScreen, description: 'tela de estatísticas' },
    { id: 'modals', render: modals, description: 'modais de perfil, automação e banco' },
    { id: 'scripts', render: scripts, description: 'entrypoint e fechamento' }
];

/**
 * Monta o documento completo.
 * @returns {string} HTML do index
 */
export function buildIndexHtml() {
    return DOCUMENT_SECTIONS.map(section => section.render()).join('');
}
