// force redeploy 2026-08-17
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { optionalCheckoutUser, newCheckoutAccessToken, hashCheckoutAccessToken } from "../_shared/checkout-access.ts";
import { parseCheckoutPrepareInput, shippingLabel, type CheckoutAddressInput } from "../_shared/checkout-input.ts";
import {
  buildDraftLineItems,
  buildShippingLine,
  CHECKOUT_SERVICE_FEE,
} from "../_shared/pricing.ts";
import {
  createFiscalDraftOrder,
  fetchShopifyDraftDeliveryOptions,
  fetchShopifyDraftPickupOptions,
  fetchVariantCheckoutDetails,
} from "../_shared/shopify.ts";
import { applyDeliveryPolicy } from "../_shared/shipping-policy.ts";
import { writeCheckoutAttemptLog } from "../_shared/checkout-log.ts";
import { PICKUP_HOURS } from "../_shared/pickup.ts";

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

function shopifyAddress(address: CheckoutAddressInput, customerName: string, phone: string) {
  const names = customerName.trim().split(/\s+/);
  const firstName = names.shift() || "Cliente";
  return {
    first_name: firstName,
    last_name: names.join(" ") || firstName,
    address1: `${address.address1}, ${address.number}`,
    address2: [address.address2, address.neighborhood].filter(Boolean).join(" - ") || undefined,
    city: address.city,
    province_code: address.provinceCode,
    zip: address.postalCode,
    country_code: "BR",
    phone: `+55${phone}`,
  };
}

async function requestKey(req: Request, userId: string | null): Promise<string> {
  const forwarded = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const source = userId ? `user:${userId}` : `ip:${forwarded.trim()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);

  try {
    const auth = await optionalCheckoutUser(req);
    if (auth.invalidAuthorization) return errorResponse("Sessão inválida", 401);

    const rawBody = await req.json() as Record<string, unknown>;
    const intendedMethod = rawBody.paymentMethod === "credit_card" ? "credit_card"
      : rawBody.paymentMethod === "pix" ? "pix" : "unknown";
    const parsed = parseCheckoutPrepareInput(rawBody);
    if (!parsed.ok) return errorResponse(parsed.message, 400);
    const input = parsed.value;

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
    const storefrontToken = readFirstEnv(["SHOPIFY_STOREFRONT_ACCESS_TOKEN", "SHOPIFY_STOREFRONT_TOKEN"]);
    const shopifyToken = readFirstEnv([
      "SHOPIFY_ACCESS_TOKEN",
      "SHOPIFY_ONLINE_ACCESS_TOKEN:user:4HrJkQRl3KUXTrTOAgUkwQSkHWo2",
    ]);
    if (!storefrontToken || !shopifyToken) return errorResponse("Shopify não configurada", 500);

    let customerType: "common" | "subscriber" | "franchise" = "common";
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
      const { data: credit } = await admin.from("franchise_credit_accounts")
        .select("manually_blocked,blocked_reason,block_on_any_open_invoice")
        .eq("user_id", auth.user!.id).maybeSingle();
      if (credit?.manually_blocked) {
        return jsonResponse({ error: credit.blocked_reason || "Franquia bloqueada para novos pedidos" }, 403);
      }
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
        if ((count ?? 0) > 0) return jsonResponse({ error: "Existe uma cobrança pendente que bloqueia novos pedidos" }, 403);
      }
    }

    const variantIds = input.items.map((item) => item.variantId);
    const details = await fetchVariantCheckoutDetails(variantIds, storefrontToken);
    if (details.size !== new Set(variantIds).size) return errorResponse("Um produto não foi encontrado", 409);

    for (const item of input.items) {
      const detail = details.get(item.variantId)!;
      if (!detail.availableForSale || (detail.quantityAvailable !== null && detail.quantityAvailable < item.quantity)) {
        return jsonResponse({ error: `${detail.productTitle} não possui estoque suficiente` }, 409);
      }
    }

    const productIds = [...new Set(Array.from(details.values()).map((detail) => detail.productId))];
    const { data: audienceRows, error: audienceError } = await admin.from("product_audience")
      .select("shopify_product_id,audience").in("shopify_product_id", productIds);
    if (audienceError) throw audienceError;
    const audienceByProduct = new Map((audienceRows ?? []).map((row) => [row.shopify_product_id, row.audience]));
    for (const detail of details.values()) {
      const audience = audienceByProduct.get(detail.productId) ?? null;
      const allowed = customerType === "franchise"
        ? audience === "franquia" || audience === "ambos"
        : audience === "cliente" || audience === "ambos";
      if (!allowed) return errorResponse(`${detail.productTitle} não está disponível para este perfil`, 403);
    }

    const specialPriceMap = new Map<string, number>();
    if (customerType === "subscriber") {
      const { data } = await admin.from("subscriber_prices")
        .select("shopify_variant_id,subscriber_price").in("shopify_variant_id", variantIds);
      for (const row of data ?? []) specialPriceMap.set(row.shopify_variant_id, Number(row.subscriber_price));
    } else if (customerType === "franchise") {
      const { data } = await admin.from("franchise_prices")
        .select("shopify_variant_id,price").in("shopify_variant_id", variantIds);
      for (const row of data ?? []) specialPriceMap.set(row.shopify_variant_id, Number(row.price));
    }

    const currentPriceMap = new Map(Array.from(details).map(([id, detail]) => [id, detail.price]));
    let subtotal = 0;
    let total = 0;
    const itemsSnapshot = input.items.map((item) => {
      const detail = details.get(item.variantId)!;
      const special = specialPriceMap.get(item.variantId);
      const unitPrice = special !== undefined && special >= 0 && special < detail.price ? special : detail.price;
      subtotal += detail.price * item.quantity;
      total += unitPrice * item.quantity;
      return {
        variantId: item.variantId,
        productId: detail.productId,
        numericVariantId: detail.numericId,
        productTitle: detail.productTitle,
        variantTitle: detail.title,
        imageUrl: detail.imageUrl,
        quantity: item.quantity,
        catalogUnitPrice: money(detail.price),
        unitPrice: money(unitPrice),
        lineTotal: money(unitPrice * item.quantity),
      };
    });
    subtotal = money(subtotal);
    total = money(total);
    const discount = money(subtotal - total);

    let shippingAmount = 0;
    let shippingMethod = shippingLabel(input.delivery.code);
    let shippingCode: "pick_up" | "pac" | "sedex" | "local_delivery" | "shipping" = input.delivery.code;
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
        return errorResponse("A retirada na loja está indisponível na Shopify. Verifique o local e o estoque.", 409);
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
      shippingCode = normalized.includes("sedex") ? "sedex"
        : normalized.includes("pac") ? "pac"
        : normalized.includes("moto") || normalized.includes("local") ? "local_delivery"
        : "shipping";
      total = money(total + shippingAmount);
    }
    const accessToken = newCheckoutAccessToken();
    const accessTokenHash = await hashCheckoutAccessToken(accessToken);
    const tokenExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { data: session, error: sessionError } = await admin.from("checkout_sessions").insert({
      user_id: auth.user?.id ?? null,
      customer_type: customerType,
      status: "awaiting_payment",
      subtotal,
      discount,
      service_fee: CHECKOUT_SERVICE_FEE,
      shipping_amount: shippingAmount,
      total,
      shipping_method: shippingMethod,
      shipping_code: shippingCode,
      customer_snapshot: input.customer,
      address_snapshot: input.delivery.address ?? {},
      billing_address_snapshot: input.billingAddress ?? input.delivery.address ?? {},
      items_snapshot: itemsSnapshot,
      pricing_snapshot: {
        customerType,
        serviceFee: CHECKOUT_SERVICE_FEE,
        calculatedAt: new Date().toISOString(),
        ...(pickupLocation ? { pickupLocation } : {}),
      },
      anonymous_access_token_hash: accessTokenHash,
      anonymous_access_token_expires_at: tokenExpiresAt,
      session_expires_at: sessionExpiresAt,
    }).select("id").single();
    if (sessionError) throw sessionError;

    const discountTitle = customerType === "franchise"
      ? "Franquia TudoPraPet"
      : customerType === "subscriber" ? "Clube TudoPraPet" : "TudoPraPet";
    const lineItems = buildDraftLineItems(input.items, specialPriceMap, currentPriceMap, discountTitle);

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
        ? shopifyAddress(input.delivery.address || input.billingAddress!, input.customer.name, input.customer.mobilePhone)
        : undefined,
      billingAddress: (input.billingAddress || input.delivery.address)
        ? shopifyAddress(input.billingAddress || input.delivery.address!, input.customer.name, input.customer.mobilePhone)
        : undefined,
      tags: [
        "checkout-proprio",
        "asaas",
        customerType,
        ...(shippingCode === "pick_up" ? ["retirada", "pick_up"] : []),
      ],
      note: `Checkout TudoPraPet ${session.id}`,
      customAttributes: [
        { key: "checkout_session_id", value: session.id },
        { key: "shipping_code", value: shippingCode },
        { key: "delivery_method_type", value: shippingCode === "pick_up" ? "pick_up" : "shipping" },
        { key: "shipping_option_handle", value: shippingRateHandle || input.delivery.optionHandle || shippingCode },
      ],
    }, shopifyToken);
    if (!draft.draftOrderId) {
      await admin.from("checkout_sessions").update({ status: "failed" }).eq("id", session.id);
      console.error(`Shopify nao devolveu rascunho para o checkout ${session.id}:`, draft.error);
      return errorResponse(
        draft.error || "Falha ao preparar pedido na Shopify",
        502,
      );
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
        metadata: { customerType, delivery: shippingCode },
      });
      return errorResponse("Não foi possível preparar o pedido na Shopify. Tente novamente.", 502);
    }
    if (!draft.taxCredentialStored) {
      console.warn(`Checkout ${session.id}: CPF/CNPJ salvo nos atributos; extensao fiscal nao persistiu.`, draft.error);
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
      summary: {
        subtotal,
        discount,
        serviceFee: CHECKOUT_SERVICE_FEE,
        shippingAmount,
        total,
        shippingMethod,
        shippingCode,
        items: itemsSnapshot,
        pickupLocation,
      },
    });
  } catch (error) {
    console.error("checkout-prepare:", error);
    return errorResponse("Não foi possível preparar o checkout", 500);
  }
});
