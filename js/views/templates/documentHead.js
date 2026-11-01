/**
 * Cabeçalho do documento (`<head>`): metas, ícone, manifest, fontes e CSS.
 *
 * Só markup, e **nenhum script**: o único JS que o documento carrega é o entrypoint
 * da aplicação (`scripts.js`), empacotado pelo Vite. O Chart.js, que antes vinha de
 * `cdn.jsdelivr.net` sem `integrity`, agora é dependência do projeto e entra pelo
 * bundle (import dinâmico, ver `js/views/statistics.js`). Resultado: o CSP não
 * precisa liberar `script-src` de terceiro nenhum.
 *
 * As fontes seguem no Google Fonts — é uma folha de estilo de terceiro, não script.
 * Fica anotado como dependência externa restante (ver INTERFACE.md).
 */

export function documentHead() {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Simulador Estatístico Avançado para Loterias: Poda Gaussiana, Cadeias de Markov, Fechamento Combinatório com Simulated Annealing e Teoria dos Jogos.">
    <meta name="theme-color" content="#10b981">
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎱</text></svg>">
    <link rel="manifest" href="/manifest.webmanifest">
    <title>Lotosimsimulador - Inteligência para Loteria</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="css/style.css">
</head>
<body>

`;
}
