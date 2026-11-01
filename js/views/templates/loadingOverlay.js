/**
 * Overlay de carregamento exibido durante sincronização e geração.
 *
 * `loadingSteps` é preenchido por JS; o resto do bloco é estático.
 */

export function loadingOverlay() {
    return `<!-- LOADING OVERLAY -->
<div class="loading-overlay" id="loadingOverlay">
    <div class="loading-spinner"></div>
    <div class="loading-text">🤖 Agente IA em operação...</div>
    <div class="loading-steps" id="loadingSteps"></div>
</div>

`;
}
