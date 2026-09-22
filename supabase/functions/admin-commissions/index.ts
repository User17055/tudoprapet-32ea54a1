import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { commissionForLine, commissionStatus } from "../_shared/commission.ts";

type SnapshotItem = {
  productTitle?: string;
  variantTitle?: string;
  quantity?: number;
  lineTotal?: number;
  unitPrice?: number;
  commissionPercent?: number;
  commissionScope?: string;
  commissionAmount?: number;
};

async function allRows<T>(queryPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await queryPage(page * 500, page * 500 + 499);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < 500) return rows;
  }
  throw new Error("Limite de paginação do relatório de comissões atingido");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (body.action === "update_store_rate") {
      const percent = Number(body.percent);
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        return errorResponse("Percentual inválido", 400);
      }
      const { error } = await admin.from("commission_settings")
        .update({ store_percent: Math.round(percent * 100) / 100 })
        .eq("id", true);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "save_rule") {
      const percent = Number(body.percent);
      const scope = body.scope;
      const targetId = String(body.targetId || "");
      if (!Number.isFinite(percent) || percent < 0 || percent > 100
        || (scope !== "category" && scope !== "product")
        || (scope === "category" && !/^[0-9a-f-]{36}$/i.test(targetId))
        || (scope === "product" && !/^gid:\/\/shopify\/Product\/\d+$/.test(targetId))) {
        return errorResponse("Regra de comissão inválida", 400);
      }
      if (scope === "category") {
        const { data: category, error: categoryError } = await admin.from("categories").select("id").eq("id", targetId).maybeSingle();
        if (categoryError) throw categoryError;
        if (!category) return errorResponse("Categoria não encontrada", 404);
      }
      const targetColumn = scope === "category" ? "category_id" : "shopify_product_id";
      const { data: existing, error: lookupError } = await admin.from("commission_rules")
        .select("id").eq("scope", scope).eq(targetColumn, targetId).maybeSingle();
      if (lookupError) throw lookupError;
      const value = Math.round(percent * 100) / 100;
      const { error } = existing
        ? await admin.from("commission_rules").update({ percent: value }).eq("id", existing.id)
        : await admin.from("commission_rules").insert({ scope, [targetColumn]: targetId, percent: value });
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "delete_rule") {
      if (typeof body.ruleId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.ruleId)) return errorResponse("Regra inválida", 400);
      const { error } = await admin.from("commission_rules").delete().eq("id", body.ruleId);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "block_customer") {
      const email = String(body.email || "").trim().toLowerCase();
      const reason = body.reason ? String(body.reason).trim().slice(0, 200) : null;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorResponse("E-mail inválido", 400);
      const { error } = await admin.from("commission_blocked_customers")
        .upsert({ email, reason }, { onConflict: "email" });
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    if (body.action === "unblock_customer") {
      if (typeof body.id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.id)) return errorResponse("Registro inválido", 400);
      const { error } = await admin.from("commission_blocked_customers").delete().eq("id", body.id);
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    const [codes, sessions, rules, settings, blockedCustomers] = await Promise.all([
      allRows((from, to) => admin.from("employee_referral_codes")
        .select("id,code,employee_name,active")
        .order("code").range(from, to)),
      allRows((from, to) => admin.from("checkout_sessions")
        .select("id,created_at,referral_code,referral_employee_name,commission_percent,customer_snapshot,items_snapshot,shopify_order_id,status")
        .not("referral_code", "is", null)
        .order("created_at", { ascending: false }).range(from, to)),
      allRows((from, to) => admin.from("commission_rules")
        .select("id,scope,category_id,shopify_product_id,percent")
        .order("created_at").range(from, to)),
      admin.from("commission_settings").select("store_percent").eq("id", true).maybeSingle(),
      allRows((from, to) => admin.from("commission_blocked_customers")
        .select("id,email,reason,created_at")
        .order("created_at", { ascending: false }).range(from, to)),
    ]);
    if (settings.error) throw settings.error;
    const storePercent = Number(settings.data?.store_percent) || 0;

    const sessionIds = sessions.map((session) => session.id);
    const payments = [] as Array<{ checkout_session_id: string; status: string; created_at: string }>;
    for (let index = 0; index < sessionIds.length; index += 100) {
      const { data, error } = await admin.from("payments")
        .select("checkout_session_id,status,created_at")
        .in("checkout_session_id", sessionIds.slice(index, index + 100))
        .order("created_at", { ascending: false });
      if (error) throw error;
      payments.push(...(data || []));
    }
    const statusesBySession = new Map<string, string[]>();
    for (const payment of payments) {
      const statuses = statusesBySession.get(payment.checkout_session_id) || [];
      statuses.push(payment.status);
      statusesBySession.set(payment.checkout_session_id, statuses);
    }

    const sales = sessions.map((session) => {
      const customer = session.customer_snapshot as { name?: string; email?: string } | null;
      const items = Array.isArray(session.items_snapshot) ? session.items_snapshot as SnapshotItem[] : [];
      const rate = Number(session.commission_percent) || 0;
      const products = items.map((item) => ({
        name: String(item.productTitle || "Produto"),
        variant: String(item.variantTitle || ""),
        quantity: Number(item.quantity) || 0,
        total: Number(item.lineTotal) || 0,
        commissionPercent: Number(item.commissionPercent ?? rate),
        commissionScope: item.commissionScope || "store",
        commissionAmount: commissionForLine(Number(item.lineTotal) || 0, Number(item.commissionPercent ?? rate)),
      }));
      const status = commissionStatus(session.status, statusesBySession.get(session.id) || []);
      const productsTotal = Math.round(products.reduce((sum, product) => sum + product.total, 0) * 100) / 100;
      const commissionAmount = status === "paid" ? Math.round(products.reduce((sum, product) => sum + product.commissionAmount, 0) * 100) / 100 : 0;
      return {
        id: session.id,
        createdAt: session.created_at,
        code: session.referral_code,
        employeeName: session.referral_employee_name || session.referral_code,
        customerName: customer?.name || "Cliente",
        customerEmail: customer?.email || "",
        shopifyOrderId: session.shopify_order_id,
        status,
        products,
        productsTotal,
        commissionPercent: new Set(products.map((product) => product.commissionPercent)).size === 1 ? products[0]?.commissionPercent ?? rate : null,
        commissionAmount,
      };
    });
    return jsonResponse({ codes, rules, sales, storePercent, blockedCustomers });
  } catch (error) {
    console.error("[admin-commissions]", error);
    return errorResponse("Não foi possível carregar as comissões", 500);
  }
});
