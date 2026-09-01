// O navegador declara ao servidor o que ele ACHA que é.
//
// Por que isso precisa existir: o servidor não consegue descobrir sozinho.
// Medido no código do supabase-js em 01/09/2026:
//
//   // _getAccessToken()
//   return data.session?.access_token ?? this.supabaseKey
//
// Sem sessão viva, o SDK manda a CHAVE PÚBLICA no Authorization — exatamente o
// mesmo cabeçalho de quem nunca logou. Visitante e sessão-que-morreu chegam na
// edge function idênticos, byte a byte.
//
// Quem sabe a diferença é esta ponta: a tela ainda tem o `user`, porque o
// AuthContext o monta a partir de `getSession()`, que lê o localStorage sem
// validar nada com o servidor. Token morto continua produzindo um `user`.
//
// Espelho de SESSION_CLAIM_HEADER em
// supabase/functions/_shared/checkout-access.ts — os dois valores andam juntos,
// e o nome também está literal no ALLOWED_HEADERS de _shared/cors.ts. Mudar em
// um lugar só faz o preflight barrar o cabeçalho e quebra o checkout de quem
// está logado.

export const SESSION_CLAIM_HEADER = "x-tpp-session";

/**
 * Cabeçalho para as functions que autenticam com `optionalCheckoutUser`:
 * `checkout-prepare`, `checkout-payment`, `checkout-status` e
 * `checkout-shipping-options`.
 *
 * As que usam `requireUser` (como `checkout-customer-data`) já recusam sozinhas
 * e não precisam da declaração.
 */
export function sessionClaimHeaders(hasUser: boolean): Record<string, string> {
  return { [SESSION_CLAIM_HEADER]: hasUser ? "user" : "guest" };
}

/**
 * A function recusou porque a declaração do navegador contradiz o token: a tela
 * diz que há sessão, o token é anônimo. A sessão morreu entre abrir o checkout
 * e enviar o pedido.
 *
 * Quem recebe isto deve encerrar a sessão local e mandar a pessoa entrar de
 * novo — insistir só repete o erro, porque o token não melhora sozinho.
 */
export function isDeadSessionError(message: unknown): boolean {
  if (typeof message !== "string") return false;
  const texto = message.toLocaleLowerCase("pt-BR");
  // "Sessão inválida" vem das portas que usam `optionalCheckoutUser`, quando a
  // declaração deste navegador contradiz o token.
  //
  // "Não autorizado" vem de `requireUser`, em checkout-customer-data. É genérica
  // no resto do sistema, mas AQUI não é ambígua: a tela de checkout só existe
  // para quem está logado, então um 401 nela significa exatamente a mesma coisa.
  // Foi essa a mensagem que a cliente recebeu em 01/09/2026, sem nenhuma pista
  // do que fazer a respeito.
  return texto.includes("sessão inválida") || texto.includes("não autorizado");
}
