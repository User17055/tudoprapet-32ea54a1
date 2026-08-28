// Lógica pura de precificação — sem Deno, sem fetch, sem rede.
// Mantida isolada de propósito: é o que permite testar pelo vitest (src/test/).

export interface LineItem {
  variantId: string; // Shopify GID
  quantity: number;
}

// Mantido no snapshot e no banco para compatibilidade com pedidos antigos.
// Novos checkouts não cobram taxa operacional.
export const CHECKOUT_SERVICE_FEE = 0;

/**
 * A forma de entrega é enviada separadamente dos produtos. Os itens do pedido
 * continuam vinculados às variantes reais cadastradas na Shopify.
 */
export function buildShippingLine(
  title: string,
  shippingAmount: number,
): { title: string; price: string } {
  return {
    title,
    price: shippingAmount.toFixed(2),
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
    if (
      special !== undefined &&
      current !== undefined &&
      Number.isFinite(special) &&
      special > 0 &&
      current > special
    ) {
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

export const PRICE_ADJUSTMENT_TITLE = "Ajuste de preço TudoPraPet";

/**
 * A Shopify ignora "price" em linhas com variant_id e applied_discount só sabe
 * baixar valor. Quando o preço definido no sistema é MAIOR que o da Shopify, o
 * rascunho ficaria mais barato que o valor efetivamente cobrado. Para manter o
 * pedido igual ao que o cliente pagou — e sem perder a baixa de estoque das
 * variantes — a diferença entra como uma linha customizada de ajuste.
 */
export function buildPriceAdjustmentLine(
  items: LineItem[],
  finalPrices: Map<string, number>,
  currentPrices: Map<string, number>,
  title: string = PRICE_ADJUSTMENT_TITLE,
): Record<string, unknown> | null {
  let uplift = 0;
  for (const item of items) {
    const final = finalPrices.get(item.variantId);
    const current = currentPrices.get(item.variantId);
    if (
      final === undefined || current === undefined ||
      !Number.isFinite(final) || !Number.isFinite(current) || final <= current
    ) continue;
    uplift += (final - current) * item.quantity;
  }
  uplift = Number(uplift.toFixed(2));
  if (uplift <= 0) return null;
  return {
    title,
    price: uplift.toFixed(2),
    quantity: 1,
    requires_shipping: false,
    taxable: false,
  };
}

/** Converte as linhas REST legadas para o formato GraphQL sem perder a variante. */
export function toGraphqlDraftLineItems(
  lines: Record<string, unknown>[],
): Record<string, unknown>[] {
  return lines.map((line) => {
    const quantity = Number(line.quantity) || 1;
    const numericVariantId = String(line.variant_id || "");
    const discount = line.applied_discount as Record<string, unknown> | undefined;
    // Linha customizada (ajuste de preço): não tem variante, leva título e valor.
    if (!numericVariantId) {
      return {
        title: String(line.title || PRICE_ADJUSTMENT_TITLE),
        originalUnitPrice: Number(Number(line.price).toFixed(2)),
        quantity,
        requiresShipping: line.requires_shipping === true,
        taxable: line.taxable === true,
      };
    }
    const graphqlLine: Record<string, unknown> = {
      variantId: numericVariantId.startsWith("gid://")
        ? numericVariantId
        : `gid://shopify/ProductVariant/${numericVariantId}`,
      quantity,
    };

    if (discount) {
      // DraftOrderLineItemInput aplica o desconto fixo a cada unidade da linha.
      // Enviar `amount` (valor unitário x quantidade) faria a Shopify descontar
      // o total novamente em cada item. Ex.: 2 x R$ 2,26 virariam R$ 4,52 de
      // desconto por unidade.
      const storedUnitDiscount = Number(discount.value);
      const perUnitDiscount = Number.isFinite(storedUnitDiscount)
        ? storedUnitDiscount
        : Number(discount.amount) / quantity;
      if (Number.isFinite(perUnitDiscount) && perUnitDiscount > 0) {
        graphqlLine.appliedDiscount = {
          description: discount.description || undefined,
          title: discount.title || undefined,
          valueType: "FIXED_AMOUNT",
          value: Number(perUnitDiscount.toFixed(2)),
        };
      }
    }
    return graphqlLine;
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

// Antecipação automática ativada na conta Asaas. Taxas reais (GET /myAccount/fees):
// crédito à vista = 1,25% ao mês; parcelado = 1,70% ao mês.
// O prazo normal de recebimento é 32 dias (1ª parcela) e +30 dias por parcela
// seguinte, então o custo médio da antecipação é a taxa mensal multiplicada
// pelo prazo médio em meses. Esse custo também é repassado ao cliente.
export const ANTICIPATION_ENABLED = true;
export const ANTICIPATION_DETACHED_MONTHLY_PERCENT = 1.25;
export const ANTICIPATION_INSTALLMENT_MONTHLY_PERCENT = 1.7;
const CARD_DAYS_TO_RECEIVE = 32;

export function anticipationFeePercent(installments: number): number {
  if (!ANTICIPATION_ENABLED) return 0;
  const n = Math.max(1, Math.min(MAX_INSTALLMENTS, Math.trunc(installments) || 1));
  const averageMonths = CARD_DAYS_TO_RECEIVE / 30 + (n - 1) / 2;
  const monthly = n <= 1
    ? ANTICIPATION_DETACHED_MONTHLY_PERCENT
    : ANTICIPATION_INSTALLMENT_MONTHLY_PERCENT;
  return Number((monthly * averageMonths).toFixed(4));
}

/** Percentual total retido pela Asaas (taxa do cartão + antecipação). */
export function totalCardCostPercent(installments: number): number {
  return Number((cardFeePercent(installments) + anticipationFeePercent(installments)).toFixed(4));
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
  const percent = totalCardCostPercent(n) / 100;
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
