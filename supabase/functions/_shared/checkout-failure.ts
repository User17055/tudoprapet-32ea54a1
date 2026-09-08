// Traducao das recusas da Shopify (draftOrderCreate) em motivo compreensivel,
// preservando o campo recusado para diagnostico no administrativo.

export interface ShopifyUserError {
  field: string;
  message: string;
}

export function normalizeShopifyUserErrors(raw: unknown): ShopifyUserError[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((entry) => {
    if (typeof entry === "string") return { field: "", message: entry };
    const item = (entry || {}) as { field?: unknown; message?: unknown; path?: unknown };
    const source = Array.isArray(item.field) ? item.field : Array.isArray(item.path) ? item.path : item.field;
    const field = Array.isArray(source) ? source.join(".") : source ? String(source) : "";
    return {
      field: field === "undefined" ? "" : field,
      message: typeof item.message === "string" ? item.message : "",
    };
  }).filter((entry) => entry.field || entry.message);
}

const FIELD_REASONS: Array<[RegExp, string]> = [
  [/phone/i, "A Shopify recusou o telefone informado"],
  [/email/i, "A Shopify recusou o e-mail informado"],
  [/(zip|postal)/i, "A Shopify recusou o CEP informado"],
  [/(province|state)/i, "A Shopify recusou o estado (UF) informado"],
  [/address/i, "A Shopify recusou o endereço informado"],
  [/(taxcredential|localizedfield)/i, "A Shopify recusou o CPF/CNPJ informado"],
  [/(lineitem|variant)/i, "Um dos produtos do carrinho não pôde ser vendido agora"],
  [/shipping/i, "A modalidade de frete escolhida não foi aceita pela Shopify"],
  [/customer|purchasingentity/i, "A Shopify não conseguiu vincular o cadastro do cliente"],
];

/** Motivo em português, sem expor documento do cliente. */
export function describeDraftFailure(errors: ShopifyUserError[], fallback: string): string {
  if (!errors.length) return fallback;
  const parts = errors.map((error) => {
    const target = `${error.field} ${error.message}`;
    const reason = FIELD_REASONS.find(([pattern]) => pattern.test(target))?.[1];
    const detail = [error.field, error.message].filter(Boolean).join(": ");
    return reason ? `${reason} (${detail})` : detail;
  }).filter(Boolean);
  return (parts.join(" | ") || fallback)
    .replace(/\b\d{11,14}\b/g, "[documento protegido]")
    .slice(0, 500);
}

const RETRYABLE = /throttl|rate limit|reduce rate|internal error|timeout|temporar|try again/i;

/** Falhas passageiras: vale nova tentativa; recusa de campo, nunca. */
export function isRetryableShopifyFailure(status: number, errors: ShopifyUserError[]): boolean {
  if (status === 429 || status === 408 || status >= 500) return true;
  return errors.some((error) => RETRYABLE.test(`${error.field} ${error.message}`));
}

export function hasFieldError(errors: ShopifyUserError[], pattern: RegExp): boolean {
  return errors.some((error) => pattern.test(`${error.field} ${error.message}`));
}
