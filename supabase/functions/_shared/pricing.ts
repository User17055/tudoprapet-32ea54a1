// Lógica pura de precificação — sem Deno, sem fetch, sem rede.
// Mantida isolada de propósito: é o que permite testar pelo vitest (src/test/).

export interface LineItem {
  variantId: string; // Shopify GID
  quantity: number;
}

// Mantido no snapshot e no banco para compatibilidade com pedidos antigos.
// Novos checkouts não cobram taxa operacional.
export const CHECKOUT_SERVICE_FEE = 0;
export const FRANCHISE_ORDER_FEE = 2;

export function checkoutServiceFee(customerType: "common" | "subscriber" | "franchise"): number {
  return customerType === "franchise" ? FRANCHISE_ORDER_FEE : CHECKOUT_SERVICE_FEE;
}

export function buildServiceFeeLine(
  amount: number,
  title = "Taxa operacional da franquia",
): Record<string, unknown> | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    title,
    price: amount.toFixed(2),
    quantity: 1,
    requires_shipping: false,
    taxable: false,
  };
}

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

/**
 * O preço unitário efetivamente cobrado: o preço de perfil (clube/franquia)
 * quando existe e é menor que o de catálogo, senão o de catálogo.
 *
 * Repare no que esta função NÃO recebe: o preço da Shopify. É de propósito.
 *
 * Em 28/08 duas correções do mesmo bug se encontraram num merge. Uma limitava o
 * preço final ao da Shopify, a outra cobrava a diferença numa linha de ajuste.
 * Juntas, o preço chegava limitado em buildPriceAdjustmentLine, o acréscimo
 * nunca era calculado e a linha de ajuste sumia -- sem erro de compilação e sem
 * nenhum teste falhando, porque a lógica estava solta dentro de cada porta.
 *
 * Concentrando a decisão aqui, e sem o preço da Shopify no escopo, limitar o
 * valor deixa de ser algo que se faz por descuido: não há o que comparar.
 */
export function resolveUnitPrice(
  catalogPrice: number | undefined,
  specialPrice: number | undefined,
): number | undefined {
  const catalogo = catalogPrice !== undefined && Number.isFinite(catalogPrice) ? catalogPrice : undefined;
  const especial = specialPrice !== undefined && Number.isFinite(specialPrice) && specialPrice > 0
    ? specialPrice
    : undefined;
  if (especial === undefined) return catalogo;
  if (catalogo === undefined) return especial;
  return especial < catalogo ? especial : catalogo;
}

/** Garante que nenhum fluxo de franquia cobre abaixo do custo conhecido. */
export function applyCostFloor(price: number | undefined, cost: number | undefined): number | undefined {
  if (price === undefined) return cost;
  if (cost === undefined || !Number.isFinite(cost) || cost <= 0) return price;
  return Math.max(price, cost);
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

/**
 * Variantes que ficaram sem preço da Shopify para comparar.
 *
 * buildPriceAdjustmentLine ignora o item quando o preço nativo não veio --
 * fetchCurrentVariantPrices só devolve a variante que a Storefront API
 * respondeu com preço numérico, e ela some quando o produto foi despublicado ou
 * removido. Sem essa referência não dá para calcular a diferença, então o
 * acréscimo simplesmente não entra no ajuste e a divergência volta calada, que é
 * exatamente o bug que a linha de ajuste veio resolver.
 *
 * Isto não conserta o caso: só o torna visível no log. Quem chama decide.
 */
export function findUnpricedVariants(
  items: LineItem[],
  finalPrices: Map<string, number>,
  currentPrices: Map<string, number>,
): string[] {
  const semPreco = new Set<string>();
  for (const item of items) {
    if (currentPrices.has(item.variantId)) continue;
    const final = finalPrices.get(item.variantId);
    if (final === undefined || !Number.isFinite(final)) continue;
    semPreco.add(item.variantId);
  }
  return [...semPreco];
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
    if (line.price_override !== undefined) {
      graphqlLine.priceOverride = {
        amount: Number(Number(line.price_override).toFixed(2)),
        currencyCode: "BRL",
      };
      return graphqlLine;
    }

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
// Valor cadastrado acima do preço da Shopify.
//
// Um pedido na Shopify só sabe registrar DESCONTO na linha da variante:
// `applied_discount` subtrai do preço nativo, e a Shopify ignora `price` quando
// a linha traz `variant_id` (ver buildDraftLineItems acima). Não existe
// acréscimo na linha da variante.
//
// Isso não impede cobrar acima do preço nativo — só impede fazê-lo naquela
// linha. A diferença entra como uma linha customizada, sem variante, montada
// por buildPriceAdjustmentLine. Assim o pedido registra o mesmo total que o
// cliente paga, e a variante continua dando baixa no estoque.
//
// A função abaixo é só o teste da condição. Ela não decide nada: serve para o
// admin saber que aquele valor vai gerar linha de ajuste, e é espelhada em
// src/lib/priceCap.ts (src/test/priceCap.test.ts garante que concordam).
// ---------------------------------------------------------------------------

/**
 * O valor cadastrado passa do preço da Shopify?
 *
 * Preço da Shopify ausente, não numérico ou <= 0 devolve `false`: sem uma
 * referência confiável não dá para afirmar nada sobre o cadastrado.
 */
export function exceedsShopifyPrice(configured: number, shopifyPrice: number): boolean {
  if (!Number.isFinite(configured) || configured <= 0) return false;
  if (!Number.isFinite(shopifyPrice) || shopifyPrice <= 0) return false;
  return configured > shopifyPrice;
}

export const MAX_INSTALLMENTS = 12;
export const MIN_INSTALLMENT_VALUE = 5;
export const CARD_OPERATION_FEE = 0.49;

// Piso do Asaas para qualquer cobrança: abaixo disso a API recusa com 400
// invalid_object. Até 31/08/2026 nada barrava esse caso, então o pedido era
// preparado, o rascunho nascia na Shopify e só depois a cobrança falhava — e a
// mensagem que sobrava para o cliente falava de cartão mesmo em compra no Pix.
// Não é hipótese: houve 6 ocorrências entre 17/08 e 31/08/2026, uma delas de
// R$ 3,85. O desconto do Clube derruba carrinho pequeno abaixo do piso, então
// quem mais esbarra nisso é justamente o assinante.
export const MIN_CHARGE_VALUE = 5;

/**
 * Reconhece a recusa de valor mínimo do Asaas pela mensagem de erro. Mora aqui,
 * e não solto dentro do handler, para que o teste exercite a mesma expressão
 * que roda em produção: uma cópia da regex no teste passaria a valer sozinha no
 * dia em que o handler mudasse.
 */
export function isBelowMinimumChargeError(message: string): boolean {
  return /Asaas 400:[\s\S]*n[aã]o pode ser menor que/i.test(message);
}

/**
 * Aviso único de carrinho abaixo do piso, compartilhado pelas duas portas.
 * O total é opcional porque o mesmo aviso serve quando o Asaas é quem recusa e
 * só temos a mensagem dele, sem o valor da sacola em mãos.
 */
export function belowMinimumChargeMessage(total?: number): string {
  const base = `O valor mínimo para pagamento é R$ ${MIN_CHARGE_VALUE},00`;
  if (total === undefined || !Number.isFinite(total)) {
    return `${base}. Adicione mais itens para concluir a compra.`;
  }
  return `${base} e seu carrinho está em R$ ${total.toFixed(2).replace(".", ",")}. Adicione mais itens para concluir a compra.`;
}

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

/**
 * Linhas do rascunho com o preço final DENTRO de cada produto (priceOverride
 * da Shopify, API 2025-01+). Ajuste de preço e taxa da franquia não viram mais
 * linhas avulsas: a taxa é rateada entre os produtos, em centavos, de modo que
 * soma(preço x qtd) = soma(preço final x qtd) + taxa exatamente.
 * Só sobra linha avulsa se for matematicamente impossível ratear (centavos que
 * nenhuma quantidade divide) — caso raríssimo, devolvido em `residualFee`.
 */
export function buildPricedDraftLineItems(
  items: LineItem[],
  finalPrices: Map<string, number>,
  fee: number,
): { lines: Record<string, unknown>[]; residualFee: number } {
  const cents = (v: number) => Math.round(v * 100);
  const unit = items.map((item) => cents(finalPrices.get(item.variantId) ?? 0));
  let feeCents = Number.isFinite(fee) && fee > 0 ? cents(fee) : 0;
  const base = items.reduce((s, it, i) => s + unit[i] * it.quantity, 0);
  const extra = items.map(() => 0);
  if (feeCents > 0 && base > 0) {
    // Rateio proporcional, arredondado para baixo por unidade.
    items.forEach((it, i) => {
      const share = Math.floor((feeCents * unit[i] * it.quantity) / base / it.quantity);
      extra[i] = share;
    });
    let rest = feeCents - items.reduce((s, it, i) => s + extra[i] * it.quantity, 0);
    // Distribui o resto em linhas cuja quantidade divide o valor.
    for (let guard = 0; rest > 0 && guard < 10000; guard++) {
      const idx = items.findIndex((it) => it.quantity <= rest && rest % it.quantity === 0);
      const any = idx >= 0 ? idx : items.findIndex((it) => it.quantity <= rest);
      if (any < 0) break;
      const add = idx >= 0 ? rest / items[any].quantity : Math.floor(rest / items[any].quantity);
      extra[any] += add;
      rest -= add * items[any].quantity;
    }
    feeCents = rest;
  }
  const lines = items.map((item, i) => {
    const li: Record<string, unknown> = {
      variant_id: Number(gidToNumericId(item.variantId)),
      quantity: item.quantity,
    };
    if (finalPrices.has(item.variantId)) {
      li.price_override = ((unit[i] + extra[i]) / 100).toFixed(2);
    }
    return li;
  });
  return { lines, residualFee: feeCents / 100 };
}
