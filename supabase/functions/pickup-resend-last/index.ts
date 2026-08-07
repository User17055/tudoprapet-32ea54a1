import { corsHeaders } from "../_shared/cors.ts";
import { extractPickupCode, normalizePhone, PICKUP_HOURS, STORE_NAME } from "../_shared/pickup.ts";
import { savePickupCodeOnOrder } from "../_shared/shopify.ts";
import { requireAdmin } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Reenvia WhatsApp para um cliente real — mesmo gate das demais pickup-*.
  const authResult = await requireAdmin(req);
  if (!authResult.ok) return authResult.response;

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

    let body: { order_id?: string | number; customer?: string } = {};
    try { body = await req.json(); } catch { /* ignore */ }

    // Fetch order: specific id, busca por nome do cliente, ou o mais recente
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
      const limit = body.customer ? 250 : 1;
      const r = await fetch(
        `https://${shopDomain}/admin/api/2025-07/orders.json?status=any&limit=${limit}&order=created_at+desc`,
        { headers: { "X-Shopify-Access-Token": adminToken } },
      );
      if (!r.ok) {
        return new Response(JSON.stringify({ error: `Falha ao listar pedidos: ${r.status}` }), {
          status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const orders = (await r.json()).orders || [];
      if (body.customer) {
        const term = body.customer.trim().toLowerCase();
        order = orders.find((o: any) => {
          const c = o.customer || {};
          const s = o.shipping_address || {};
          const hay = [
            c.first_name, c.last_name, c.name, c.email,
            s.first_name, s.last_name, s.name,
            o.email, o.contact_email, o.name,
          ].filter(Boolean).join(" ").toLowerCase();
          return hay.includes(term);
        });
        if (!order) {
          return new Response(JSON.stringify({ error: `Nenhum pedido encontrado para "${body.customer}"` }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } else {
        order = orders[0];
      }
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

    // Grava o código no pedido para o e-mail nativo da Shopify renderizar via
    // {{ attributes["Codigo de retirada"] }}.
    const pickupCode = extractPickupCode(respText);

    if (!pickupCode) {
      console.warn(
        `PICKUP_CODE_AUSENTE order=${orderNumber} — resposta da API externa sem codigo reconhecivel: ${respText.slice(0, 200)}`,
      );
    } else {
      // O pedido já está carregado aqui, então passamos os atributos atuais e
      // evitamos uma leitura extra na Admin API.
      await savePickupCodeOnOrder({
        shopDomain,
        adminToken,
        numericOrderId: numericId,
        pickupCode,
        existingNoteAttributes: order.note_attributes ?? [],
      });
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
