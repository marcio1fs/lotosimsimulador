/**
 * Fechamento do documento: aponta para o entrypoint ESM e fecha `<body>`/`<html>`.
 *
 * Há exatamente **um** script de aplicação, e ele é um módulo. O markup não carrega
 * lógica inline — o que também permite um CSP mais estreito.
 */

export function scripts() {
    return `<script type="module" src="js/main.js"></script>
</body>
</html>
`;
}
