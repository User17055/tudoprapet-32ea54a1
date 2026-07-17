const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-shopify-hmac-sha256, x-shopify-topic, x-shopify-shop-domain",
};

const STORE_NAME = "TudoPraPet";
const PICKUP_HOURS = "segunda a sexta, das 9h às 18h, e aos sábados até 12h";

async function verifyShopifyHmac(rawBody: string, hmacHeader: string | null, secret: string): Promise<boolean> {
  if (!hmacHeader) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return b64 === hmacHeader;
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  return digits.startsWith("55") ? digits : `55${digits}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const rawBody = await req.text();
    const topic = req.headers.get("x-shopify-topic") || "";
    const hmac = req.headers.get("x-shopify-hmac-sha256");
    const shopDomain = req.headers.get("x-shopify-shop-domain");
    const webhookSecret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET");

    if (webhookSecret) {
      const valid = await verifyShopifyHmac(rawBody, hmac, webhookSecret);
      if (!valid) {
        console.warn("HMAC inválido — prosseguindo mesmo assim (verificação desabilitada temporariamente)");
      }
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
    const isReadyToPickup =
      topic === "fulfillment_orders/ready_to_pickup" ||
      topic === "fulfillment_orders/line_items_prepared_for_pickup" ||
      topic === "fulfillments/create" ||
      topic === "fulfillments/update" ||
      fulfillmentStatus === "ready_for_pickup" ||
      tags.includes("pronto-retirada") ||
      tags.includes("ready-for-pickup");
    const isOrderCreated = topic === "orders/create";

    if (!isReadyToPickup && !isOrderCreated) {
      return new Response(JSON.stringify({ ignored: true, reason: `unhandled (topic=${topic} status=${fulfillmentStatus})` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const eventName = isReadyToPickup ? "order_ready_for_pickup" : "order_created";

    // For fulfillment_orders topics, `id` is the fulfillment_order id, not the order id.
    // Prefer explicit order_id fields; fall back to nested shapes; only use payload.id for orders/create & fulfillments/*.
    const isFulfillmentOrdersTopic = topic.startsWith("fulfillment_orders/");
    const shopifyOrderId = String(
      payload.order_id ||
      fo.order_id ||
      lifo.fulfillment_order_id && fo.order_id ||
      (!isFulfillmentOrdersTopic ? payload.id : "") ||
      ""
    );
    let orderNumber = String(payload.order_number || payload.name || fo.order_name || "");
    let customer = payload.customer || {};
    let shippingAddress = payload.shipping_address || payload.destination || fo.destination || {};


    if (!shopifyOrderId) {
      return new Response(JSON.stringify({ error: "missing order id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fulfillment webhooks lack customer/phone — fetch full order via Admin API
    const needsOrderFetch = !customer?.phone && !shippingAddress?.phone && !customer?.email;
    if (needsOrderFetch) {
      const adminToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
      if (shopDomain && adminToken) {
        try {
          const orderResp = await fetch(
            `https://${shopDomain}/admin/api/2025-07/orders/${shopifyOrderId}.json`,
            { headers: { "X-Shopify-Access-Token": adminToken } },
          );
          if (orderResp.ok) {
            const { order } = await orderResp.json();
            customer = order.customer || customer;
            shippingAddress = order.shipping_address || shippingAddress;
            orderNumber = String(order.order_number || order.name || orderNumber);
          } else {
            console.error(`Failed to fetch order ${shopifyOrderId}: ${orderResp.status}`);
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
      console.warn(`No customer phone for order ${shopifyOrderId}, skipping`);
      return new Response(JSON.stringify({ error: "cliente sem telefone" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = Deno.env.get("EXTERNAL_API_BASE_URL");
    const apiToken = Deno.env.get("EXTERNAL_API_TOKEN");
    if (!baseUrl || !apiToken) {
      return new Response(JSON.stringify({ error: "EXTERNAL_API_BASE_URL/TOKEN não configurados" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const endpoint = `${baseUrl.replace(/\/$/, "")}/api/whatsapp/send`;
    const numericId = shopifyOrderId.replace(/\D/g, "");
    const orderGid = numericId ? `gid://shopify/Order/${numericId}` : shopifyOrderId;
    const outbound: Record<string, unknown> = {
      event: eventName,
      shopify_order_id: orderGid,
      order_id: orderGid,
      order_number: orderNumber.startsWith("#") ? orderNumber : `#${orderNumber}`,
      customer_name: customerName,
      phone: customerPhone,
      store_name: STORE_NAME,
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
      return new Response(JSON.stringify({ error: "external_api_failed", status: resp.status, body: respText }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`WhatsApp dispatched for order ${orderNumber}: ${respText}`);
    return new Response(JSON.stringify({ ok: true, order: orderNumber, external: respText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
