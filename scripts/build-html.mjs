/**
 * Gera o `index.html` a partir dos templates de `js/views/templates/`.
 *
 * O `index.html` é **saída de build**, não fonte. Editar o arquivo na mão é
 * inútil: o próximo `npm run build` sobrescreve, e o teste
 * `tests/uiTemplates.test.js` falha se o arquivo versionado divergir dos
 * templates.
 *
 * Uso:
 *   node scripts/build-html.mjs            # grava index.html
 *   node scripts/build-html.mjs --check    # não grava; sai com código 1 se divergir
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildIndexHtml } from '../js/views/templates/document.js';

const target = fileURLToPath(new URL('../index.html', import.meta.url));
const checkOnly = process.argv.includes('--check');

const generated = buildIndexHtml();
const current = await readFile(target, 'utf8').catch(() => '');

if (current === generated) {
    console.log(`index.html já está atualizado (${generated.length} bytes).`);
    process.exit(0);
}

if (checkOnly) {
    const firstDiff = [...generated].findIndex((ch, i) => ch !== current[i]);
    console.error(
        `index.html divergiu dos templates (primeira diferença no caractere ${firstDiff}).\n` +
            'Ele é gerado: edite js/views/templates/*.js e rode `node scripts/build-html.mjs`.'
    );
    process.exit(1);
}

await writeFile(target, generated);
console.log(`index.html gerado a partir de ${'js/views/templates'} (${generated.length} bytes).`);
