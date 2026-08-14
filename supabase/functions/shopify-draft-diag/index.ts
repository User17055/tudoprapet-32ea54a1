import { corsHeadersWith, jsonResponse } from "../_shared/cors.ts";
import { ADMIN_API, shopifyAdminToken } from "../_shared/shopify.ts";
import { timingSafeEqual } from "../_shared/webhook.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersWith("x-payment-worker-token") });
  }
  const expected = Deno.env.get("PAYMENT_WORKER_TOKEN") || "";
  const received = req.headers.get("x-payment-worker-token") || "";
  if (!expected || !timingSafeEqual(expected, received)) {
    return jsonResponse({ error: "Não autorizado" }, 401);
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("draft_order_id");
  if (!id) return jsonResponse({ error: "draft_order_id obrigatório" }, 400);

  const token = shopifyAdminToken();
  if (!token) return jsonResponse({ error: "SHOPIFY_ACCESS_TOKEN ausente" }, 500);

  const res = await fetch(`${ADMIN_API}/draft_orders/${encodeURIComponent(id)}.json`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  const body = await res.text();
  return jsonResponse({ status: res.status, body: body.slice(0, 8000) });
});
