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

/** Converte as linhas REST legadas para o formato GraphQL sem perder a variante. */
export function toGraphqlDraftLineItems(
  lines: Record<string, unknown>[],
): Record<string, unknown>[] {
  return lines.map((line) => {
    const quantity = Number(line.quantity) || 1;
    const numericVariantId = String(line.variant_id || "");
    const discount = line.applied_discount as Record<string, unknown> | undefined;
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
// Teto do valor cadastrado: nunca acima do preço da Shopify.
//
// Um pedido na Shopify só sabe registrar DESCONTO. `applied_discount` subtrai
// do preço nativo da variante, não existe acréscimo, e a Shopify ignora `price`
// quando a linha traz `variant_id` (ver buildDraftLineItems acima). Ou seja:
// quando o valor cadastrado é MAIOR que o da Shopify, não há como o pedido
// refletir o valor cobrado. Os dois lados divergem em silêncio, de duas formas
// diferentes conforme a porta:
//
//   checkout próprio      o Asaas cobra o valor cadastrado (maior) e o pedido
//   (checkout-prepare)    na Shopify registra o preço nativo (menor). O cliente
//                         paga acima do que o próprio pedido documenta.
//
//   assinante / franquia  o cliente vai ao checkout hospedado da Shopify e paga
//   (_shared/checkout)    o preço nativo (menor), enquanto o site anunciou o
//                         cadastrado (maior). A loja recebe menos do que exibiu.
//
// A regra é o teto: o valor efetivo é o MENOR entre o cadastrado e o da
// Shopify. Assim o valor cobrado sempre bate com o que o pedido registra — que
// é o documento do pedido — e nunca se cobra acima dele.
//
// Isto é contenção, não a correção. Cadastrar acima do preço da Shopify passou
// a ser barrado na tela Admin > Valores; o teto aqui existe para o dado que já
// está gravado e para qualquer caminho novo que esqueça a validação.
// ---------------------------------------------------------------------------

export interface CappedPrice {
  variantId: string;
  /** O que estava cadastrado no banco. */
  configured: number;
  /** O preço da Shopify, que passou a valer. */
  shopifyPrice: number;
}

/**
 * O valor cadastrado passa do preço da Shopify?
 *
 * Preço da Shopify ausente, não numérico ou <= 0 devolve `false`: sem uma
 * referência confiável não dá para afirmar que o cadastrado está errado, e
 * baixar o valor para zero seria dar o produto. Esses casos ficam como estão —
 * quem os detecta é a validação do admin, com o dado na mão.
 */
export function exceedsShopifyPrice(configured: number, shopifyPrice: number): boolean {
  if (!Number.isFinite(configured) || configured <= 0) return false;
  if (!Number.isFinite(shopifyPrice) || shopifyPrice <= 0) return false;
  return configured > shopifyPrice;
}

/**
 * Aplica o teto a um mapa de valores cadastrados.
 *
 * Não altera o mapa recebido: devolve um novo, mais a lista do que foi limitado
 * para que o chamador registre em log. Variante sem preço da Shopify no mapa de
 * referência passa intacta — não há com o que comparar.
 */
export function capPricesToShopify(
  configured: Map<string, number>,
  shopifyPrices: Map<string, number>,
): { prices: Map<string, number>; capped: CappedPrice[] } {
  const prices = new Map(configured);
  const capped: CappedPrice[] = [];
  for (const [variantId, price] of configured) {
    const shopifyPrice = shopifyPrices.get(variantId);
    if (shopifyPrice === undefined) continue;
    if (!exceedsShopifyPrice(price, shopifyPrice)) continue;
    prices.set(variantId, shopifyPrice);
    capped.push({ variantId, configured: price, shopifyPrice });
  }
  return { prices, capped };
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
