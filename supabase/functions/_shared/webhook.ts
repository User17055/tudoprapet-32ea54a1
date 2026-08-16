// Verificação de assinatura de webhook da Shopify.
//
// Webhook não se autentica por JWT — se autentica pela assinatura HMAC-SHA256
// que a Shopify envia no header x-shopify-hmac-sha256, calculada sobre o corpo
// bruto da requisição com o segredo compartilhado.
//
// A política de decisão está separada do cálculo criptográfico de propósito:
// é o que permite testá-la pelo vitest sem depender de crypto.subtle.

export type HmacMode = "enforce" | "monitor";

/**
 * `enforce`  — assinatura inválida é rejeitada com 401.
 * `monitor`  — assinatura é verificada e o resultado registrado, mas o webhook
 *              segue processando.
 *
 * O padrão é `enforce`: aceitar payload forjado permitiria que qualquer pessoa
 * redirecionasse o código de retirada de um pedido real para o próprio WhatsApp.
 * O `monitor` continua disponível, mas só quando pedido explicitamente
 * (SHOPIFY_WEBHOOK_HMAC_MODE=monitor) durante uma troca de segredo.
 */
export function resolveHmacMode(raw: string | null | undefined): HmacMode {
  return String(raw ?? "").trim().toLowerCase() === "monitor" ? "monitor" : "enforce";
}


/**
 * Comparação em tempo constante. Um `===` comum sai no primeiro byte diferente,
 * o que em teoria permite descobrir a assinatura esperada byte a byte medindo o
 * tempo de resposta.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface HmacDecisionInput {
  mode: HmacMode;
  secretConfigured: boolean;
  /** null quando não houve verificação (sem segredo configurado). */
  signatureValid: boolean | null;
}

export interface HmacDecision {
  action: "accept" | "reject";
  /** Rótulo estável para log e para os testes. */
  reason:
    | "valid"
    | "invalid-monitored"
    | "invalid-rejected"
    | "secret-missing-monitored"
    | "secret-missing-rejected";
}

/**
 * Decide o que fazer com a requisição a partir do resultado da verificação.
 *
 * Segredo ausente em modo `enforce` é rejeitado: quem liga o enforce está
 * afirmando que a verificação funciona, e aceitar em silêncio nesse caso daria
 * uma falsa sensação de segurança — foi exatamente o buraco anterior.
 */
export function decideHmac({ mode, secretConfigured, signatureValid }: HmacDecisionInput): HmacDecision {
  if (!secretConfigured) {
    return mode === "enforce"
      ? { action: "reject", reason: "secret-missing-rejected" }
      : { action: "accept", reason: "secret-missing-monitored" };
  }

  if (signatureValid) return { action: "accept", reason: "valid" };

  return mode === "enforce"
    ? { action: "reject", reason: "invalid-rejected" }
    : { action: "accept", reason: "invalid-monitored" };
}

/** Calcula o HMAC-SHA256 do corpo bruto e compara com o header da Shopify. */
export async function verifyShopifyHmac(
  rawBody: string,
  hmacHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!hmacHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return timingSafeEqual(b64, hmacHeader);
}
