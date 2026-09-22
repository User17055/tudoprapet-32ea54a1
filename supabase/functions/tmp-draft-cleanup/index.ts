// Ferramenta temporária: exclui rascunhos de teste e libera a reserva de estoque.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => ({})) as { sessionIds?: string[] };
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const shop = SHOP_DOMAIN;
  const token = shopifyAdminToken();
  if (!token) return errorResponse("Credenciais ausentes", 500);
  const results: Array<Record<string, unknown>> = [];
  for (const sessionId of body.sessionIds || []) {
    const { data: session } = await admin.from("checkout_sessions")
      .select("id,shopify_draft_order_id,status").eq("id", sessionId).maybeSingle();
    if (!session) { results.push({ sessionId, found: false }); continue; }
    let deleted: number | null = null;
    if (session.shopify_draft_order_id) {
      const response = await fetch(
        `https://${shop}/admin/api/2025-01/draft_orders/${session.shopify_draft_order_id}.json`,
        { method: "DELETE", headers: { "X-Shopify-Access-Token": token } },
      );
      deleted = response.status;
    }
    await admin.from("checkout_sessions")
      .update({ status: "failed", inventory_reserved_until: null, session_expires_at: new Date().toISOString() })
      .eq("id", sessionId);
    results.push({ sessionId, draftDeleteStatus: deleted });
  }
  return jsonResponse({ results });
});
