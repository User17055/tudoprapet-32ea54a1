// Cabeçalhos CORS únicos para todas as edge functions.
//
// A lista é a UNIÃO de tudo que já era permitido em cada function antes de
// centralizar aqui, mais os headers canônicos do SDK
// (`@supabase/supabase-js/cors`: authorization, x-client-info, apikey,
// content-type, x-retry-count).
//
// União e não substituição: liberar um header a mais nunca quebra uma chamada
// que já funcionava, mas remover um quebra o preflight na hora.

/**
 * Marcador de versão das edge functions.
 *
 * Existe por causa de uma armadilha do Lovable Cloud: sincronizar código e publicar
 * function são mecanismos separados. O deploy só roda quando o Lovable edita uma
 * function — mudança vinda de Pull Request fica no editor e não vai ao ar, em silêncio.
 * Ver docs/smoke-test-edge-functions.md, Parte 3.
 *
 * Para descobrir o que está publicado sem credencial do Supabase, era preciso achar
 * a cada entrega alguma diferença observável entre o código novo e o que roda — em
 * agosto/2026 serviu o `x-retry-count`. Esse tipo de sinal expira: depois que a versão
 * nova sobe, ele passa a estar sempre presente e não distingue mais nada.
 *
 * Esta constante troca "descobrir um discriminador" por "ler um número".
 *
 * REGRA: incremente a cada entrega que mexa em supabase/functions/.
 * `scripts/check-deploy.sh` compara este valor com o que a function publicada devolve.
 */
export const FUNCTIONS_VERSION = "2026-08-15.1";

const ALLOWED_HEADERS = [
  // canônicos do SDK
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-retry-count",
  // agente de impressão local (admin-orders)
  "x-print-agent-token",

  // enviados por versões mais novas do cliente Supabase
  "x-supabase-client-platform",
  "x-supabase-client-platform-version",
  "x-supabase-client-runtime",
  "x-supabase-client-runtime-version",
];

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": ALLOWED_HEADERS.join(", "),
  // Não faz parte do CORS: viaja junto porque este objeto já é espalhado em toda
  // resposta de toda function, inclusive no OPTIONS — que é o que permite sondar a
  // versão publicada sem processar corpo nem disparar nada.
  "x-tpp-functions-version": FUNCTIONS_VERSION,
};

/** Variante com headers extras — usada por webhooks que recebem cabeçalhos próprios. */
export function corsHeadersWith(...extraHeaders: string[]) {
  return {
    ...corsHeaders,
    "Access-Control-Allow-Headers": [...ALLOWED_HEADERS, ...extraHeaders].join(", "),
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}
