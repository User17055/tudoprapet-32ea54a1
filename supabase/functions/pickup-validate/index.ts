import { createClient } from "npm:@supabase/supabase-js@2.75.0";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Require authenticated admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Sessão inválida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Acesso restrito a administradores" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const code = String(body.code || "").trim();
    if (!code || code.length < 4 || code.length > 12) {
      return new Response(JSON.stringify({ error: "Código inválido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = Deno.env.get("EXTERNAL_API_BASE_URL");
    const apiToken = Deno.env.get("EXTERNAL_API_TOKEN");
    if (!baseUrl) {
      return new Response(JSON.stringify({ error: "EXTERNAL_API_BASE_URL não configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const endpoint = `${baseUrl.replace(/\/$/, "")}/api/pickup/validate`;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { "X-API-Key": apiToken } : {}),
      },
      body: JSON.stringify({ code }),
    });
    const text = await resp.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    // Enrich with Shopify line items when we have an order id
    const orderData = json?.order || json;
    const shopifyOrderId = String(orderData?.shopify_order_id || orderData?.order_id || "").replace(/\D/g, "");
    const shopDomain = "petjoy-deals-hb8r9.myshopify.com";
    const adminToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (resp.ok && shopifyOrderId && adminToken) {
      try {
        const orderResp = await fetch(
          `https://${shopDomain}/admin/api/2025-07/orders/${shopifyOrderId}.json?fields=line_items,order_number,name`,
          { headers: { "X-Shopify-Access-Token": adminToken } },
        );
        if (orderResp.ok) {
          const { order } = await orderResp.json();
          const items = (order?.line_items || []).map((li: any) => ({
            title: li.title,
            variant_title: li.variant_title,
            quantity: li.quantity,
            sku: li.sku,
          }));
          if (json?.order) json.order.items = items;
          else json.items = items;
          if (!orderData.order_number) {
            if (json?.order) json.order.order_number = order.order_number || order.name;
            else json.order_number = order.order_number || order.name;
          }
        }
      } catch (e) {
        console.error("Shopify enrich failed:", e);
      }
    }

    return new Response(JSON.stringify(json), {
      status: resp.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Validate error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
