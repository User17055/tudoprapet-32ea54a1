import { createClient } from "npm:@supabase/supabase-js@2.75.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SHOP = "petjoy-deals-hb8r9.myshopify.com";
const API = "2025-07";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
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
      return new Response(JSON.stringify({ error: "Acesso restrito" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!shopifyToken) {
      return new Response(JSON.stringify({ error: "SHOPIFY_ACCESS_TOKEN não configurado" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://${SHOP}/admin/api/${API}/orders.json?status=any&fulfillment_status=fulfilled&limit=50&fields=id,name,order_number,created_at,customer,line_items,fulfillments,total_price,currency`;
    const resp = await fetch(url, {
      headers: { "X-Shopify-Access-Token": shopifyToken },
    });
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `Shopify ${resp.status}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { orders } = await resp.json();

    const history = (orders || []).map((o: any) => {
      const fulfillment = (o.fulfillments || [])[0];
      const items = (o.line_items || []).map((li: any) => ({
        title: li.title,
        variant_title: li.variant_title,
        quantity: li.quantity,
        sku: li.sku,
      }));
      const totalQty = items.reduce((s: number, i: any) => s + (i.quantity || 0), 0);
      return {
        id: o.id,
        order_number: o.order_number || o.name,
        name: o.name,
        customer_name: o.customer
          ? `${o.customer.first_name || ""} ${o.customer.last_name || ""}`.trim()
          : "Cliente",
        created_at: o.created_at,
        fulfilled_at: fulfillment?.created_at || null,
        total_price: Number(o.total_price || 0),
        currency: o.currency || "BRL",
        items_count: totalQty,
        items,
      };
    })
    .sort((a: any, b: any) => {
      const ta = a.fulfilled_at ? new Date(a.fulfilled_at).getTime() : 0;
      const tb = b.fulfilled_at ? new Date(b.fulfilled_at).getTime() : 0;
      return tb - ta;
    });

    return new Response(JSON.stringify({ history }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("pickup-history error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
