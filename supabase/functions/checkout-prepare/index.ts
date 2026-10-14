// force redeploy 2026-08-17
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import {
  hashCheckoutAccessToken,
  newCheckoutAccessToken,
  optionalCheckoutUser,
} from "../_shared/checkout-access.ts";
import { parseCheckoutPrepareInput, shippingLabel } from "../_shared/checkout-input.ts";
import {
  applyCostFloor,
  belowMinimumChargeMessage,
  buildServiceFeeLine,
  buildPricedDraftLineItems,
  buildShippingLine,
  checkoutServiceFee,
  MIN_CHARGE_VALUE,
  resolveUnitPrice,
} from "../_shared/pricing.ts";
import {
  createFiscalDraftOrder,
  fetchShopifyDraftDeliveryOptions,
  fetchShopifyDraftPickupOptions,
  fetchVariantCheckoutDetails,
  ShopifyInventoryVerificationError,
} from "../_shared/shopify.ts";
import { shopifyAddress } from "../_shared/shopify-address.ts";
import { applyDeliveryPolicy } from "../_shared/shipping-policy.ts";
import { writeCheckoutAttemptLog } from "../_shared/checkout-log.ts";
import { hasFieldError, type ShopifyUserError } from "../_shared/checkout-failure.ts";
import { PICKUP_HOURS } from "../_shared/pickup.ts";
import { hasSufficientFranchiseInventory, hasSufficientInventory } from "../_shared/inventory.ts";
import {
  commissionForLine,
  type CommissionRule,
  selectCommissionRule,
} from "../_shared/commission.ts";
import {
  type FranchiseFiscalIdentity,
  type FranchiseFiscalProfile,
  resolveFranchiseFiscalIdentity,
} from "../_shared/franchise-fiscal.ts";
import { fetchAllRows, fetchAllRowsResult } from "../_shared/fetch-all-rows.ts";
import { franchiseOrderFingerprint } from "../_shared/franchise-order-dedup.ts";
import {
  externalPaymentAttributes,
  externalPaymentTags,
} from "../_shared/shopify-payment.ts";

function readFirstEnv(keys: string[]): string {
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value) return value;
  }
  return "";
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Mensagem ao cliente: nunca expõe o motivo técnico nem o texto cru da loja
 * (e-mail duplicado, telefone em uso, escopo de token etc.). O detalhe real
 * fica só no log administrativo (checkout_attempt_logs). Aqui o cliente recebe
 * no máximo uma dica genérica de qual dado revisar.
 */
function customerFacingDraftError(errors: ShopifyUserError[], _detail?: string | null): string {
  if (hasFieldError(errors, /phone/i)) {
    return "Não conseguimos concluir seu pedido. Revise o telefone informado e tente novamente.";
  }
  if (hasFieldError(errors, /email/i)) {
    return "Não conseguimos concluir seu pedido. Revise o e-mail informado e tente novamente.";
  }
  if (hasFieldError(errors, /(zip|postal|province|address)/i)) {
    return "Não conseguimos concluir seu pedido. Revise o endereço informado e tente novamente.";
  }
  if (hasFieldError(errors, /(taxcredential|localizedfield)/i)) {
    return "Não conseguimos concluir seu pedido. Revise o CPF/CNPJ informado e tente novamente.";
  }
  if (hasFieldError(errors, /(lineitem|variant)/i)) {
    return "Um dos produtos da sacola ficou indisponível. Revise a sacola e tente de novo.";
  }
  if (hasFieldError(errors, /shipping/i)) {
    return "Escolha novamente a forma de entrega e tente de novo.";
  }
  return "Não conseguimos concluir seu pedido agora. Tente novamente em alguns instantes ou fale com o atendimento.";
}

async function requestKey(req: Request, userId: string | null): Promise<string> {
  const forwarded = req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const source = userId ? `user:${userId}` : `ip:${forwarded.trim()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);

  let dedupAdmin: any = null;
  let dedupFingerprint: string | null = null;
  let keepDedupLock = false;
  try {
    const auth = await optionalCheckoutUser(req);
    if (auth.invalidAuthorization) return errorResponse("Sessão inválida", 401);

    const rawBody = await req.json() as Record<string, unknown>;
    const requestedOpenOrderId = typeof rawBody.openOrderId === "string" ? rawBody.openOrderId : null;
    const intendedMethod = rawBody.paymentMethod === "credit_card"
      ? "credit_card"
      : rawBody.paymentMethod === "debit_card"
      ? "debit_card"
      : rawBody.paymentMethod === "pix"
      ? "pix"
      : "unknown";
    const parsed = parseCheckoutPrepareInput(rawBody);
    if (!parsed.ok) return errorResponse(parsed.message, 400);
    const input = parsed.value;
    let referral: { id: string; code: string; employee_name: string } | null = null;

    // Entrega será ligada depois que o spike confirmar as tarifas da loja. Até
    // lá, o checkout existente continua sendo o fallback seguro para envio.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
    dedupAdmin = admin;
    const { error: rateError } = await admin.rpc("consume_checkout_rate_limit", {
      p_key_hash: await requestKey(req, auth.user?.id ?? null),
      p_limit: 8,
      p_window_seconds: 600,
    });
    if (rateError) {
      if (rateError.message?.includes("checkout_rate_limit_exceeded")) {
        return errorResponse("Muitas tentativas de checkout. Aguarde alguns minutos.", 429);
      }
      throw rateError;
    }
    if (input.referralCode) {
      const { data, error } = await admin.from("employee_referral_codes")
        .select("id,code,employee_name")
        .eq("code", input.referralCode)
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      if (!data) return errorResponse("Código de indicação não encontrado ou inativo", 400);
      referral = { id: data.id, code: data.code, employee_name: data.employee_name };
    }
    // Cliente na lista de bloqueio nunca gera comissão, mesmo com código válido
    // (ex.: compra recorrente da própria pessoa). O código continua salvo na
    // venda só para atribuição; o cálculo de comissão fica de fora.
    let commissionBlocked = false;
    if (referral) {
      const { data: blockedRow, error: blockedError } = await admin.from(
        "commission_blocked_customers",
      )
        .select("id").eq("email", input.customer.email.trim().toLowerCase()).maybeSingle();
      if (blockedError) throw blockedError;
      commissionBlocked = Boolean(blockedRow);
    }
    const storefrontToken = readFirstEnv([
      "SHOPIFY_STOREFRONT_ACCESS_TOKEN",
      "SHOPIFY_STOREFRONT_TOKEN",
    ]);
    const shopifyToken = readFirstEnv([
      "SHOPIFY_ACCESS_TOKEN",
      "SHOPIFY_ONLINE_ACCESS_TOKEN:user:4HrJkQRl3KUXTrTOAgUkwQSkHWo2",
    ]);
    if (!storefrontToken || !shopifyToken) {
      return errorResponse("Loja temporariamente indisponível. Tente novamente em instantes.", 500);
    }

    let customerType: "common" | "subscriber" | "franchise" = "common";
    let franchiseFiscalProfile: FranchiseFiscalProfile | null = null;
    let fiscalIdentity: FranchiseFiscalIdentity | null = null;
    let franchisePaymentTermDays = 7;
    let franchisePaymentScheduleType: "days_after_order" | "fixed_day_next_month" = "days_after_order";
    let franchisePaymentDueDay: number | null = null;
    let openOrder: { id: string; shopify_draft_order_id: string; items: Array<{ variantId: string; quantity: number }>; reserved_until: string } | null = null;
    if (auth.user) {
      const [{ data: profile }, { data: clubMember }] = await Promise.all([
        admin.from("profiles").select("is_franchisee,name,cpf,cnpj,company_legal_name,company_trade_name,state_registration,state_registration_indicator").eq("user_id", auth.user.id).maybeSingle(),
        admin.from("club_members").select("is_active")
          .eq("email", (auth.user.email || input.customer.email).toLowerCase())
          .eq("is_active", true).maybeSingle(),
      ]);
      if (profile?.is_franchisee) {
        customerType = "franchise";
        franchiseFiscalProfile = profile;
      }
      else if (clubMember?.is_active) customerType = "subscriber";
    }

    if (customerType === "franchise") {
      if (!input.invoicePurpose) {
        return errorResponse("Escolha se a nota fiscal será para revenda ou consumo final", 400);
      }
      // Identidade fiscal única, vinda só do perfil salvo; o documento digitado
      // no navegador nunca entra no pedido da franquia.
      const resolved = resolveFranchiseFiscalIdentity(franchiseFiscalProfile, input.invoicePurpose);
      const fiscalError = resolved.ok ? null : resolved.error;
      if (resolved.ok) fiscalIdentity = resolved.identity;
      const { count: savedAddressCount, error: addressCountError } = await admin.from("customer_addresses")
        .select("id", { count: "exact", head: true }).eq("user_id", auth.user!.id);
      if (addressCountError) throw addressCountError;
      if (fiscalError || (savedAddressCount ?? 0) === 0) {
        return jsonResponse({
          error: fiscalError || "Cadastre um endereço fiscal no perfil da franquia",
          profileRequired: true,
        });
      }
      const { data: credit } = await admin.from("franchise_credit_accounts")
        .select("manually_blocked,blocked_reason,block_on_any_open_invoice,payment_term_days,payment_schedule_type,payment_due_day")
        .eq("user_id", auth.user!.id).maybeSingle();
      if (credit?.manually_blocked) {
        return jsonResponse({
          error: credit.blocked_reason || "Franquia bloqueada para novos pedidos",
        }, 403);
      }
      const configuredDays = Number(credit?.payment_term_days);
      franchisePaymentTermDays = Number.isInteger(configuredDays) && configuredDays >= 1 && configuredDays <= 365
        ? configuredDays
        : 7;
      franchisePaymentScheduleType = credit?.payment_schedule_type === "fixed_day_next_month"
        ? "fixed_day_next_month"
        : "days_after_order";
      const configuredDueDay = Number(credit?.payment_due_day);
      franchisePaymentDueDay = franchisePaymentScheduleType === "fixed_day_next_month" &&
          Number.isInteger(configuredDueDay) && configuredDueDay >= 1 && configuredDueDay <= 31
        ? configuredDueDay
        : null;
      // Todas as sessoes da franquia, sem corte: uma que ficasse de fora escaparia da
      // trava de fatura em aberto.
      const financialSessions = await fetchAllRows<{ id: string }>(admin, "checkout_sessions", "id", {
        orderBy: "id",
        filter: (query) => query.eq("user_id", auth.user!.id).eq("customer_type", "franchise"),
      });
      const sessionIds = (financialSessions ?? []).map((row) => row.id);
      if (sessionIds.length) {
        let overdueQuery = admin.from("payments").select("id", { count: "exact", head: true })
          .in("checkout_session_id", sessionIds);
        overdueQuery = credit?.block_on_any_open_invoice
          ? overdueQuery.in("status", ["pending", "processing", "confirmed", "overdue"])
          : overdueQuery.eq("status", "overdue");
        const { count } = await overdueQuery;
        if ((count ?? 0) > 0) {
          return jsonResponse(
            { error: "Existe uma cobrança pendente que bloqueia novos pedidos" },
            403,
          );
        }
      }

      if (requestedOpenOrderId) {
        const { data: savedOrder, error: savedOrderError } = await admin.from("franchise_open_orders")
          .select("id,shopify_draft_order_id,items,reserved_until")
          .eq("id", requestedOpenOrderId).eq("user_id", auth.user!.id).eq("status", "open").maybeSingle();
        if (savedOrderError) throw savedOrderError;
        if (!savedOrder) return errorResponse("Pedido em aberto não encontrado", 404);
        if (Date.parse(savedOrder.reserved_until) <= Date.now()) {
          return errorResponse("A reserva de estoque deste pedido venceu", 409);
        }
        const savedItems = (savedOrder.items as Array<{ variantId?: unknown; quantity?: unknown }>).map((item) => ({
          variantId: String(item.variantId || ""),
          quantity: Number(item.quantity),
        }));
        const normalized = (items: Array<{ variantId: string; quantity: number }>) => items
          .map((item) => `${item.variantId}:${item.quantity}`).sort().join("|");
        if (normalized(savedItems) !== normalized(input.items)) {
          return errorResponse("O pedido em aberto mudou. Abra-o novamente antes de continuar.", 409);
        }
        openOrder = { ...savedOrder, items: savedItems };
      }
    } else if (requestedOpenOrderId) {
      return errorResponse("Pedido em aberto exclusivo para franqueados", 403);
    }

    const requestedItems = input.items;
    const requestedVariantIds = requestedItems.map((item) => item.variantId);
    let details: Awaited<ReturnType<typeof fetchVariantCheckoutDetails>>;
    try {
      details = await fetchVariantCheckoutDetails(
        requestedVariantIds,
        storefrontToken,
        shopifyToken,
      );
      if (openOrder) {
        for (const item of openOrder.items) {
          const detail = details.get(item.variantId);
          if (!detail || detail.inventoryTracked === false || detail.quantityAvailable === null) continue;
          // A disponibilidade da Storefront já desconta a reserva deste próprio
          // rascunho. Recolocamos somente a quantidade dele para validá-lo.
          detail.quantityAvailable += item.quantity;
          if (item.quantity > 0) detail.availableForSale = true;
        }
      }
    } catch (error) {
      const inventoryError = error instanceof ShopifyInventoryVerificationError ? error : null;
      const technicalMessage = error instanceof Error ? error.message : String(error);
      await writeCheckoutAttemptLog(admin, {
        checkoutSessionId: null,
        userId: auth.user?.id,
        customerName: input.customer.name,
        customerEmail: input.customer.email,
        paymentMethod: intendedMethod,
        stage: "prepare",
        success: false,
        errorMessage: technicalMessage,
        metadata: {
          failurePoint: "inventory_verification",
          errorCode: inventoryError?.code || "inventory_verification_failed",
          requiredScopes: inventoryError?.requiredScopes ?? [],
          itemCount: requestedItems.length,
        },
      });
      console.error("checkout-prepare inventory verification:", technicalMessage);
      return errorResponse("Loja temporariamente indisponível. Tente novamente em instantes.", 503);
    }
    const unavailableItems: Array<{
      variantId: string;
      productTitle: string;
      reason: "hidden" | "out_of_stock" | "not_found";
    }> = [];

    const productIds = [...new Set(Array.from(details.values()).map((detail) => detail.productId))];
    let audienceRows: Array<{ shopify_product_id: string; audience: string }> = [];
    if (productIds.length) {
      // leitura-limitada: produtos do carrinho
      const audienceResult = await admin.from("product_audience")
        .select("shopify_product_id,audience").in("shopify_product_id", productIds);
      if (audienceResult.error) throw audienceResult.error;
      audienceRows = audienceResult.data ?? [];
    }
    const audienceByProduct = new Map(
      audienceRows.map((row) => [row.shopify_product_id, row.audience]),
    );
    const availableItems = requestedItems.filter((item) => {
      const detail = details.get(item.variantId);
      if (!detail) {
        unavailableItems.push({
          variantId: item.variantId,
          productTitle: "Produto removido",
          reason: "not_found",
        });
        return false;
      }
      const hasInventory = customerType === "franchise"
        ? hasSufficientFranchiseInventory(detail, item.quantity)
        : hasSufficientInventory(detail, item.quantity);
      if (!hasInventory) {
        unavailableItems.push({
          variantId: item.variantId,
          productTitle: detail.productTitle,
          reason: "out_of_stock",
        });
        return false;
      }
      const audience = audienceByProduct.get(detail.productId) ?? null;
      const allowed = customerType === "franchise"
        ? audience === "franquia" || audience === "ambos"
        : audience === "cliente" || audience === "ambos";
      if (!allowed) {
        unavailableItems.push({
          variantId: item.variantId,
          productTitle: detail.productTitle,
          reason: "hidden",
        });
        return false;
      }
      return true;
    });
    if (!availableItems.length) {
      return jsonResponse({
        error: "Todos os produtos desta compra estão indisponíveis.",
        code: "no_available_items",
        unavailableItems,
      }, 409);
    }
    // Daqui em diante, preço, frete, snapshots e pedido usam somente os itens
    // que continuam visíveis para o perfil e possuem estoque suficiente.
    input.items = availableItems;
    const variantIds = availableItems.map((item) => item.variantId);

    // O valor regular definido no sistema tem prioridade sobre a Shopify para
    // todos os perfis. Na ausência dele, o preço atual da Shopify é o fallback.
    // leitura-limitada: variantes do carrinho
    const { data: customerRows } = await admin.from("customer_prices")
      .select("shopify_variant_id,price").in("shopify_variant_id", variantIds);
    const customerPriceMap = new Map<string, number>();
    for (const row of customerRows ?? []) {
      const price = Number(row.price);
      if (Number.isFinite(price) && price > 0) customerPriceMap.set(row.shopify_variant_id, price);
    }

    // Este mapa é enviado à Shopify como desconto sobre o preço nativo. Começa
    // com o valor do cliente e recebe o preço de perfil somente quando menor.
    const specialPriceMap = new Map(customerPriceMap);
    const franchiseCostMap = new Map<string, number>();
    if (customerType === "subscriber") {
      // leitura-limitada: variantes do carrinho
      const { data } = await admin.from("subscriber_prices")
        .select("shopify_variant_id,subscriber_price").in("shopify_variant_id", variantIds);
      for (const row of data ?? []) {
        const price = Number(row.subscriber_price);
        const base = customerPriceMap.get(row.shopify_variant_id) ??
          details.get(row.shopify_variant_id)?.price;
        if (Number.isFinite(price) && price > 0 && (base === undefined || price < base)) {
          specialPriceMap.set(row.shopify_variant_id, price);
        }
      }
    } else if (customerType === "franchise") {
      // leitura-limitada: variantes do carrinho
      const { data } = await admin.from("franchise_prices")
        .select("shopify_variant_id,price").in("shopify_variant_id", variantIds);
      for (const row of data ?? []) {
        const price = Number(row.price);
        const base = customerPriceMap.get(row.shopify_variant_id) ??
          details.get(row.shopify_variant_id)?.price;
        if (Number.isFinite(price) && price > 0 && (base === undefined || price < base)) {
          specialPriceMap.set(row.shopify_variant_id, price);
        }
      }

      // O preco de franquia pode ser igual ou superior ao custo, nunca inferior.
      // Esta barreira fica no servidor para proteger inclusive carrinhos antigos
      // e valores gravados antes da validacao existir no administrativo.
      // leitura-limitada: variantes do carrinho
      const { data: costRows } = await admin.from("product_costs")
        .select("shopify_variant_id,cost").in("shopify_variant_id", variantIds);
      for (const row of costRows ?? []) {
        const cost = Number(row.cost);
        if (!Number.isFinite(cost) || cost <= 0) continue;
        franchiseCostMap.set(row.shopify_variant_id, cost);
        const current = specialPriceMap.get(row.shopify_variant_id) ??
          customerPriceMap.get(row.shopify_variant_id) ??
          details.get(row.shopify_variant_id)?.price;
        if (current === undefined || current < cost) {
          specialPriceMap.set(row.shopify_variant_id, cost);
        }
      }
    }

    const currentPriceMap = new Map(Array.from(details).map(([id, detail]) => [id, detail.price]));

    if (customerType !== "franchise") {
      // leitura-limitada: variantes do carrinho
      const { data: costRows, error: costError } = await admin.from("product_costs")
        .select("shopify_variant_id,cost").in("shopify_variant_id", variantIds);
      if (costError) throw costError;
      const blocked = (costRows ?? []).some((row) => {
        const sale = customerPriceMap.get(row.shopify_variant_id) ??
          currentPriceMap.get(row.shopify_variant_id);
        return sale !== undefined && Number(row.cost) >= sale;
      });
      if (blocked) {
        return errorResponse(
          "Um produto da sacola está indisponível para clientes. Remova-o e tente novamente.",
          409,
        );
      }
    }

    let subtotal = 0;
    let total = 0;
    // Preço efetivamente cobrado por unidade. É o que precisa chegar ao pedido
    // da Shopify, seja como desconto (quando menor) ou como linha de ajuste
    // (quando maior que o preço nativo da variante).
    const finalPriceMap = new Map<string, number>();
    const commissionRules: CommissionRule[] = [];
    const commissionCategories: Array<{ id: string; parent_id: string | null }> = [];
    const categoriesByProduct = new Map<string, string[]>();
    let storeCommissionPercent = 0;
    const commissionEligible = Boolean(referral) && !commissionBlocked;
    if (commissionEligible) {
      const productIds = [
        ...new Set(input.items.map((item) => details.get(item.variantId)!.productId)),
      ];
      const [rulesResult, linksResult, categoriesResult, settingsResult] = await Promise.all([
        fetchAllRowsResult<CommissionRule>(admin, "commission_rules", "id,scope,category_id,shopify_product_id,percent", {
          orderBy: "id",
        }),
        // leitura-limitada: categorias dos produtos do carrinho
        admin.from("product_categories").select("shopify_product_id,category_id").in(
          "shopify_product_id",
          productIds,
        ),
        // Arvore inteira: um `.limit(1000)` aqui seria o mesmo corte silencioso.
        fetchAllRowsResult<{ id: string; parent_id: string | null }>(admin, "categories", "id,parent_id", { orderBy: "id" }),
        admin.from("commission_settings").select("store_percent").eq("id", true).maybeSingle(),
      ]);
      if (rulesResult.error) throw rulesResult.error;
      if (linksResult.error) throw linksResult.error;
      if (categoriesResult.error) throw categoriesResult.error;
      if (settingsResult.error) throw settingsResult.error;
      if (categoriesResult.data?.length === 1000) {
        throw new Error("Limite de categorias para comissões atingido");
      }
      commissionRules.push(...(rulesResult.data as CommissionRule[] || []));
      commissionCategories.push(...(categoriesResult.data || []));
      storeCommissionPercent = Number(settingsResult.data?.store_percent) || 0;
      for (const link of linksResult.data || []) {
        const assigned = categoriesByProduct.get(link.shopify_product_id) || [];
        assigned.push(link.category_id);
        categoriesByProduct.set(link.shopify_product_id, assigned);
      }
    }
    const itemsSnapshot = input.items.map((item) => {
      const detail = details.get(item.variantId)!;
      const catalogPrice = customerPriceMap.get(item.variantId) ?? detail.price;
      const resolvedPrice = resolveUnitPrice(catalogPrice, specialPriceMap.get(item.variantId))!;
      const costFloor = customerType === "franchise"
        ? franchiseCostMap.get(item.variantId)
        : undefined;
      const unitPrice = applyCostFloor(resolvedPrice, costFloor)!;
      finalPriceMap.set(item.variantId, unitPrice);
      // O piso de custo da franquia pode deixar o valor final acima do preço do
      // catálogo. Nesse caso a referência do subtotal é o próprio valor final:
      // o desconto representa só economia real e nunca fica negativo.
      subtotal += Math.max(catalogPrice, unitPrice) * item.quantity;
      total += unitPrice * item.quantity;
      const lineTotal = money(unitPrice * item.quantity);
      const appliedRule = commissionEligible
        ? selectCommissionRule(
          detail.productId,
          categoriesByProduct.get(detail.productId) || [],
          commissionCategories,
          commissionRules,
          storeCommissionPercent,
        )
        : null;
      return {
        variantId: item.variantId,
        productId: detail.productId,
        numericVariantId: detail.numericId,
        productTitle: detail.productTitle,
        variantTitle: detail.title,
        sku: detail.sku,
        imageUrl: detail.imageUrl,
        quantity: item.quantity,
        catalogUnitPrice: money(catalogPrice),
        unitPrice: money(unitPrice),
        ...(customerType === "franchise" && costFloor !== undefined
          ? { costUnitPrice: money(costFloor) }
          : {}),
        lineTotal,
        ...(appliedRule
          ? {
            commissionPercent: appliedRule.percent,
            commissionScope: appliedRule.scope,
            commissionRuleId: appliedRule.ruleId,
            commissionCategoryId: appliedRule.categoryId,
            commissionAmount: commissionForLine(lineTotal, appliedRule.percent),
          }
          : {}),
      };
    });
    subtotal = money(subtotal);
    total = money(total);
    const discount = money(subtotal - total);

    let shippingAmount = 0;
    let shippingMethod = shippingLabel(input.delivery.code);
    let shippingCode: "pick_up" | "pac" | "sedex" | "local_delivery" | "shipping" =
      input.delivery.code;
    let shippingRateHandle: string | undefined;
    let pickupLocation: {
      name: string;
      address: string | null;
      hours: string;
      instructions: string | null;
    } | undefined;
    if (input.delivery.code === "pick_up") {
      const pickupOptions = await fetchShopifyDraftPickupOptions({
        items: input.items,
        customerName: input.customer.name,
        email: input.customer.email,
        phone: input.customer.mobilePhone,
        address: input.billingAddress!,
      }, shopifyToken);
      const selectedPickup = input.delivery.optionHandle
        ? pickupOptions.find((option) => option.handle === input.delivery.optionHandle)
        : pickupOptions[0];
      if (!selectedPickup) {
        return errorResponse(
          "A retirada na loja está indisponível no momento. Tente novamente em instantes.",
          409,
        );
      }
      shippingMethod = selectedPickup.title;
      shippingRateHandle = selectedPickup.handle;
      pickupLocation = {
        name: selectedPickup.locationName || selectedPickup.title,
        address: selectedPickup.address,
        hours: PICKUP_HOURS,
        instructions: selectedPickup.instructions,
      };
    } else if (input.delivery.address) {
      const providerOptions = await fetchShopifyDraftDeliveryOptions({
        items: input.items,
        customerName: input.customer.name,
        phone: input.customer.mobilePhone,
        address: input.delivery.address,
      }, shopifyToken);
      const options = applyDeliveryPolicy(input.delivery.address, providerOptions);
      const selected = options.find((option) => option.handle === input.delivery.optionHandle);
      if (!selected) return errorResponse("A modalidade de frete expirou. Calcule novamente.", 409);
      shippingAmount = money(selected.amount);
      shippingMethod = selected.title;
      const normalized = `${selected.code || ""} ${selected.title}`.toLowerCase();
      shippingCode = normalized.includes("sedex")
        ? "sedex"
        : normalized.includes("pac")
        ? "pac"
        : normalized.includes("moto") || normalized.includes("local")
        ? "local_delivery"
        : "shipping";
      total = money(total + shippingAmount);
    }
    const serviceFee = checkoutServiceFee(customerType);
    total = money(total + serviceFee);
    // Barra antes de existir sessão e rascunho. O Asaas recusa cobrança abaixo
    // do piso de qualquer jeito; sem esta guarda o pedido chegava a nascer na
    // Shopify para só então falhar no pagamento, e o rascunho ficava pendurado.
    // O total já inclui o frete, que é a última parcela capaz de cruzar o piso.
    if (total < MIN_CHARGE_VALUE) {
      return errorResponse(belowMinimumChargeMessage(total), 422);
    }
    if (customerType === "franchise" && auth.user) {
      dedupFingerprint = await franchiseOrderFingerprint(
        auth.user.id,
        input.items,
        shippingCode,
        input.invoicePurpose || "",
      );
      // Reaproveita a trava atomica que ja existe em producao. A chave inclui
      // finalidade fiscal, entao Revenda e Consumo final nao se bloqueiam.
      const { error: claimError } = await admin.rpc("consume_checkout_rate_limit", {
        p_key_hash: dedupFingerprint,
        p_limit: 1,
        p_window_seconds: 60 * 60,
      });
      if (claimError) {
        if (claimError.message?.includes("checkout_rate_limit_exceeded")) {
          return errorResponse(
            "Este mesmo pedido já está sendo processado ou foi enviado há menos de 1 hora.",
            409,
          );
        }
        throw claimError;
      }
    }
    const accessToken = newCheckoutAccessToken();
    const accessTokenHash = await hashCheckoutAccessToken(accessToken);
    const tokenExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const inventoryReservedUntil = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    const { data: session, error: sessionError } = await admin.from("checkout_sessions").insert({
      user_id: auth.user?.id ?? null,
      customer_type: customerType,
      status: "awaiting_payment",
      subtotal,
      discount,
      service_fee: serviceFee,
      shipping_amount: shippingAmount,
      total,
      shipping_method: shippingMethod,
      shipping_code: shippingCode,
      customer_snapshot: customerType === "franchise"
        ? {
          ...input.customer,
          ...fiscalIdentity!,
        }
        : input.customer,
      address_snapshot: input.delivery.address ?? {},
      billing_address_snapshot: input.billingAddress ?? input.delivery.address ?? {},
      items_snapshot: itemsSnapshot,
      invoice_purpose: customerType === "franchise" ? input.invoicePurpose : null,
      franchise_payment_term_days: customerType === "franchise" ? franchisePaymentTermDays : null,
      franchise_payment_schedule_type: customerType === "franchise" ? franchisePaymentScheduleType : null,
      franchise_payment_due_day: customerType === "franchise" ? franchisePaymentDueDay : null,
      referral_code: referral?.code ?? null,
      referral_employee_name: referral?.employee_name ?? null,
      commission_percent: commissionEligible ? storeCommissionPercent : 0,
      pricing_snapshot: {
        customerType,
        serviceFee,
        ...(customerType === "franchise"
          ? {
            invoicePurpose: input.invoicePurpose,
            paymentTermDays: franchisePaymentTermDays,
            paymentScheduleType: franchisePaymentScheduleType,
            paymentDueDay: franchisePaymentDueDay,
          }
          : {}),
        calculatedAt: new Date().toISOString(),
        ...(pickupLocation ? { pickupLocation } : {}),
      },
      anonymous_access_token_hash: accessTokenHash,
      anonymous_access_token_expires_at: tokenExpiresAt,
      inventory_reserved_until: inventoryReservedUntil,
      session_expires_at: sessionExpiresAt,
    }).select("id").single();
    if (sessionError) throw sessionError;

    const discountTitle = customerType === "franchise"
      ? "Franquia TudoPraPet"
      : customerType === "subscriber"
      ? "Clube TudoPraPet"
      : "TudoPraPet";
    void discountTitle;
    // Preço final (e a taxa da franquia, rateada) vai dentro de cada produto.
    const priced = buildPricedDraftLineItems(input.items, finalPriceMap, serviceFee);
    const lineItems = priced.lines;
    const serviceFeeLine = buildServiceFeeLine(priced.residualFee);
    if (serviceFeeLine) lineItems.push(serviceFeeLine);

    // Mesmo nome/documento do customer_snapshot em todos os destinos.
    const draftCustomerName = fiscalIdentity ? fiscalIdentity.name : input.customer.name;
    const draftCpfCnpj = fiscalIdentity ? fiscalIdentity.cpfCnpj : input.customer.cpfCnpj;
    const draft = await createFiscalDraftOrder({
      ...(openOrder ? { draftOrderId: openOrder.shopify_draft_order_id } : {}),
      lineItems,
      email: input.customer.email,
      customerName: draftCustomerName,
      phone: input.customer.mobilePhone,
      cpfCnpj: draftCpfCnpj,
      shippingLine: {
        ...buildShippingLine(shippingMethod, shippingAmount),
        shippingRateHandle,
      },
      // A Shopify precisa dos dois snapshots no pedido. Em retirada, o endereco
      // cadastrado de cobranca tambem identifica o cliente/destinatario; quem
      // define PICK_UP e o handle nativo da shippingLine, nao a ausencia de CEP.
      shippingAddress: (input.delivery.address || input.billingAddress)
        ? shopifyAddress(
          input.delivery.address || input.billingAddress!,
          draftCustomerName,
          input.customer.mobilePhone,
          draftCpfCnpj,
        )
        : undefined,
      billingAddress: (input.billingAddress || input.delivery.address)
        ? shopifyAddress(
          input.billingAddress || input.delivery.address!,
          draftCustomerName,
          input.customer.mobilePhone,
          draftCpfCnpj,
        )
        : undefined,
      tags: [
        "checkout-proprio",
        customerType === "franchise" ? "olist" : "asaas",
        customerType,
        ...(customerType === "franchise" ? [] : externalPaymentTags(intendedMethod)),
        ...(customerType === "franchise" && input.invoicePurpose
          ? [`nfe-${input.invoicePurpose === "resale" ? "revenda" : "consumo-final"}`]
          : []),
        ...(shippingCode === "pick_up" ? ["retirada", "pick_up"] : []),
        ...(referral ? [`indicacao:${referral.code}`] : []),
      ],
      note: `Checkout TudoPraPet ${session.id}`,
      customAttributes: [
        { key: "checkout_session_id", value: session.id },
        ...(customerType === "franchise" ? [] : externalPaymentAttributes(intendedMethod)),
        ...(customerType === "franchise" && input.invoicePurpose
          ? [
            { key: "finalidade_nfe", value: input.invoicePurpose },
            { key: "prazo_pagamento_dias", value: String(franchisePaymentTermDays) },
            { key: "modalidade_vencimento", value: franchisePaymentScheduleType },
            ...(franchisePaymentDueDay
              ? [{ key: "dia_fixo_vencimento", value: String(franchisePaymentDueDay) }]
              : []),
          ]
          : []),
        ...(referral ? [{ key: "codigo_indicacao", value: referral.code }] : []),
        { key: "shipping_code", value: shippingCode },
        { key: "delivery_method_type", value: shippingCode === "pick_up" ? "pick_up" : "shipping" },
        {
          key: "shipping_option_handle",
          value: shippingRateHandle || input.delivery.optionHandle || shippingCode,
        },
      ],
      reserveInventoryUntil: inventoryReservedUntil,
      // Produtos com estoque sem rastreamento nao geram reserva na Shopify;
      // exigir confirmacao neles descartava o rascunho e travava a compra.
      requireInventoryReservation: input.items.some(
        (item) => details.get(item.variantId)?.inventoryTracked !== false,
      ),
    }, shopifyToken);
    if (!draft.draftOrderId) {
      await admin.from("checkout_sessions").update({ status: "failed" }).eq("id", session.id);
      const userErrors = draft.userErrors ?? [];
      console.error(`Shopify nao devolveu rascunho para o checkout ${session.id}:`, draft.error);
      await writeCheckoutAttemptLog(admin, {
        checkoutSessionId: session.id,
        userId: auth.user?.id,
        customerName: input.customer.name,
        customerEmail: input.customer.email,
        paymentMethod: intendedMethod,
        stage: "prepare",
        success: false,
        errorMessage: draft.error || "Shopify nao devolveu o identificador do rascunho.",
        metadata: {
          customerType,
          delivery: shippingCode,
          failurePoint: "draft_creation",
          itemCount: input.items.length,
          hasPriceAdjustment: Boolean(adjustmentLine),
          // Campo exato recusado pela Shopify e quantas tentativas foram feitas.
          shopifyUserErrors: userErrors,
          rejectedFields: userErrors.map((error) => error.field).filter(Boolean),
          shopifyAttempts: draft.attempts ?? 1,
        },
      });
      if (dedupFingerprint) {
        await admin.from("checkout_rate_limits").delete().eq("key_hash", dedupFingerprint);
        dedupFingerprint = null;
      }
      return errorResponse(customerFacingDraftError(userErrors, draft.error), 502);
    }

    // Grave o vinculo imediatamente. Mesmo que a credencial fiscal seja
    // rejeitada, o rascunho continua rastreavel para diagnostico/recuperacao.
    const { error: draftUpdateError } = await admin.from("checkout_sessions")
      .update({ shopify_draft_order_id: draft.draftOrderId })
      .eq("id", session.id);
    if (draftUpdateError) throw draftUpdateError;

    // O CPF/CNPJ tambem fica nos atributos do draft. A extensao fiscal oficial
    // e tentada, mas uma rejeicao inconsistente da Shopify nao bloqueia o Asaas.
    if (!draft.requestOk) {
      await admin.from("checkout_sessions").update({ status: "failed" }).eq("id", session.id);
      console.error(`Rascunho rejeitado no checkout ${session.id}:`, draft.error);
      await writeCheckoutAttemptLog(admin, {
        checkoutSessionId: session.id,
        userId: auth.user?.id,
        customerName: input.customer.name,
        customerEmail: input.customer.email,
        paymentMethod: intendedMethod,
        stage: "prepare",
        success: false,
        errorMessage: draft.error || "Shopify nao criou o rascunho.",
        metadata: {
          customerType,
          delivery: shippingCode,
          failurePoint: "draft_validation",
          itemCount: input.items.length,
          hasPriceAdjustment: Boolean(adjustmentLine),
          shopifyUserErrors: draft.userErrors ?? [],
          rejectedFields: (draft.userErrors ?? []).map((error) => error.field).filter(Boolean),
          shopifyAttempts: draft.attempts ?? 1,
        },
      });
      if (dedupFingerprint) {
        await admin.from("checkout_rate_limits").delete().eq("key_hash", dedupFingerprint);
        dedupFingerprint = null;
      }
      return errorResponse(customerFacingDraftError(draft.userErrors ?? [], draft.error), 502);
    }
    keepDedupLock = Boolean(dedupFingerprint);
    if (!draft.taxCredentialStored) {
      console.warn(
        `Checkout ${session.id}: CPF/CNPJ salvo nos atributos; extensao fiscal nao persistiu.`,
        draft.error,
      );
    }
    if (openOrder) {
      const { error: openOrderError } = await admin.from("franchise_open_orders").update({
        status: "converted",
        checkout_session_id: session.id,
        reserved_until: inventoryReservedUntil,
        updated_at: new Date().toISOString(),
      }).eq("id", openOrder.id).eq("status", "open");
      if (openOrderError) throw openOrderError;
    }
    await writeCheckoutAttemptLog(admin, {
      checkoutSessionId: session.id,
      userId: auth.user?.id,
      customerName: input.customer.name,
      customerEmail: input.customer.email,
      paymentMethod: intendedMethod,
      stage: "prepare",
      success: true,
      errorMessage: draft.taxCredentialStored ? null : draft.error,
      metadata: {
        customerType,
        delivery: shippingCode,
        taxCredentialStored: draft.taxCredentialStored,
        total,
      },
    });
    return jsonResponse({
      sessionId: session.id,
      accessToken,
      customerType,
      status: "awaiting_payment",
      unavailableItems,
      summary: {
        subtotal,
        discount,
        serviceFee,
        shippingAmount,
        total,
        shippingMethod,
        shippingCode,
        items: itemsSnapshot,
        pickupLocation,
        ...(customerType === "franchise"
          ? {
            invoicePurpose: input.invoicePurpose,
            paymentTermDays: franchisePaymentTermDays,
            paymentScheduleType: franchisePaymentScheduleType,
            paymentDueDay: franchisePaymentDueDay,
          }
          : {}),
      },
    });
  } catch (error) {
    if (dedupAdmin && dedupFingerprint && !keepDedupLock) {
      const { error: releaseError } = await dedupAdmin.from("checkout_rate_limits")
        .delete()
        .eq("key_hash", dedupFingerprint);
      if (releaseError) console.error("Falha ao liberar trava de pedido duplicado:", releaseError);
    }
    console.error("checkout-prepare:", error);
    return errorResponse("Não foi possível preparar o checkout", 500);
  }
});
