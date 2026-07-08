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

  const endpoint = `${baseUrl.replace(/\/$/, "")}/api/whatsapp/send`;
  const payload = {
    event: "pronto_retirada",
    template: "pronto_retirada",
    phone: "5518991565604",
    variables: {
      customer_name: "andrejunior",
      order_number: "TESTE-0001",
      pickup_code: "483920",
      store_name: "Lis-onTech",
      store_address: "",
    },
    meta: { test: true },
  };

  const start = Date.now();
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
