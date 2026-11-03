import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { requireAdmin } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { fetchAllRowsResult } from "../_shared/fetch-all-rows.ts";

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

    if (body.action === "update_payment_block") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      if (!/^[0-9a-f-]{36}$/i.test(userId) || typeof body.skipPaymentBlock !== "boolean") {
        return errorResponse("Dados inválidos", 400);
      }
      const { data: profile, error: profileError } = await admin.from("profiles")
        .select("is_franchisee").eq("user_id", userId).maybeSingle();
      if (profileError) throw profileError;
      if (!profile?.is_franchisee) return errorResponse("O usuário não é franqueado", 409);
      const { error } = await admin.from("franchise_credit_accounts").upsert({
        user_id: userId,
        skip_payment_block: body.skipPaymentBlock,
      }, { onConflict: "user_id" });
      if (error) throw error;
      return jsonResponse({ ok: true, userId, skipPaymentBlock: body.skipPaymentBlock });
    }

    if (body.action === "update_payment_term") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      const paymentTermDays = Number(body.paymentTermDays);
      const paymentScheduleType = body.paymentScheduleType === "fixed_day_next_month"
        ? "fixed_day_next_month"
        : "days_after_order";
      const paymentDueDay = paymentScheduleType === "fixed_day_next_month"
        ? Number(body.paymentDueDay)
        : null;
      const invalidDays = !Number.isInteger(paymentTermDays) || paymentTermDays < 1 || paymentTermDays > 365;
      const invalidDueDay = paymentScheduleType === "fixed_day_next_month" &&
        (!Number.isInteger(paymentDueDay) || paymentDueDay! < 1 || paymentDueDay! > 31);
      if (!/^[0-9a-f-]{36}$/i.test(userId) || invalidDays || invalidDueDay) {
        return errorResponse("Prazo de pagamento inválido", 400);
      }
      const { data: profile, error: profileError } = await admin.from("profiles")
        .select("is_franchisee").eq("user_id", userId).maybeSingle();
      if (profileError) throw profileError;
      if (!profile?.is_franchisee) return errorResponse("O usuário não é franqueado", 409);

      const { error } = await admin.from("franchise_credit_accounts").upsert({
        user_id: userId,
        payment_term_days: paymentTermDays,
        payment_schedule_type: paymentScheduleType,
        payment_due_day: paymentDueDay,
        payment_term_updated_by: auth.auth.userId,
        payment_term_updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) throw error;
      return jsonResponse({ ok: true, userId, paymentTermDays, paymentScheduleType, paymentDueDay });
    }

    const { data, error } = await fetchAllRowsResult(
      admin,
      "franchise_credit_accounts",
      "user_id,payment_term_days,payment_schedule_type,payment_due_day,skip_payment_block,payment_term_updated_at,payment_term_updated_by",
      { orderBy: [{ column: "updated_at", ascending: false }, "user_id"] },
    );
    if (error) throw error;
    return jsonResponse({ accounts: data || [] });
  } catch (error) {
    console.error("admin-franchise-settings:", error);
    return errorResponse("Não foi possível atualizar as condições da franquia", 500);
  }
});
