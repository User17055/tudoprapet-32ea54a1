// Lógica pura de precificação — sem Deno, sem fetch, sem rede.
// Mantida isolada de propósito: é o que permite testar pelo vitest (src/test/).

export interface LineItem {
  variantId: string; // Shopify GID
  quantity: number;
}

export const CHECKOUT_SERVICE_FEE = 3;

export function addCheckoutServiceFee(total: number): number {
  return Number((total + CHECKOUT_SERVICE_FEE).toFixed(2));
}

/**
 * A taxa de serviço NÃO é um produto: ela entra na linha de frete do pedido,
 * assim o pedido da Shopify mostra apenas os itens comprados de verdade.
 */
export function buildShippingLineWithServiceFee(
  title: string,
  shippingAmount: number,
): { title: string; price: string } {
  return {
    title: `${title} + taxa de serviço`,
    price: (shippingAmount + CHECKOUT_SERVICE_FEE).toFixed(2),
  };
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


// ---------------------------------------------------------------------------
// Parcelamento no cartão — juros repassados ao cliente.
//
// As taxas abaixo são exatamente as da conta Asaas da TudoPraPet
// (GET /myAccount/fees): tarifa fixa por operação + percentual por faixa de
// parcelas. O parcelado é "grossed up" para que o valor líquido recebido
// continue igual ao total do pedido — ou seja, o custo do parcelamento é do
// cliente. O à vista (1x) permanece sem acréscimo.
//
// IMPORTANTE: espelhado em src/lib/installments.ts (test garante a igualdade).
// ---------------------------------------------------------------------------

export const MAX_INSTALLMENTS = 12;
export const MIN_INSTALLMENT_VALUE = 5;
export const CARD_OPERATION_FEE = 0.49;

/** Percentual da Asaas por faixa: até 6x = 3,49%; até 12x = 3,99%. */
export function cardFeePercent(installments: number): number {
  if (installments <= 1) return 2.99;
  return installments <= 6 ? 3.49 : 3.99;
}

export interface InstallmentPlan {
  installments: number;
  installmentValue: number;
  chargedTotal: number;
  interestAmount: number;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

/** Maior número de parcelas possível respeitando a parcela mínima. */
export function maxInstallmentsFor(total: number): number {
  const limit = Math.floor(total / MIN_INSTALLMENT_VALUE);
  return Math.max(1, Math.min(MAX_INSTALLMENTS, limit || 1));
}

/** Plano de parcelamento com os juros da Asaas repassados ao cliente. */
export function installmentPlan(total: number, installments: number): InstallmentPlan {
  const n = Math.max(1, Math.min(MAX_INSTALLMENTS, Math.trunc(installments) || 1));
  const percent = cardFeePercent(n) / 100;
  const gross = (total + CARD_OPERATION_FEE) / (1 - percent);
  const installmentValue = Math.ceil(gross / n * 100) / 100;
  const chargedTotal = round2(installmentValue * n);
  return {
    installments: n,
    installmentValue,
    chargedTotal,
    interestAmount: round2(chargedTotal - total),
  };
}

/** Opções exibidas ao cliente, da menor para a maior quantidade de parcelas. */
export function installmentOptions(total: number): InstallmentPlan[] {
  const max = maxInstallmentsFor(total);
  const options: InstallmentPlan[] = [];
  for (let n = 1; n <= max; n += 1) options.push(installmentPlan(total, n));
  return options;
}
