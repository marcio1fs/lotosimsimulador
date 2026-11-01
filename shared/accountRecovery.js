/**
 * Política de recuperação de conta: redefinição de senha e verificação de e-mail.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * ---------------------------
 * Antes deste módulo, quem esquecia a senha perdia a conta para sempre: o único
 * caminho era o suporte (que não existe) ou criar outra conta. E nada provava que
 * o e-mail cadastrado pertencia a quem se cadastrou — o endereço era aceito como
 * texto, sem confirmação.
 *
 * POR QUE UMA POLÍTICA COMPARTILHADA
 * ----------------------------------
 * Servidor (`server/handler.js`), cliente (`js/models/user.js`) e testes precisam
 * concordar sobre três coisas: **quanto tempo um token vale**, **que formato ele
 * tem** e **o que é uma senha aceitável**. Três cópias disso seriam três chances
 * de divergir — e a divergência apareceria como "o link que eu recebi não
 * funciona", que é o pior tipo de bug: o usuário não tem como diagnosticar.
 *
 * REGRAS (e por quê)
 * ------------------
 * - **Token de 32 bytes (256 bits) em hex**: espaço de busca inviável por
 *   adivinhação. Só o `SHA-256` dele é gravado; quem lê o banco não consegue usar
 *   o valor para entrar.
 * - **Redefinição vale 60 minutos**: é uma janela de uso imediato. Mais que isso
 *   é link esquecido em caixa de entrada antiga.
 * - **Verificação vale 24 horas**: aqui a pressa não ajuda ninguém — o usuário
 *   pode abrir o e-mail no dia seguinte.
 * - **Token de uso único**: marcado como usado (redefinição) ou apagado
 *   (verificação). Reutilizar link antigo de senha é justamente o que um atacante
 *   com acesso à caixa postal tenta.
 * - **Pedido limitado por e-mail e por IP**: sem isso, o formulário "esqueci a
 *   senha" vira ferramenta para encher a caixa de entrada de outra pessoa.
 */

/** Validade do link de redefinição de senha. */
export const RESET_TOKEN_TTL_MINUTES = 60;

/** Validade do link de verificação de e-mail. */
export const VERIFY_TOKEN_TTL_HOURS = 24;

/** Quantos pedidos de redefinição por hora, por e-mail. */
export const RESET_REQUESTS_PER_HOUR_PER_EMAIL = 3;

/** Quantos pedidos de redefinição por hora, por IP (protege a caixa dos outros). */
export const RESET_REQUESTS_PER_HOUR_PER_IP = 5;

/** Quantos reenvios de verificação por hora, por conta. */
export const VERIFY_RESENDS_PER_HOUR = 3;

/** Tamanho do token em bytes — 32 bytes = 64 caracteres hex. */
export const TOKEN_BYTES = 32;

/** Senha: mínimo e máximo, iguais aos da API desde a primeira versão. */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/** Formato de um token de recuperação: 32 bytes em hexadecimal. */
export const RECOVERY_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

/** Caminhos usados nos links enviados por e-mail (query string na raiz). */
export const RESET_LINK_PARAM = 'reset';
export const VERIFY_LINK_PARAM = 'verify';

const MS_PER_MINUTE = 60000;
const MS_PER_HOUR = 3600000;

/** O token tem o formato esperado? (não diz se existe — só se é plausível) */
export const isValidRecoveryToken = token => typeof token === 'string' && RECOVERY_TOKEN_PATTERN.test(token);

/**
 * Motivo pelo qual a senha não serve, ou `null` se serve.
 * Mensagem em pt-BR porque vai direto para a tela.
 */
export function passwordProblem(password) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        return `Senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`;
    }
    if (password.length > MAX_PASSWORD_LENGTH) {
        return `Senha deve ter no máximo ${MAX_PASSWORD_LENGTH} caracteres`;
    }
    return null;
}

/** Instante de expiração de um token de redefinição criado agora. */
export const resetTokenExpiry = (now = Date.now()) => new Date(now + RESET_TOKEN_TTL_MINUTES * MS_PER_MINUTE);

/** Instante de expiração de um token de verificação criado agora. */
export const verifyTokenExpiry = (now = Date.now()) => new Date(now + VERIFY_TOKEN_TTL_HOURS * MS_PER_HOUR);

/**
 * O token expirou? Aceita `Date`, ISO ou timestamp.
 * Ausência de data é tratada como expirado — falha fechada.
 */
export function isTokenExpired(expiresAt, now = Date.now()) {
    if (!expiresAt) return true;
    const ts = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(String(expiresAt));
    return !Number.isFinite(ts) || ts <= now;
}

/**
 * Esconde a parte local do e-mail em logs.
 *
 * Log de servidor é lido por gente, aparece em ferramenta de terceiro e vaza em
 * captura de tela. Guardar o domínio basta para diagnosticar entrega; guardar
 * `maria.silva@` não serve para nada além de criar PII em log.
 */
export function redactEmail(email) {
    const value = String(email || '');
    const at = value.lastIndexOf('@');
    if (at <= 0) return value ? '***' : '';
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    const visible = local.length > 1 ? local[0] : '';
    return `${visible}***@${domain}`;
}

/** Monta o link absoluto de redefinição (o e-mail precisa de URL completa). */
export function buildResetLink(baseUrl, token) {
    return `${String(baseUrl || '').replace(/\/+$/, '')}/?${RESET_LINK_PARAM}=${token}`;
}

/** Monta o link absoluto de verificação. */
export function buildVerifyLink(baseUrl, token) {
    return `${String(baseUrl || '').replace(/\/+$/, '')}/?${VERIFY_LINK_PARAM}=${token}`;
}
