/**
 * Envio de e-mail transacional — sem SDK, sem dependência nova.
 *
 * POR QUE ESTE MÓDULO EXISTE
 * --------------------------
 * Recuperação de senha e verificação de e-mail precisam de um canal de saída. A
 * opção "fácil" seria fingir: mostrar o link na tela e chamar aquilo de e-mail.
 * Não. Link na tela não prova posse do endereço (que é o ponto da verificação) e
 * um link de redefinição exibido publicamente é um sequestro de conta.
 *
 * Então a regra é: **ou o e-mail sai de verdade, ou o recurso diz que não está
 * disponível.** Nada de sucesso silencioso.
 *
 * TRANSPORTES
 * -----------
 * - `resend`  — qualquer chave da API do Resend em `EMAIL_API_KEY`, via HTTP puro
 *               (`fetch`), sem instalar pacote. Trocar de provedor é reescrever
 *               `sendViaProvider`.
 * - `console` — **só para desenvolvimento**: imprime o e-mail no log do servidor
 *               em vez de enviar. Recusado quando `NODE_ENV=production`, porque
 *               o log passaria a conter tokens de redefinição — credencial de
 *               acesso a conta, em texto, em log de produção.
 * - `none`    — não configurado. As rotas respondem 503 explicando o que falta,
 *               em vez de aceitar o pedido e não fazer nada.
 *
 * O REMETENTE (`EMAIL_FROM`) precisa ser um domínio verificado no provedor. Se
 * vier vazio, a rota falha na configuração, não no usuário.
 */

import { escapeHtml } from '../js/utils/sanitize.js';
import { redactEmail, RESET_TOKEN_TTL_MINUTES, VERIFY_TOKEN_TTL_HOURS } from '../shared/accountRecovery.js';

const PROVIDER_ENDPOINT = 'https://api.resend.com/emails';

/** Injeção usada apenas pelos testes (restaurada no `finally` de cada um). */
let _sender = null;

/**
 * Substitui o envio real, para os testes não dependerem de rede.
 * @param {null | ((mensagem: object) => Promise<object>)} sender
 */
export function _setEmailSenderForTests(sender) {
    _sender = sender;
}

/** Qual transporte está configurado no ambiente. */
export function emailTransport(env = process.env) {
    if (env.EMAIL_API_KEY) return 'resend';
    if (env.EMAIL_TRANSPORT === 'console') return env.NODE_ENV === 'production' ? 'none' : 'console';
    return 'none';
}

export const isEmailConfigured = (env = process.env) => emailTransport(env) !== 'none';

/** Mensagem exata quando o servidor não tem como enviar e-mail. */
export const EMAIL_NOT_CONFIGURED_MESSAGE =
    'Este servidor ainda não tem envio de e-mail configurado, então não é possível recuperar a senha por aqui. ' +
    'Fale com o responsável pelo serviço.';

/**
 * Envia um e-mail. Nunca lança: devolve `{ sent, transport, reason }`.
 *
 * Não lançar é deliberado. O chamador precisa poder responder ao usuário de forma
 * genérica ("se este e-mail existir, o link saiu") sem que uma falha do provedor
 * vire um erro que revele se a conta existe.
 */
export async function sendEmail(message, { env = process.env, fetchImpl = globalThis.fetch, log = console } = {}) {
    const transport = emailTransport(env);

    if (transport === 'none') {
        return { sent: false, transport, reason: 'envio de e-mail não configurado' };
    }

    if (transport === 'console') {
        log.warn(
            `[email] transporte de CONSOLE (apenas desenvolvimento): nada foi enviado para ${redactEmail(message.to)}.\n` +
                `  assunto: ${message.subject}\n${message.text}`
        );
        return { sent: true, transport };
    }

    const from = env.EMAIL_FROM;
    if (!from) {
        log.error('[email] EMAIL_API_KEY existe, mas EMAIL_FROM não está definido — nenhum e-mail pode sair');
        return { sent: false, transport, reason: 'EMAIL_FROM ausente' };
    }

    const payload = { from, to: [message.to], subject: message.subject, text: message.text };
    if (message.html) payload.html = message.html;
    if (message.replyTo) payload.reply_to = message.replyTo;

    const perform = _sender
        ? () => _sender({ ...message, from })
        : () =>
              fetchImpl(PROVIDER_ENDPOINT, {
                  method: 'POST',
                  headers: {
                      Authorization: `Bearer ${env.EMAIL_API_KEY}`,
                      'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(payload)
              });

    try {
        const response = await perform();
        // `_sender` de teste devolve `{ sent }` direto; o provedor devolve Response.
        if (response && typeof response.sent === 'boolean') return { transport, ...response };
        if (!response || !response.ok) {
            log.error(`[email] provedor recusou o envio para ${redactEmail(message.to)}: HTTP ${response?.status}`);
            return { sent: false, transport, reason: `provedor respondeu ${response?.status ?? 'sem resposta'}` };
        }
        return { sent: true, transport };
    } catch (error) {
        log.error(`[email] falha ao enviar para ${redactEmail(message.to)}: ${error?.message || error}`);
        return { sent: false, transport, reason: 'falha de rede' };
    }
}

/** Corpo do e-mail de redefinição de senha (texto e HTML). */
export function resetPasswordMessage({ to, name, link }) {
    const safeName = escapeHtml(name || 'tudo bem?');
    const text = [
        `Olá, ${name || ''}!`.trim(),
        '',
        'Recebemos um pedido para redefinir a senha da sua conta no Lotosimsimulador.',
        '',
        'Abra este link para criar uma senha nova:',
        link,
        '',
        `O link vale por ${RESET_TOKEN_TTL_MINUTES} minutos e só pode ser usado uma vez.`,
        '',
        'Ao usar o link, todas as sessões abertas serão encerradas — é você quem pediu?',
        'Se não foi você, ignore este e-mail: sua senha atual continua valendo.'
    ].join('\n');

    const html = `<p>Olá, ${safeName}!</p>
<p>Recebemos um pedido para redefinir a senha da sua conta no <strong>Lotosimsimulador</strong>.</p>
<p><a href="${escapeHtml(link)}">Criar uma senha nova</a></p>
<p>O link vale por ${RESET_TOKEN_TTL_MINUTES} minutos e só pode ser usado uma vez. Ao usar o link, todas as sessões abertas serão encerradas.</p>
<p>Se não foi você, ignore este e-mail: sua senha atual continua valendo.</p>`;

    return { to, subject: 'Redefinir senha — Lotosimsimulador', text, html };
}

/** Corpo do e-mail de verificação de endereço. */
export function verifyEmailMessage({ to, name, link }) {
    const safeName = escapeHtml(name || 'tudo bem?');
    const text = [
        `Olá, ${name || ''}!`.trim(),
        '',
        'Confirme que este e-mail é seu para ativar a verificação da conta no Lotosimsimulador.',
        '',
        link,
        '',
        `O link vale por ${VERIFY_TOKEN_TTL_HOURS} horas.`,
        '',
        'Se você não criou esta conta, ignore este e-mail.'
    ].join('\n');

    const html = `<p>Olá, ${safeName}!</p>
<p>Confirme que este e-mail é seu para ativar a verificação da conta no <strong>Lotosimsimulador</strong>.</p>
<p><a href="${escapeHtml(link)}">Confirmar meu e-mail</a></p>
<p>O link vale por ${VERIFY_TOKEN_TTL_HOURS} horas. Se você não criou esta conta, ignore este e-mail.</p>`;

    return { to, subject: 'Confirme seu e-mail — Lotosimsimulador', text, html };
}
