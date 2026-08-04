import { corsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";

const SHOP = "petjoy-deals-hb8r9.myshopify.com";
const API = "2025-07";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Proxy da Admin API da Shopify: lista pedidos com dados de cliente, registra e
  // remove webhooks da loja. Restrito a admin.
  const authResult = await requireAdmin(req);
  if (!authResult.ok) return authResult.response;

  const token = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  if (!token) return new Response(JSON.stringify({ error: "no token" }), { status: 500, headers: corsHeaders });

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "list";
  const callbackUrl = `https://smvtnflhkvxdmvqbxwrf.supabase.co/functions/v1/shopify-pickup-webhook`;

  const base = `https://${SHOP}/admin/api/${API}`;
  const h = { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };

  if (action === "list") {
    const r = await fetch(`${base}/webhooks.json`, { headers: h });
    return new Response(await r.text(), { status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (action === "register") {
    // fulfillments/update saiu: atualizar um fulfillment existente (rastreio,
    // correcao de dado) nao e um novo evento de "pronto para retirada", e era
    // fonte de mensagem duplicada. O webhook tambem ignora esse topico agora,
    // entao registros antigos que ainda existam na loja nao geram envio.
    const topics = ["orders/create", "fulfillments/create", "fulfillment_orders/line_items_prepared_for_pickup"];
    const results: unknown[] = [];
    for (const topic of topics) {
      const r = await fetch(`${base}/webhooks.json`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ webhook: { topic, address: callbackUrl, format: "json" } }),
      });
      results.push({ topic, status: r.status, body: await r.text() });
    }
    return new Response(JSON.stringify(results, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (action === "delete") {
    const id = url.searchParams.get("id");
    const r = await fetch(`${base}/webhooks/${id}.json`, { method: "DELETE", headers: h });
    return new Response(await r.text() || JSON.stringify({ status: r.status }), { status: r.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (action === "trigger_last" || action === "list_orders" || action === "inspect_order") {
    // Fetch last N orders
    const r = await fetch(`${base}/orders.json?limit=5&status=any`, { headers: h });
    const data = await r.json();
    if (action === "list_orders") {
      const summary = (data.orders || []).map((o: any) => ({
        id: o.id, name: o.name, tags: o.tags,
        fulfillment_status: o.fulfillment_status,
        customer: o.customer ? `${o.customer.first_name} ${o.customer.last_name}` : null,
        phone: o.customer?.phone || o.shipping_address?.phone || o.billing_address?.phone || o.phone,
        created_at: o.created_at,
      }));
      return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (action === "inspect_order") {
      const wid = url.searchParams.get("order_id");
      const o = wid ? (data.orders || []).find((x: any) => String(x.id) === String(wid)) : (data.orders || [])[0];
      return new Response(JSON.stringify(o, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // trigger_last: pick specified order id or the first (most recent)
    const wantId = url.searchParams.get("order_id");
    const order = wantId
      ? (data.orders || []).find((o: any) => String(o.id) === String(wantId))
      : (data.orders || [])[0];
    if (!order) return new Response(JSON.stringify({ error: "no order found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const baseUrl = Deno.env.get("EXTERNAL_API_BASE_URL");
    const apiToken = Deno.env.get("EXTERNAL_API_TOKEN");
    if (!baseUrl || !apiToken) {
      return new Response(JSON.stringify({ error: "EXTERNAL_API_* missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const digits = (order.customer?.phone || order.shipping_address?.phone || order.billing_address?.phone || order.phone || "").replace(/\D/g, "");
    const phone = digits ? (digits.startsWith("55") ? digits : `55${digits}`) : null;
    if (!phone) return new Response(JSON.stringify({ error: "customer sem telefone", order: { id: order.id, name: order.name } }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const customerName = `${order.customer?.first_name || ""} ${order.customer?.last_name || ""}`.trim() || "Cliente";
    const orderGid = `gid://shopify/Order/${order.id}`;
    const outbound = {
      event: "order_ready_for_pickup",
      shopify_order_id: orderGid,
      order_id: orderGid,
      order_number: order.name?.startsWith("#") ? order.name : `#${order.name || order.order_number}`,
      customer_name: customerName,
      phone,
      store_name: "TudoPraPet",
      pickup_hours: "segunda a sexta, das 9h às 18h, e aos sábados até 12h",
    };

    const send = await fetch(`${baseUrl.replace(/\/$/, "")}/api/whatsapp/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiToken },
      body: JSON.stringify(outbound),
    });
    const text = await send.text();
    return new Response(JSON.stringify({ sent: outbound, status: send.status, response: text }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: corsHeaders });
});
