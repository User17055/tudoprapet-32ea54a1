import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { requireAdmin, requireUser } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { fetchOlistCostBySku } from "../_shared/olist.ts";
import { applyProductCost, loadSubscriberMarginRules } from "../_shared/olist-cost-apply.ts";

/**
 * Revisão de preço de franquia (produto bloqueado no checkout por falta de custo).
 *
 *  - request (franqueado): pede a revisão de um item que o SISTEMA bloqueou.
 *    Produto que não foi bloqueado não pode ser revisado — evita revisões
 *    desnecessárias de produtos com preço correto.
 *  - mine (franqueado): suas revisões e o resultado (aparece no painel dele).
 *  - list (admin): fila de revisões e decisões recentes.
 *  - decide (só aprovadores): aprovar (custo da Olist), alterar (custo
 *    informado, com justificativa) ou recusar (com motivo).
 *
 * Aprovadores: e-mails em FRANCHISE_PRICE_APPROVERS (separados por vírgula),
 * além do papel de admin.
 */

type Admin = SupabaseClient;

function approvers(): Set<string> {
  return new Set(
    String(Deno.env.get("FRANCHISE_PRICE_APPROVERS") || "")
      .split(/[,;\s]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function canDecide(email: string | null): boolean {
  return !!email && approvers().has(email.trim().toLowerCase());
}

function adminClient(): Admin {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

async function requestReview(req: Request, body: Record<string, unknown>) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const admin = adminClient();
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("is_franchisee").eq("user_id", auth.auth.userId).maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.is_franchisee) return errorResponse("Recurso exclusivo para franqueados", 403);

  const variantId = String(body.variantId || "");
  if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(variantId)) {
    return errorResponse("Produto inválido", 400);
  }
  const { data: review, error } = await admin.from("franchise_price_reviews")
    .select("id,status").eq("shopify_variant_id", variantId).maybeSingle();
  if (error) throw error;
  // Só o que o próprio checkout bloqueou pode ser revisado.
  if (!review || !["blocked", "requested"].includes(review.status)) {
    return errorResponse("Este produto não está em condição de revisão", 409);
  }
  const { error: requestError } = await admin.from("franchise_price_review_requests").upsert(
    { review_id: review.id, user_id: auth.auth.userId },
    { onConflict: "review_id,user_id", ignoreDuplicates: true },
  );
  if (requestError) throw requestError;
  if (review.status === "blocked") {
    const { error: updateError } = await admin.from("franchise_price_reviews").update({
      status: "requested",
      requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", review.id).eq("status", "blocked");
    if (updateError) throw updateError;
  }
  return jsonResponse({ ok: true, status: "requested" });
}

async function myReviews(req: Request) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;
  const admin = adminClient();
  const { data, error } = await admin.from("franchise_price_review_requests")
    .select(
      "requested_at,review:franchise_price_reviews(id,shopify_variant_id,product_title,status,decision_cost,decision_note,decided_at)",
    )
    .eq("user_id", auth.auth.userId)
    .order("requested_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const reviews = (data ?? []).flatMap((row: any) => {
    const review = Array.isArray(row.review) ? row.review[0] : row.review;
    if (!review) return [];
    return [{
      id: review.id,
      variantId: review.shopify_variant_id,
      title: review.product_title,
      status: review.status,
      // Preço liberado = custo decidido (franquia paga custo).
      price: review.decision_cost === null ? null : Number(review.decision_cost),
      note: review.status === "rejected" ? review.decision_note : null,
      requestedAt: row.requested_at,
      decidedAt: review.decided_at,
    }];
  });
  return jsonResponse({ reviews });
}

async function listReviews(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  const admin = adminClient();
  const recent = new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString();
  const { data: reviews, error } = await admin.from("franchise_price_reviews")
    .select(
      "id,shopify_variant_id,shopify_product_id,sku,product_title,catalog_price,reason,status,block_count,first_blocked_at,last_blocked_at,requested_at,decided_at,decided_by_email,decision_cost,decision_note",
    )
    .or(`status.in.(blocked,requested),decided_at.gte.${recent}`)
    .order("last_blocked_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  const ids = (reviews ?? []).map((review) => review.id);
  const requestersByReview = new Map<string, string[]>();
  if (ids.length) {
    // leitura-limitada: solicitantes das até 100 revisões acima
    const { data: requests, error: requestsError } = await admin.from("franchise_price_review_requests")
      .select("review_id,user_id").in("review_id", ids);
    if (requestsError) throw requestsError;
    const userIds = [...new Set((requests ?? []).map((row) => row.user_id))];
    const names = new Map<string, string>();
    if (userIds.length) {
      // leitura-limitada: franqueados que pediram as revisões acima
      const { data: profiles, error: profilesError } = await admin.from("profiles")
        .select("user_id,company_trade_name,company_legal_name,name").in("user_id", userIds);
      if (profilesError) throw profilesError;
      for (const profile of profiles ?? []) {
        names.set(
          profile.user_id,
          profile.company_trade_name || profile.company_legal_name || profile.name || "Franquia",
        );
      }
    }
    for (const request of requests ?? []) {
      const list = requestersByReview.get(request.review_id) ?? [];
      list.push(names.get(request.user_id) || "Franquia");
      requestersByReview.set(request.review_id, list);
    }
  }
  return jsonResponse({
    canDecide: canDecide(auth.auth.email),
    reviews: (reviews ?? []).map((review) => ({
      ...review,
      requesters: requestersByReview.get(review.id) ?? [],
    })),
  });
}

async function decideReview(req: Request, body: Record<string, unknown>) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;
  if (!canDecide(auth.auth.email)) {
    return errorResponse("Somente os aprovadores de preço podem decidir revisões", 403);
  }
  const admin = adminClient();
  const reviewId = String(body.reviewId || "");
  const decision = String(body.decision || "");
  const note = String(body.note || "").trim().slice(0, 500);
  if (!["approve", "change", "reject"].includes(decision)) return errorResponse("Decisão inválida", 400);

  const { data: review, error } = await admin.from("franchise_price_reviews")
    .select("id,shopify_variant_id,shopify_product_id,sku,status")
    .eq("id", reviewId).maybeSingle();
  if (error) throw error;
  if (!review) return errorResponse("Revisão não encontrada", 404);
  if (!["blocked", "requested"].includes(review.status)) {
    return errorResponse("Esta revisão já foi decidida", 409);
  }

  let cost: number | null = null;
  let status: "approved" | "changed" | "rejected";
  if (decision === "reject") {
    if (!note) return errorResponse("Informe o motivo da recusa", 400);
    status = "rejected";
  } else {
    if (!review.shopify_product_id) return errorResponse("Produto sem identificação na loja", 409);
    if (decision === "approve") {
      // Aprovar = usar o custo atual da Olist (ex.: SKU/custo cadastrado depois do bloqueio).
      const sku = String(body.sku || review.sku || "").trim();
      if (!sku) return errorResponse("Produto sem SKU: use Alterar e informe o custo", 409);
      const token = Deno.env.get("OLIST_API_TOKEN") || Deno.env.get("TINY_API_TOKEN") || "";
      if (!token) return errorResponse("OLIST_API_TOKEN não configurado", 503);
      const product = await fetchOlistCostBySku(sku, token);
      if (!product || !(product.cost > 0)) {
        return errorResponse("A Olist não tem custo para este SKU: use Alterar e informe o custo", 409);
      }
      cost = product.cost;
      review.sku = sku;
      status = "approved";
    } else {
      cost = Number(String(body.cost ?? "").replace(",", "."));
      if (!Number.isFinite(cost) || cost <= 0 || cost > 100_000) return errorResponse("Custo inválido", 400);
      if (!note) return errorResponse("Informe a justificativa do custo", 400);
      cost = Math.round(cost * 100) / 100;
      status = "changed";
    }
    const rules = await loadSubscriberMarginRules(admin, [review.shopify_product_id]);
    await applyProductCost(
      admin,
      {
        productId: review.shopify_product_id,
        variantId: review.shopify_variant_id,
        sku: review.sku || "",
      },
      cost,
      rules,
      decision === "approve" ? "olist" : "manual",
    );
  }

  const { error: saveError } = await admin.from("franchise_price_reviews").update({
    status,
    decided_at: new Date().toISOString(),
    decided_by: auth.auth.userId,
    decided_by_email: auth.auth.email,
    decision_cost: cost,
    decision_note: note || null,
    ...(review.sku ? { sku: review.sku } : {}),
    updated_at: new Date().toISOString(),
  }).eq("id", review.id);
  if (saveError) throw saveError;
  return jsonResponse({ ok: true, status, cost });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    switch (String(body.action || "")) {
      case "request":
        return await requestReview(req, body);
      case "mine":
        return await myReviews(req);
      case "list":
        return await listReviews(req);
      case "decide":
        return await decideReview(req, body);
      default:
        return errorResponse("Ação inválida", 400);
    }
  } catch (error) {
    console.error("franchise-price-review:", error);
    return errorResponse("Não foi possível concluir a revisão de preço", 500);
  }
});
