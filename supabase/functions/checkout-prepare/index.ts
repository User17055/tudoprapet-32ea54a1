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
  buildDraftLineItems,
  buildPriceAdjustmentLine,
  buildServiceFeeLine,
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
import { hasSufficientInventory } from "../_shared/inventory.ts";
import {
  commissionForLine,
  type CommissionRule,
  selectCommissionRule,
} from "../_shared/commission.ts";

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

  try {
    const auth = await optionalCheckoutUser(req);
    if (auth.invalidAuthorization) return errorResponse("Sessão inválida", 401);

    const rawBody = await req.json() as Record<string, unknown>;
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
    let franchisePaymentTermDays: 7 | 30 = 7;
    if (auth.user) {
      const [{ data: profile }, { data: clubMember }] = await Promise.all([
        admin.from("profiles").select("is_franchisee").eq("user_id", auth.user.id).maybeSingle(),
        admin.from("club_members").select("is_active")
          .eq("email", (auth.user.email || input.customer.email).toLowerCase())
          .eq("is_active", true).maybeSingle(),
      ]);
      if (profile?.is_franchisee) customerType = "franchise";
      else if (clubMember?.is_active) customerType = "subscriber";
    }

    if (customerType === "franchise") {
      if (!input.invoicePurpose) {
        return errorResponse("Escolha se a nota fiscal será para revenda ou consumo final", 400);
      }
      const { data: credit } = await admin.from("franchise_credit_accounts")
        .select("manually_blocked,blocked_reason,block_on_any_open_invoice,payment_term_days")
        .eq("user_id", auth.user!.id).maybeSingle();
      if (credit?.manually_blocked) {
        return jsonResponse({
          error: credit.blocked_reason || "Franquia bloqueada para novos pedidos",
        }, 403);
      }
      franchisePaymentTermDays = Number(credit?.payment_term_days) === 30 ? 30 : 7;
      const { data: financialSessions } = await admin.from("checkout_sessions")
        .select("id").eq("user_id", auth.user!.id).eq("customer_type", "franchise");
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
      if (!hasSufficientInventory(detail, item.quantity)) {
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
        admin.from("commission_rules").select("id,scope,category_id,shopify_product_id,percent"),
        admin.from("product_categories").select("shopify_product_id,category_id").in(
          "shopify_product_id",
          productIds,
        ),
        admin.from("categories").select("id,parent_id").limit(1000),
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
      subtotal += catalogPrice * item.quantity;
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
      customer_snapshot: input.customer,
      address_snapshot: input.delivery.address ?? {},
      billing_address_snapshot: input.billingAddress ?? input.delivery.address ?? {},
      items_snapshot: itemsSnapshot,
      invoice_purpose: customerType === "franchise" ? input.invoicePurpose : null,
      franchise_payment_term_days: customerType === "franchise" ? franchisePaymentTermDays : null,
      referral_code: referral?.code ?? null,
      referral_employee_name: referral?.employee_name ?? null,
      commission_percent: commissionEligible ? storeCommissionPercent : 0,
      pricing_snapshot: {
        customerType,
        serviceFee,
        ...(customerType === "franchise"
          ? { invoicePurpose: input.invoicePurpose, paymentTermDays: franchisePaymentTermDays }
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
    const lineItems = buildDraftLineItems(
      input.items,
      finalPriceMap,
      currentPriceMap,
      discountTitle,
    );
    // Sem checagem de variante sem preço aqui, ao contrário de _shared/checkout.ts:
    // input.items já foi reduzido a availableItems (linha 186), e todo item que
    // sobrou tem detail -- logo, tem entrada em currentPriceMap. Quem não tinha
    // saiu antes, como "Produto removido".
    const adjustmentLine = buildPriceAdjustmentLine(input.items, finalPriceMap, currentPriceMap);
    if (adjustmentLine) lineItems.push(adjustmentLine);
    const serviceFeeLine = buildServiceFeeLine(serviceFee);
    if (serviceFeeLine) lineItems.push(serviceFeeLine);

    const draft = await createFiscalDraftOrder({
      lineItems,
      email: input.customer.email,
      customerName: input.customer.name,
      phone: input.customer.mobilePhone,
      cpfCnpj: input.customer.cpfCnpj,
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
          input.customer.name,
          input.customer.mobilePhone,
          input.customer.cpfCnpj,
        )
        : undefined,
      billingAddress: (input.billingAddress || input.delivery.address)
        ? shopifyAddress(
          input.billingAddress || input.delivery.address!,
          input.customer.name,
          input.customer.mobilePhone,
          input.customer.cpfCnpj,
        )
        : undefined,
      tags: [
        "checkout-proprio",
        customerType === "franchise" ? "olist" : "asaas",
        customerType,
        ...(customerType === "franchise" && input.invoicePurpose
          ? [`nfe-${input.invoicePurpose === "resale" ? "revenda" : "consumo-final"}`]
          : []),
        ...(shippingCode === "pick_up" ? ["retirada", "pick_up"] : []),
        ...(referral ? [`indicacao:${referral.code}`] : []),
      ],
      note: `Checkout TudoPraPet ${session.id}`,
      customAttributes: [
        { key: "checkout_session_id", value: session.id },
        ...(customerType === "franchise" && input.invoicePurpose
          ? [
            { key: "finalidade_nfe", value: input.invoicePurpose },
            { key: "prazo_pagamento_dias", value: String(franchisePaymentTermDays) },
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
      return errorResponse(customerFacingDraftError(draft.userErrors ?? [], draft.error), 502);
    }
    if (!draft.taxCredentialStored) {
      console.warn(
        `Checkout ${session.id}: CPF/CNPJ salvo nos atributos; extensao fiscal nao persistiu.`,
        draft.error,
      );
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
          ? { invoicePurpose: input.invoicePurpose, paymentTermDays: franchisePaymentTermDays }
          : {}),
      },
    });
  } catch (error) {
    console.error("checkout-prepare:", error);
    return errorResponse("Não foi possível preparar o checkout", 500);
  }
});
