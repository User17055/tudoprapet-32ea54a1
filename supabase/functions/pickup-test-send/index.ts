import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const baseUrl = Deno.env.get("EXTERNAL_API_BASE_URL");
  const token = Deno.env.get("EXTERNAL_API_TOKEN");
  if (!baseUrl) {
    return new Response(JSON.stringify({ error: "EXTERNAL_API_BASE_URL not set" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let overrides: Record<string, unknown> = {};
  if (req.method === "POST") {
    try { overrides = await req.json(); } catch { /* ignore */ }
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/whatsapp/send`;
  const defaults: Record<string, unknown> = {
    event: "order_ready_for_pickup",
    order_id: "shopify-1008",
    order_number: "#1008",
    customer_name: "Maria Silva",
    phone: "5511999999999",
    store_name: "TudoPraPet",
    pickup_hours: "segunda a sexta, das 9h às 18h, e aos sábados até 12h",
  };
  const payload = { ...defaults, ...overrides };

  const start = Date.now();
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "X-API-Key": token } : {}),
      },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    return new Response(
      JSON.stringify({
        endpoint,
        sent_payload: payload,
        status: resp.status,
        ok: resp.ok,
        duration_ms: Date.now() - start,
        response_body: text.slice(0, 2000),
      }, null, 2),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ endpoint, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
