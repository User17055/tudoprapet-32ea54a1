// Envia (ou reenvia) o código de retirada para TODOS os pedidos criados hoje.
// Mesma mecânica do pickup-resend-last, porém em lote e com relatório por pedido.

import { corsHeaders } from "../_shared/cors.ts";
import {
  extractPickupCode,
  isAlreadyPickedUp,
  normalizePhone,
  PICKUP_HOURS,
  STORE_NAME,
} from "../_shared/pickup.ts";
import { savePickupCodeOnOrder } from "../_shared/shopify.ts";
import { requireAdmin } from "../_shared/auth.ts";

const SHOPIFY_API_VERSION = "2025-07";

/** Início do dia no fuso de São Paulo (UTC-3) em ISO, para o filtro da Shopify. */
function startOfTodaySaoPaulo(): string {
  const now = new Date();
  const sp = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const y = sp.getUTCFullYear();
  const m = String(sp.getUTCMonth() + 1).padStart(2, "0");
  const d = String(sp.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}T00:00:00-03:00`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authResult = await requireAdmin(req);
  if (!authResult.ok) return authResult.response;

  try {
    const shopDomain = Deno.env.get("SHOPIFY_SHOP_DOMAIN") || "petjoy-deals-hb8r9.myshopify.com";
    const adminToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    const baseUrl = Deno.env.get("EXTERNAL_API_BASE_URL");
    const apiToken = Deno.env.get("EXTERNAL_API_TOKEN");

    if (!adminToken || !baseUrl || !apiToken) {
      return new Response(
        JSON.stringify({ error: "Configuração ausente (SHOPIFY_ACCESS_TOKEN/EXTERNAL_API_*)" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const since = startOfTodaySaoPaulo();
    const listUrl =
      `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/orders.json` +
      `?status=any&limit=250&order=created_at+asc&created_at_min=${encodeURIComponent(since)}`;

    const listResp = await fetch(listUrl, { headers: { "X-Shopify-Access-Token": adminToken } });
    if (!listResp.ok) {
      return new Response(JSON.stringify({ error: `Falha ao listar pedidos: ${listResp.status}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const orders: any[] = (await listResp.json()).orders || [];

    const endpoint = `${baseUrl.replace(/\/$/, "")}/api/whatsapp/send`;
    const results: Array<Record<string, unknown>> = [];
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const order of orders) {
      const orderNumber = String(order.name || order.order_number || order.id || "");
      const customer = order.customer || {};
      const shippingAddress = order.shipping_address || {};
      const customerName =
        `${customer.first_name || shippingAddress.first_name || ""} ${customer.last_name || shippingAddress.last_name || ""}`
          .trim() || customer.name || "Cliente";

      if (
        isAlreadyPickedUp({
          noteAttributes: order.note_attributes ?? [],
          fulfillmentStatus: order.fulfillment_status,
        })
      ) {
        skipped++;
        results.push({ order_number: orderNumber, customer_name: customerName, status: "skipped", reason: "já retirado" });
        continue;
      }

      const phone = normalizePhone(
        customer.phone || shippingAddress.phone || order.billing_address?.phone || order.phone,
      );
      if (!phone) {
        skipped++;
        results.push({ order_number: orderNumber, customer_name: customerName, status: "skipped", reason: "sem telefone" });
        continue;
      }

      const numericId = String(order.id).replace(/\D/g, "");
      const orderGid = `gid://shopify/Order/${numericId}`;

      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": apiToken },
          body: JSON.stringify({
            event: "order_ready_for_pickup",
            shopify_order_id: orderGid,
            order_id: orderGid,
            order_number: orderNumber.startsWith("#") ? orderNumber : `#${orderNumber}`,
            customer_name: customerName,
            phone,
            store_name: STORE_NAME,
            pickup_hours: PICKUP_HOURS,
          }),
        });
        const respText = await resp.text();

        if (!resp.ok) {
          failed++;
          results.push({
            order_number: orderNumber, customer_name: customerName, status: "failed",
            reason: `API externa ${resp.status}: ${respText.slice(0, 160)}`,
          });
          continue;
        }

        const pickupCode = extractPickupCode(respText);
        if (pickupCode) {
          await savePickupCodeOnOrder({
            shopDomain,
            adminToken,
            numericOrderId: numericId,
            pickupCode,
            existingNoteAttributes: order.note_attributes ?? [],
          });
        }

        sent++;
        results.push({
          order_number: orderNumber, customer_name: customerName, status: "sent",
          phone, pickup_code: pickupCode,
        });
      } catch (e) {
        failed++;
        results.push({ order_number: orderNumber, customer_name: customerName, status: "failed", reason: String(e) });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, since, total: orders.length, sent, skipped, failed, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
