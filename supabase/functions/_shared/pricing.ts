// Lógica pura de precificação — sem Deno, sem fetch, sem rede.
// Mantida isolada de propósito: é o que permite testar pelo vitest (src/test/).

export interface LineItem {
  variantId: string; // Shopify GID
  quantity: number;
}

export function gidToNumericId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1];
}

/**
 * Monta as linhas do draft order.
 *
 * Shopify ignora "price" quando passamos variant_id, então o preço especial
 * é aplicado como applied_discount por linha (fixed_amount por unidade).
 * Só há desconto quando existe preço especial E ele é menor que o preço atual.
 */
export function buildDraftLineItems(
  items: LineItem[],
  specialPrices: Map<string, number>,
  currentPrices: Map<string, number>,
  discountTitle: string,
): Record<string, unknown>[] {
  return items.map((item) => {
    const special = specialPrices.get(item.variantId);
    const current = currentPrices.get(item.variantId);
    const li: Record<string, unknown> = {
      variant_id: Number(gidToNumericId(item.variantId)),
      quantity: item.quantity,
    };
    if (special !== undefined && current !== undefined && current > special) {
      const perUnitDiscount = Number((current - special).toFixed(2));
      li.applied_discount = {
        description: discountTitle,
        value_type: "fixed_amount",
        value: perUnitDiscount.toFixed(2),
        amount: (perUnitDiscount * item.quantity).toFixed(2),
        title: discountTitle,
      };
    }
    return li;
  });
}
