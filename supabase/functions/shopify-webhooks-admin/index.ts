import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SHOP = "petjoy-deals-hb8r9.myshopify.com";
const API = "2025-07";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
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
    const topics = ["orders/create", "fulfillment_orders/ready_to_pickup"];
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

  return new Response(JSON.stringify({ error: "unknown action" }), { status: 400, headers: corsHeaders });
});
