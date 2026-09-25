import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { errorResponse, jsonResponse } from "../_shared/cors.ts";
import { getOlistReceivable } from "../_shared/olist.ts";

function dateFromOlist(value?: string): Date | null {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return new Date(`${match[3]}-${match[2]}-${match[1]}T23:59:59-03:00`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!serviceRole || bearer !== serviceRole) return errorResponse("Não autorizado", 401);
  const token = Deno.env.get("OLIST_API_TOKEN") || Deno.env.get("TINY_API_TOKEN") || "";
  if (!token) return errorResponse("OLIST_API_TOKEN não configurado", 503);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRole);
    const { data: rows, error } = await admin.from("payments")
      .select("id,provider_payment_id,status,due_date")
      .eq("provider", "olist")
      .in("status", ["pending", "processing", "confirmed", "overdue"])
      .not("provider_payment_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(40);
    if (error) throw error;

    let paid = 0;
    let overdue = 0;
    let pending = 0;
    let failed = 0;
    for (const row of rows || []) {
      try {
        const account = await getOlistReceivable(String(row.provider_payment_id), token);
        const status = account.status.toLowerCase();
        let updateError: unknown = null;
        if (status === "pago") {
          const result = await admin.from("payments").update({
            status: "received",
            raw_status: status,
            ...(account.boletoUrl ? { provider_payment_url: account.boletoUrl } : {}),
            received_at: new Date().toISOString(),
            is_active: false,
          }).eq("id", row.id);
          updateError = result.error;
          paid++;
        } else if (status === "cancelado" || status === "cancelada") {
          const result = await admin.from("payments").update({
            status: "cancelled",
            raw_status: status,
            ...(account.boletoUrl ? { provider_payment_url: account.boletoUrl } : {}),
            is_active: false,
          }).eq("id", row.id);
          updateError = result.error;
        } else if (status === "parcial") {
          const result = await admin.from("payments").update({
            status: "processing",
            raw_status: status,
            ...(account.boletoUrl ? { provider_payment_url: account.boletoUrl } : {}),
          }).eq("id", row.id);
          updateError = result.error;
          pending++;
        } else {
          const due = dateFromOlist(account.dueDate) ||
            (row.due_date ? new Date(`${row.due_date}T23:59:59-03:00`) : null);
          const nextStatus = due && due.getTime() < Date.now() ? "overdue" : "pending";
          const result = await admin.from("payments").update({
            status: nextStatus,
            raw_status: status,
            ...(account.boletoUrl ? { provider_payment_url: account.boletoUrl } : {}),
          }).eq("id", row.id);
          updateError = result.error;
          if (nextStatus === "overdue") overdue++;
          else pending++;
        }
        if (updateError) throw updateError;
      } catch (entryError) {
        failed++;
        console.error(`Falha ao conciliar conta Olist ${row.provider_payment_id}:`, entryError);
      }
    }
    return jsonResponse({ checked: rows?.length || 0, paid, overdue, pending, failed });
  } catch (error) {
    console.error("olist-reconcile-franchise:", error);
    return errorResponse("Falha ao conciliar contas da Olist", 500);
  }
});
