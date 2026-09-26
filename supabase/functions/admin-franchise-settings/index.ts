import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { requireAdmin } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (body.action === "update_payment_term") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      const paymentTermDays = Number(body.paymentTermDays);
      if (!/^[0-9a-f-]{36}$/i.test(userId) || ![7, 30].includes(paymentTermDays)) {
        return errorResponse("Prazo de pagamento inválido", 400);
      }
      const { data: profile, error: profileError } = await admin.from("profiles")
        .select("is_franchisee").eq("user_id", userId).maybeSingle();
      if (profileError) throw profileError;
      if (!profile?.is_franchisee) return errorResponse("O usuário não é franqueado", 409);

      const { error } = await admin.from("franchise_credit_accounts").upsert({
        user_id: userId,
        payment_term_days: paymentTermDays,
        payment_term_updated_by: auth.auth.userId,
        payment_term_updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
      return jsonResponse({ ok: true, userId, paymentTermDays });
    }

    const { data, error } = await admin.from("franchise_credit_accounts")
      .select("user_id,payment_term_days,payment_term_updated_at,payment_term_updated_by")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return jsonResponse({ accounts: data || [] });
  } catch (error) {
    console.error("admin-franchise-settings:", error);
    return errorResponse("Não foi possível atualizar as condições da franquia", 500);
  }
});
