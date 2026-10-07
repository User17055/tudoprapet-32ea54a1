export type CheckoutPaymentMethod = "pix" | "credit_card" | "debit_card" | "unknown";

/**
 * A integração Shopify -> Olist não enxerga o provedor real quando um
 * draft é quitado fora do checkout nativo da Shopify. Estes note_attributes
 * mantêm a forma e o intermediador no pedido final para o mapeamento financeiro
 * da Olist ("Utilizar meio pagamento informado no note_attributes").
 */
export function externalPaymentAttributes(
  method: CheckoutPaymentMethod,
): Array<{ key: string; value: string }> {
  const labels: Record<Exclude<CheckoutPaymentMethod, "unknown">, string> = {
    pix: "Pix",
    credit_card: "Cartão de crédito",
    debit_card: "Cartão de débito",
  };
  if (method === "unknown") return [];

  return [
    { key: "payment_method", value: method },
    { key: "meio_pagamento", value: labels[method] },
    { key: "payment_gateway", value: "Asaas" },
    { key: "provedor_pagamento", value: "Asaas" },
  ];
}

export function externalPaymentTags(method: CheckoutPaymentMethod): string[] {
  if (method === "unknown") return [];
  return [`pagamento-${method.replaceAll("_", "-")}`, "gateway-asaas"];
}
