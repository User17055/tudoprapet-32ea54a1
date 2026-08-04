import { corsHeadersWith } from "../_shared/cors.ts";
import {
  buildIdempotencyKey,
  classifyWebhookEvent,
  extractPickupCode,
  isPickupMethod,
  normalizePhone,
  PICKUP_HOURS,
  STORE_NAME,
} from "../_shared/pickup.ts";
import { savePickupCodeOnOrder } from "../_shared/shopify.ts";
import { decideHmac, resolveHmacMode, verifyShopifyHmac } from "../_shared/webhook.ts";

const corsHeaders = corsHeadersWith(
  "x-shopify-hmac-sha256",
  "x-shopify-topic",
  "x-shopify-shop-domain",
);

// verifyShopifyHmac, resolveHmacMode e decideHmac vivem em ../_shared/webhook.ts

/**
 * Descobre o método de entrega do pedido: "pick_up", outro valor, ou null
 * quando não foi possível determinar.
 *
 * Preferimos o que já veio no payload; só consultamos a Admin API quando o
 * tópico não traz essa informação (fulfillments/* não trazem).
 */
interface FulfillmentOrderLike {
  delivery_method?: { method_type?: string };
}

async function resolveDeliveryMethodType(
  payloadFulfillmentOrder: FulfillmentOrderLike,
  orderId: string,
  shopDomain: string | null,
): Promise<string | null> {
  const fromPayload = payloadFulfillmentOrder?.delivery_method?.method_type;
  if (fromPayload) return String(fromPayload);

  const adminToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  if (!shopDomain || !adminToken || !orderId) return null;

  try {
    const resp = await fetch(
      `https://${shopDomain}/admin/api/2025-07/orders/${orderId}/fulfillment_orders.json`,
      { headers: { "X-Shopify-Access-Token": adminToken } },
    );
    if (!resp.ok) {
      console.error(`Failed to fetch fulfillment_orders for order ${orderId}: ${resp.status}`);
      return null;
    }
    const { fulfillment_orders } = await resp.json() as {
      fulfillment_orders?: FulfillmentOrderLike[];
    };
    const methods = (fulfillment_orders ?? [])
      .map((f) => f?.delivery_method?.method_type)
      .filter((m): m is string => !!m);
    if (methods.length === 0) return null;
    // Se qualquer parte do pedido é retirada, tratamos o pedido como retirada.
    return methods.find(isPickupMethod) ?? methods[0];
  } catch (e) {
    console.error("fulfillment_orders fetch failed:", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const rawBody = await req.text();
    const topic = req.headers.get("x-shopify-topic") || "";
    const hmac = req.headers.get("x-shopify-hmac-sha256");
    const shopDomain = req.headers.get("x-shopify-shop-domain");
    const webhookSecret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET");

    // Autenticação do webhook. Em modo `monitor` (padrão) o resultado é apenas
    // registrado; em `enforce` a assinatura inválida é rejeitada.
    // Ver SHOPIFY_WEBHOOK_HMAC_MODE em ../_shared/webhook.ts.
    const hmacMode = resolveHmacMode(Deno.env.get("SHOPIFY_WEBHOOK_HMAC_MODE"));
    const signatureValid = webhookSecret
      ? await verifyShopifyHmac(rawBody, hmac, webhookSecret)
      : null;
    const decision = decideHmac({
      mode: hmacMode,
      secretConfigured: !!webhookSecret,
      signatureValid,
    });

    // Linha estável para grep nos logs antes de ligar o enforce.
    console.log(
      `HMAC_CHECK mode=${hmacMode} result=${decision.reason} action=${decision.action} topic=${topic} shop=${shopDomain ?? "-"}`,
    );

    if (decision.action === "reject") {
      return new Response(JSON.stringify({ error: "assinatura invalida", reason: decision.reason }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.parse(rawBody);
    // Normalize: some fulfillment_orders topics wrap data in `fulfillment_order`
    // or send `line_items_by_fulfillment_order: [{ fulfillment_order_id, ... }]`
    const fo = payload.fulfillment_order || {};
    const lifo = Array.isArray(payload.line_items_by_fulfillment_order)
      ? payload.line_items_by_fulfillment_order[0] || {}
      : {};
    console.log(`Shopify webhook topic=${topic} payload_keys=${Object.keys(payload).join(",")} order=${payload.order_id || payload.id || fo.order_id}`);

    const fulfillmentStatus = String(payload?.status || payload?.fulfillment_status || fo?.status || "").toLowerCase();
    const tags = String(payload?.tags || "").toLowerCase();

    const eventName = classifyWebhookEvent(topic, { fulfillmentStatus, tags });

    if (!eventName) {
      return new Response(JSON.stringify({ ignored: true, reason: `unhandled (topic=${topic} status=${fulfillmentStatus})` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isReadyToPickup = eventName === "order_ready_for_pickup";

    // For fulfillment_orders topics, `id` is the fulfillment_order id, not the order id.
    // Prefer explicit order_id fields; fall back to nested shapes; only use payload.id for orders/create & fulfillments/*.
    const isFulfillmentOrdersTopic = topic.startsWith("fulfillment_orders/");

    let orderNumber = String(payload.order_number || payload.name || fo.order_name || "");
    let customer = payload.customer || {};
    let shippingAddress = payload.shipping_address || payload.destination || fo.destination || {};


    // If we only have a fulfillment_order id, resolve the underlying order_id via Admin API
    let resolvedOrderId = String(
      payload.order_id ||
      fo.order_id ||
      ""
    );
    if (!resolvedOrderId && !isFulfillmentOrdersTopic) resolvedOrderId = String(payload.id || "");

    if (!resolvedOrderId && isFulfillmentOrdersTopic) {
      const foId = String(fo.id || payload.id || lifo.fulfillment_order_id || "");
      const adminToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
      if (foId && shopDomain && adminToken) {
        try {
          const foResp = await fetch(
            `https://${shopDomain}/admin/api/2025-07/fulfillment_orders/${foId}.json`,
            { headers: { "X-Shopify-Access-Token": adminToken } },
          );
          if (foResp.ok) {
            const { fulfillment_order } = await foResp.json();
            resolvedOrderId = String(fulfillment_order?.order_id || "");
            console.log(`Resolved fulfillment_order ${foId} -> order ${resolvedOrderId}`);
          } else {
            console.error(`Failed to fetch fulfillment_order ${foId}: ${foResp.status}`);
          }
        } catch (e) {
          console.error("fulfillment_order fetch failed:", e);
        }
      }
    }

    if (!resolvedOrderId) {
      console.error(`missing order id topic=${topic} payload=${rawBody.slice(0, 500)}`);
      // Always 200: a non-2xx makes Shopify mark the delivery as failed and retry forever.
      return new Response(JSON.stringify({ ignored: true, error: "missing order id" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // Aviso de retirada só vale para pedido que É de retirada. Sem esta checagem,
    // todo pedido de entrega despachado disparava "venha buscar na loja".
    //
    // Quando não conseguimos determinar o método (payload sem o dado e Admin API
    // indisponível), seguimos com o envio: deixar de avisar um cliente que veio
    // buscar é pior do que uma mensagem indevida ocasional. O caso fica em log.
    if (isReadyToPickup) {
      const methodType = await resolveDeliveryMethodType(fo, resolvedOrderId, shopDomain);
      if (methodType === null) {
        console.warn(`Delivery method indeterminado para o pedido ${resolvedOrderId} — enviando mesmo assim`);
      } else if (!isPickupMethod(methodType)) {
        console.log(`Pedido ${resolvedOrderId} nao e retirada (method_type=${methodType}) — ignorado`);
        return new Response(
          JSON.stringify({ ignored: true, reason: `not a pickup order (method_type=${methodType})` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Fulfillment webhooks lack customer/phone — fetch full order via Admin API
    const needsOrderFetch = !customer?.phone && !shippingAddress?.phone && !customer?.email;
    if (needsOrderFetch) {
      const adminToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
      if (shopDomain && adminToken) {
        try {
          const orderResp = await fetch(
            `https://${shopDomain}/admin/api/2025-07/orders/${resolvedOrderId}.json`,
            { headers: { "X-Shopify-Access-Token": adminToken } },
          );
          if (orderResp.ok) {
            const { order } = await orderResp.json();
            customer = order.customer || customer;
            shippingAddress = order.shipping_address || shippingAddress;
            orderNumber = String(order.order_number || order.name || orderNumber);
          } else {
            console.error(`Failed to fetch order ${resolvedOrderId}: ${orderResp.status}`);
          }
        } catch (e) {
          console.error("Admin API fetch failed:", e);
        }
      }
    }

    const customerName =
      `${customer.first_name || shippingAddress.first_name || ""} ${customer.last_name || shippingAddress.last_name || ""}`.trim()
      || customer.name || "Cliente";
    const customerPhone = normalizePhone(customer.phone || shippingAddress.phone || (payload as any).billing_address?.phone || payload.phone);

    if (!customerPhone) {
      console.warn(`No customer phone for order ${resolvedOrderId}, skipping`);
      return new Response(JSON.stringify({ error: "cliente sem telefone" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = Deno.env.get("EXTERNAL_API_BASE_URL");
    const apiToken = Deno.env.get("EXTERNAL_API_TOKEN");
    if (!baseUrl || !apiToken) {
      console.error("EXTERNAL_API_BASE_URL/TOKEN não configurados");
      return new Response(JSON.stringify({ ok: false, error: "EXTERNAL_API_BASE_URL/TOKEN não configurados" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const endpoint = `${baseUrl.replace(/\/$/, "")}/api/whatsapp/send`;
    const numericId = resolvedOrderId.replace(/\D/g, "");
    const orderGid = numericId ? `gid://shopify/Order/${numericId}` : resolvedOrderId;
    const outbound: Record<string, unknown> = {
      event: eventName,
      shopify_order_id: orderGid,
      order_id: orderGid,
      order_number: orderNumber.startsWith("#") ? orderNumber : `#${orderNumber}`,
      customer_name: customerName,
      phone: customerPhone,
      store_name: STORE_NAME,
      // Mesma chave para os vários tópicos que significam o mesmo evento, e para
      // as retentativas da Shopify. Permite à API externa descartar repetição.
      idempotency_key: buildIdempotencyKey(eventName, resolvedOrderId),
      source_topic: topic,
    };
    if (eventName === "order_ready_for_pickup") {
      outbound.pickup_hours = PICKUP_HOURS;
    }

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiToken,
      },
      body: JSON.stringify(outbound),
    });
    const respText = await resp.text();

    if (!resp.ok) {
      console.error(`External API error ${resp.status}: ${respText}`);
      // Sempre 200, mesmo em falha. Dois motivos, e o segundo é o decisivo:
      //
      // 1. A Shopify reenvia webhook não-2xx por até 48h. Como cada tentativa
      //    pode virar uma nova mensagem, retentativa alimenta justamente o
      //    problema de duplicata que derruba a reputação do número.
      // 2. Depois de falhas sustentadas a Shopify REMOVE a inscrição do
      //    webhook. Perder uma notificação é recuperável (há o botão de
      //    reenvio no painel); perder o registro mata o fluxo inteiro, em
      //    silêncio, e ninguém percebe até um cliente reclamar.
      //
      // A falha fica no log. Não troque por 5xx sem resolver antes o registro
      // de envio — hoje não há como saber que uma notificação se perdeu.
      return new Response(JSON.stringify({ ok: false, error: "external_api_failed", status: resp.status, body: respText }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`WhatsApp dispatched for order ${orderNumber}: ${respText}`);

    // Grava o código no pedido para o e-mail nativo da Shopify renderizar via
    // {{ attributes["Codigo de retirada"] }}.
    const pickupCode = extractPickupCode(respText);

    if (!pickupCode && isReadyToPickup) {
      // Sem isto a falha era invisível: o e-mail saía sem código e nada indicava
      // o motivo. Ou a API externa não devolveu código, ou devolveu num campo
      // que não conhecemos.
      console.warn(
        `PICKUP_CODE_AUSENTE order=${orderNumber} — resposta da API externa sem codigo reconhecivel: ${respText.slice(0, 200)}`,
      );
    }

    if (pickupCode && numericId) {
      const adminToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
      if (shopDomain && adminToken) {
        await savePickupCodeOnOrder({
          shopDomain,
          adminToken,
          numericOrderId: numericId,
          pickupCode,
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, order: orderNumber, pickup_code: pickupCode, external: respText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
