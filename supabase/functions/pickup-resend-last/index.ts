import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const STORE_NAME = "TudoPraPet";
const PICKUP_HOURS = "segunda a sexta, das 9h às 18h, e aos sábados até 12h";

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  return digits.startsWith("55") ? digits : `55${digits}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const shopDomain = Deno.env.get("SHOPIFY_SHOP_DOMAIN") || "petjoy-deals-hb8r9.myshopify.com";
    const adminToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    const baseUrl = Deno.env.get("EXTERNAL_API_BASE_URL");
    const apiToken = Deno.env.get("EXTERNAL_API_TOKEN");

    if (!adminToken || !baseUrl || !apiToken) {
      return new Response(JSON.stringify({ error: "Configuração ausente (SHOPIFY_ACCESS_TOKEN/EXTERNAL_API_*)" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: { order_id?: string | number } = {};
    try { body = await req.json(); } catch { /* ignore */ }

    // Fetch order: specific id or the most recent one
    let order: any = null;
    if (body.order_id) {
      const numeric = String(body.order_id).replace(/\D/g, "");
      const r = await fetch(`https://${shopDomain}/admin/api/2025-07/orders/${numeric}.json`, {
        headers: { "X-Shopify-Access-Token": adminToken },
      });
      if (!r.ok) {
        return new Response(JSON.stringify({ error: `Falha ao buscar pedido ${numeric}: ${r.status}` }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      order = (await r.json()).order;
    } else {
      const r = await fetch(
        `https://${shopDomain}/admin/api/2025-07/orders.json?status=any&limit=1&order=created_at+desc`,
        { headers: { "X-Shopify-Access-Token": adminToken } },
      );
      if (!r.ok) {
        return new Response(JSON.stringify({ error: `Falha ao listar pedidos: ${r.status}` }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const j = await r.json();
      order = (j.orders || [])[0];
    }

    if (!order) {
      return new Response(JSON.stringify({ error: "Nenhum pedido encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const customer = order.customer || {};
    const shippingAddress = order.shipping_address || {};
    const customerName =
      `${customer.first_name || shippingAddress.first_name || ""} ${customer.last_name || shippingAddress.last_name || ""}`.trim()
      || customer.name || "Cliente";
    const customerPhone = normalizePhone(
      customer.phone || shippingAddress.phone || order.billing_address?.phone || order.phone,
    );

    if (!customerPhone) {
      return new Response(JSON.stringify({ error: "Cliente sem telefone cadastrado", order_number: order.name }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const numericId = String(order.id).replace(/\D/g, "");
    const orderGid = `gid://shopify/Order/${numericId}`;
    const orderNumber = String(order.name || order.order_number || "");

    const outbound = {
      event: "order_ready_for_pickup",
      shopify_order_id: orderGid,
      order_id: orderGid,
      order_number: orderNumber.startsWith("#") ? orderNumber : `#${orderNumber}`,
      customer_name: customerName,
      phone: customerPhone,
      store_name: STORE_NAME,
      pickup_hours: PICKUP_HOURS,
    };

    const endpoint = `${baseUrl.replace(/\/$/, "")}/api/whatsapp/send`;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiToken },
      body: JSON.stringify(outbound),
    });
    const respText = await resp.text();

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: "external_api_failed", status: resp.status, body: respText }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save the pickup code on the Shopify order so Shopify's own notification
    // e-mail can show it via {{ attributes["Codigo de retirada"] }}
    let pickupCode: string | null = null;
    try {
      const parsed = JSON.parse(respText);
      pickupCode = parsed?.pickup_code || parsed?.code || parsed?.data?.pickup_code || null;
    } catch { /* non-JSON */ }

    if (pickupCode) {
      try {
        const upd = await fetch(`https://${shopDomain}/admin/api/2025-07/orders/${numericId}.json`, {
          method: "PUT",
          headers: { "X-Shopify-Access-Token": adminToken, "Content-Type": "application/json" },
          body: JSON.stringify({
            order: { id: Number(numericId), note_attributes: [{ name: "Codigo de retirada", value: pickupCode }] },
          }),
        });
        if (!upd.ok) console.error(`Failed to save pickup code: ${upd.status} ${await upd.text()}`);
      } catch (e) {
        console.error("Failed to save pickup code:", e);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      order_number: outbound.order_number,
      customer_name: customerName,
      phone: customerPhone,
      pickup_code: pickupCode,
      external: respText,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
