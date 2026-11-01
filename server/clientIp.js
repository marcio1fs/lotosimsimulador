/**
 * De quem é a requisição — e por que a resposta não é o primeiro valor de
 * `X-Forwarded-For`.
 *
 * O PROBLEMA
 * ----------
 * O código lia `x-forwarded-for` e pegava a **primeira** entrada. Esse cabeçalho é
 * montado assim: cada proxy **acrescenta** o endereço de quem falou com ele, no
 * fim da lista. A primeira entrada, portanto, é o que o **cliente** escreveu — e o
 * cliente escreve o que quiser.
 *
 * Consequência prática: todo limite por IP (login, recuperação de conta, e agora o
 * limite geral de requisições) podia ser contornado trocando o cabeçalho a cada
 * tentativa. O limite existia no código e não existia na prática.
 *
 * A REGRA
 * -------
 * 1. `x-real-ip` — a Vercel define com o endereço real e o cabeçalho é reescrito
 *    na borda, então não dá para forjar.
 * 2. **última** entrada de `x-forwarded-for` — é a que o proxy mais próximo
 *    acrescentou. Forjar a primeira não muda a última.
 * 3. `socket.remoteAddress` — conexão direta, sem proxy.
 *
 * A suposição é **um** proxy confiável na frente (o caso da Vercel). Com dois
 * proxies encadeados, a leitura correta seria a penúltima — e isso precisa ser
 * revisto aqui, junto com a infraestrutura, não adivinhado.
 */

const firstValue = value =>
    String(value || '')
        .split(',')[0]
        .trim();

const lastValue = value => {
    const parts = String(value || '')
        .split(',')
        .map(part => part.trim())
        .filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
};

/**
 * Valor plausível como endereço? (evita chave de limite virar texto arbitrário)
 *
 * Aceita IPv4, IPv6 (com `:` e `[]`), e host:porta. Recusa espaço, aspas, barra e
 * caractere de controle — o que sobra é o que um proxy escreveria.
 */
export const isValidIp = value =>
    typeof value === 'string' && value.length > 0 && value.length <= 100 && /^[0-9a-zA-Z:.[\]-]+$/.test(value);

/** Endereço usado como chave de limite. Nunca vazio: `'unknown'` quando não há. */
export function clientIp(req) {
    const headers = req?.headers || {};
    const candidates = [
        firstValue(headers['x-real-ip']),
        lastValue(headers['x-forwarded-for']),
        String(req?.socket?.remoteAddress || '')
    ];
    for (const candidate of candidates) {
        if (isValidIp(candidate)) return candidate;
    }
    // Sem endereço confiável, tudo cai no mesmo balde: o limite fica mais apertado
    // para todo mundo em vez de sumir para quem manda lixo no cabeçalho.
    return 'unknown';
}
