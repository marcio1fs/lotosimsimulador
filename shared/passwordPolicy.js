/**
 * Política do hash legado de senha (item 6.12 da auditoria).
 *
 * O PROBLEMA
 * ----------
 * As primeiras versões do app guardavam a senha como
 *
 *     h_<hash de 32 bits em base36>_<12 primeiros caracteres do base64 da senha>
 *
 * Duas dessas três partes são a senha. Os 12 caracteres de base64 são 9 bytes de
 * senha em claro; o hash de 32 bits cobre o resto e é revertido por tentativa em
 * milissegundos. Quem obtém um dump do banco — ou do IndexedDB do navegador —
 * recupera a senha em claro. Não é "hash fraco": é a senha com um enfeite.
 *
 * O QUE JUSTIFICAVA MANTER
 * ------------------------
 * Contas criadas antes da migração para bcrypt/PBKDF2 só conseguiam entrar
 * porque o verificador legado continuava aceitando o formato. Cada login bem
 * sucedido regravava a senha em bcrypt/PBKDF2 — a migração era transparente.
 *
 * POR QUE ISSO NÃO BASTA
 * ----------------------
 * Migração no login só alcança quem faz login. Sem prazo, a conta dormente fica
 * para sempre com a senha reversível, e o verificador legado fica para sempre no
 * código como oráculo: um atacante com um dump antigo pode confirmar senhas
 * contra o servidor. "Migração" sem data-limite é porta aberta com placa de
 * "fechando".
 *
 * A REGRA AGORA
 * -------------
 * Existe uma data-limite (`LEGACY_HASH_SUNSET_ISO`). Antes dela: o formato é
 * aceito e imediatamente convertido. A partir dela: **o hash legado não é mais
 * calculado nem comparado** — a conta passa a exigir redefinição de senha, e o
 * código antigo precisa ser removido (há um teste que falha nesse dia se ele
 * ainda estiver lá, ver `tests/legacyHashSunset.test.js`).
 *
 * Este módulo é a fonte única do prazo para os dois lados: `server/security.js`
 * (API) e `js/models/user.js` (modo offline com IndexedDB). Duas cópias da data
 * seriam duas chances de esquecer uma delas.
 */

/** Prefixo dos hashes gravados pelas versões antigas. */
export const LEGACY_HASH_PREFIX = 'h_';

/**
 * Data-limite. Depois deste instante o formato legado deixa de ser aceito.
 * 01/11/2026 (auditoria) + 90 dias, arredondado para o começo do mês seguinte.
 */
export const LEGACY_HASH_SUNSET_ISO = '2027-02-01T00:00:00.000Z';

/** O mesmo prazo em milissegundos (comparação numérica). */
export const LEGACY_HASH_SUNSET_MS = Date.parse(LEGACY_HASH_SUNSET_ISO);

/** O prazo em pt-BR, para mensagens e documentação. */
export const LEGACY_HASH_SUNSET_LABEL = '31/01/2027';

const MS_PER_DAY = 86400000;

/** `stored` é um hash no formato antigo (`h_…`)? */
export const isLegacyHash = (stored) =>
    typeof stored === 'string' && stored.startsWith(LEGACY_HASH_PREFIX);

/**
 * A data-limite já passou?
 * Aceita número (epoch ms) ou qualquer coisa que `Date.parse` entenda.
 */
export function legacyDeadlineReached(now = Date.now()) {
    const ts = typeof now === 'number' ? now : Date.parse(String(now));
    return Number.isFinite(ts) && ts >= LEGACY_HASH_SUNSET_MS;
}

/** Dias inteiros até o prazo (0 depois dele) — usado em logs e diagnósticos. */
export function daysUntilLegacySunset(now = Date.now()) {
    const ts = typeof now === 'number' ? now : Date.parse(String(now));
    if (!Number.isFinite(ts)) return 0;
    return Math.max(0, Math.ceil((LEGACY_HASH_SUNSET_MS - ts) / MS_PER_DAY));
}

/**
 * Classifica um hash armazenado em relação ao prazo.
 *
 * @param {unknown} stored
 * @param {number|string} [now]
 * @returns {'none'|'migrating'|'expired'}
 *   - `none`: não é hash legado (bcrypt, PBKDF2, lixo);
 *   - `migrating`: é legado e ainda aceito — deve ser convertido no login;
 *   - `expired`: é legado e o prazo passou — não é mais verificável.
 */
export function legacyHashStatus(stored, now = Date.now()) {
    if (!isLegacyHash(stored)) return 'none';
    return legacyDeadlineReached(now) ? 'expired' : 'migrating';
}
