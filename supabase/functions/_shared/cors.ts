// Cabeçalhos CORS únicos para todas as edge functions.
//
// A lista é a UNIÃO de tudo que já era permitido em cada function antes de
// centralizar aqui, mais os headers canônicos do SDK
// (`@supabase/supabase-js/cors`: authorization, x-client-info, apikey,
// content-type, x-retry-count).
//
// União e não substituição: liberar um header a mais nunca quebra uma chamada
// que já funcionava, mas remover um quebra o preflight na hora.

const ALLOWED_HEADERS = [
  // canônicos do SDK
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "x-retry-count",
  // enviados por versões mais novas do cliente Supabase
  "x-supabase-client-platform",
  "x-supabase-client-platform-version",
  "x-supabase-client-runtime",
  "x-supabase-client-runtime-version",
];

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": ALLOWED_HEADERS.join(", "),
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
