// Validação de entrada das edge functions. Puro: sem Deno, sem fetch — testável.

import type { LineItem } from "./pricing.ts";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

/**
 * Limites de sanidade, não regra de negócio. Existem para barrar valor absurdo
 * ou malicioso antes de virar Draft Order na Shopify — pedido de franquia pode
 * ser grande de verdade, então são folgados de propósito.
 */
export const MAX_ITEMS = 250;
export const MAX_QUANTITY = 10_000;

const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;

/**
 * Valida o `items` recebido no corpo do checkout.
 *
 * Carrinho ausente ou vazio devolve a mesma mensagem de antes ("Carrinho vazio"),
 * para não mudar o comportamento já observado pelo frontend. As demais mensagens
 * cobrem casos que hoje passam direto para a Shopify sem checagem alguma.
 */
export function parseCheckoutItems(raw: unknown): ValidationResult<LineItem[]> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, message: "Carrinho vazio" };
  }
  if (raw.length > MAX_ITEMS) {
    return { ok: false, message: `Carrinho excede ${MAX_ITEMS} itens` };
  }

  const items: LineItem[] = [];

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      return { ok: false, message: "Item inválido no carrinho" };
    }

    const { variantId, quantity } = entry as Record<string, unknown>;

    if (typeof variantId !== "string" || !VARIANT_GID.test(variantId)) {
      return { ok: false, message: "Identificador de produto inválido" };
    }

    if (typeof quantity !== "number" || !Number.isInteger(quantity)) {
      return { ok: false, message: "Quantidade inválida" };
    }
    if (quantity < 1 || quantity > MAX_QUANTITY) {
      return { ok: false, message: `Quantidade deve estar entre 1 e ${MAX_QUANTITY}` };
    }

    items.push({ variantId, quantity });
  }

  return { ok: true, value: items };
}
