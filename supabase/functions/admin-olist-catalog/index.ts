// Valores pela Olist em duas etapas (26/11/2026):
//  1. Ler: baixa o catálogo inteiro da Olist (~8 chamadas de 100 produtos) e as
//     listas de preço para um retrato no banco;
//  2. Aplicar: grava custo, franquia e assinante a partir do retrato para os
//     itens escolhidos, sem chamar a Olist (mesma regra de applyProductCost).
// Mão única: nada aqui grava na Olist. Antes eram ~765 chamadas e ~27 minutos.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { requireAdmin } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, FUNCTIONS_VERSION, jsonResponse } from "../_shared/cors.ts";
import {
  fetchOlistCatalogPage,
  fetchOlistPriceListExceptions,
  fetchOlistPriceLists,
  isOlistRateLimitError,
  normalizeSku,
  setOlistCallPriority,
} from "../_shared/olist.ts";
import {
  applyProductCost,
  derivedPricesFromCost,
  loadSubscriberMarginRules,
} from "../_shared/olist-cost-apply.ts";
import { planCatalogApply, type CatalogApplyItem, type SnapshotRow } from "../_shared/olist-catalog.ts";

const MAX_APPLY_ITEMS = 100;
const APPLY_CONCURRENCY = 4;
const MAX_CATALOG_PAGES = 100;

type Body = Record<string, unknown>;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

async function bumpRun(admin: SupabaseClient, runId: string, fields: Record<string, number>, extra: Record<string, unknown> = {}) {
  const { data, error } = await admin.from("olist_catalog_runs").select("*").eq("id", runId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Execução não encontrada");
  const update: Record<string, unknown> = { ...extra };
  for (const [key, value] of Object.entries(fields)) update[key] = Number(data[key] ?? 0) + value;
  const { error: updateError } = await admin.from("olist_catalog_runs").update(update).eq("id", runId);
  if (updateError) throw updateError;
}

async function createRun(admin: SupabaseClient, kind: "catalog" | "apply", userId: string): Promise<string> {
  const { data, error } = await admin.from("olist_catalog_runs")
    .insert({ kind, created_by: userId })
    .select("id")
    .single();
  if (error) throw error;
  return String(data.id);
}

function validRunId(value: unknown): string | null {
  const id = String(value ?? "");
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

async function catalogPage(admin: SupabaseClient, token: string, body: Body, userId: string) {
  const page = Number(body.page);
  if (!Number.isInteger(page) || page < 1 || page > MAX_CATALOG_PAGES) return errorResponse("Página inválida", 400);
  let runId = validRunId(body.runId);
  if (page === 1 && !runId) runId = await createRun(admin, "catalog", userId);
  if (!runId) return errorResponse("Execução inválida", 400);

  const result = await fetchOlistCatalogPage(token, page);
  const fetchedAt = new Date().toISOString();
  const rows = result.products.map((product) => ({
    olist_product_id: product.id,
    sku: product.sku,
    sku_key: normalizeSku(product.sku),
    name: product.name,
    price: product.price,
    promo_price: product.promoPrice,
    cost: product.cost,
    status: product.status,
    variation_type: product.variationType,
    run_id: runId,
    fetched_at: fetchedAt,
  }));
  for (const part of chunks(rows, 200)) {
    const { error } = await admin.from("olist_product_snapshot").upsert(part, { onConflict: "olist_product_id" });
    if (error) throw error;
  }
  await bumpRun(admin, runId, { products: rows.length }, { pages: page });
  return jsonResponse({
    ok: true,
    version: FUNCTIONS_VERSION,
    runId,
    page,
    totalPages: result.totalPages,
    products: rows.length,
  });
}

async function priceLists(admin: SupabaseClient, token: string, body: Body) {
  const runId = validRunId(body.runId);
  if (!runId) return errorResponse("Execução inválida", 400);
  const lists = await fetchOlistPriceLists(token);
  const fetchedAt = new Date().toISOString();
  let exceptionCount = 0;
  for (const list of lists) {
    const exceptions = await fetchOlistPriceListExceptions(token, list.id);
    const { error: listError } = await admin.from("olist_price_lists").upsert({
      olist_price_list_id: list.id,
      name: list.name,
      adjustment_percent: list.adjustmentPercent,
      run_id: runId,
      fetched_at: fetchedAt,
    }, { onConflict: "olist_price_list_id" });
    if (listError) throw listError;
    const { error: clearError } = await admin.from("olist_price_list_exceptions")
      .delete()
      .eq("olist_price_list_id", list.id);
    if (clearError) throw clearError;
    const rows = [...new Map(exceptions.map((entry) => [entry.productId, entry])).values()].map((entry) => ({
      olist_price_list_id: list.id,
      olist_product_id: entry.productId,
      price: entry.price,
      promo_price: entry.promoPrice,
      run_id: runId,
      fetched_at: fetchedAt,
    }));
    for (const part of chunks(rows, 500)) {
      const { error } = await admin.from("olist_price_list_exceptions").insert(part);
      if (error) throw error;
    }
    exceptionCount += rows.length;
  }
  // Lista apagada na Olist sai do retrato (as exceções vão junto, em cascata).
  if (lists.length) {
    const { error } = await admin.from("olist_price_lists")
      .delete()
      .not("olist_price_list_id", "in", `(${lists.map((list) => `"${list.id}"`).join(",")})`);
    if (error) throw error;
  }
  await bumpRun(admin, runId, { price_lists: lists.length, exceptions: exceptionCount });
  return jsonResponse({ ok: true, version: FUNCTIONS_VERSION, runId, lists: lists.length, exceptions: exceptionCount });
}

async function finishRun(admin: SupabaseClient, body: Body) {
  const runId = validRunId(body.runId);
  if (!runId) return errorResponse("Execução inválida", 400);
  let failed = typeof body.error === "string" && body.error.trim() !== "";
  let failure = failed ? String(body.error) : "";
  const { data: run, error } = await admin.from("olist_catalog_runs").select("kind,status,products").eq("id", runId).maybeSingle();
  if (error) throw error;
  if (!run) return errorResponse("Execução não encontrada", 404);
  if (run.kind === "catalog" && !failed) {
    // Leitura que veio bem menor que a anterior (página vazia, Olist instável)
    // não apaga o retrato: os produtos "sumidos" virariam "fora do catálogo".
    const { data: previous, error: previousError } = await admin.from("olist_catalog_runs")
      .select("products")
      .eq("kind", "catalog")
      .eq("status", "done")
      .neq("id", runId)
      .order("started_at", { ascending: false })
      .limit(1);
    if (previousError) throw previousError;
    const before = Number(previous?.[0]?.products ?? 0);
    const now = Number(run.products ?? 0);
    if (now === 0 || (before > 0 && now < before * 0.9)) {
      failed = true;
      failure = `Leitura incompleta: ${now} produtos (a anterior trouxe ${before}). O retrato anterior foi mantido; leia de novo.`;
    }
  }
  if (run.kind === "catalog" && !failed) {
    // Leitura completa: o que não veio nela não existe mais na Olist (ou foi excluído).
    const { error: staleError } = await admin.from("olist_product_snapshot").delete().neq("run_id", runId);
    if (staleError) throw staleError;
    const { error: nullError } = await admin.from("olist_product_snapshot").delete().is("run_id", null);
    if (nullError) throw nullError;
  }
  const counts: Record<string, number> = {};
  if (run.kind === "apply") {
    for (const key of ["not_found", "failed"]) {
      const value = Number(body[key === "not_found" ? "notFound" : key]);
      if (Number.isInteger(value) && value > 0) counts[key] = value;
    }
  }
  await bumpRun(admin, runId, counts, {
    status: failed ? "failed" : "done",
    finished_at: new Date().toISOString(),
    error: failed ? failure.slice(0, 500) : null,
  });
  return jsonResponse({ ok: true, version: FUNCTIONS_VERSION, runId, failed, error: failed ? failure : undefined });
}

function parseItems(raw: unknown): CatalogApplyItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_APPLY_ITEMS) return null;
  const items = raw.map((item: any) => ({
    productId: String(item?.productId || ""),
    variantId: String(item?.variantId || ""),
    sku: String(item?.sku || "").trim(),
    weightKg: item?.weightKg === null || item?.weightKg === undefined ? null : Number(item.weightKg),
  }));
  const invalid = items.find((item) =>
    !item.productId.startsWith("gid://shopify/Product/") ||
    !item.variantId.startsWith("gid://shopify/ProductVariant/") ||
    !normalizeSku(item.sku) ||
    (item.weightKg !== null && (!Number.isFinite(item.weightKg) || item.weightKg <= 0 || item.weightKg > 1000))
  );
  return invalid ? null : items;
}

async function runLimited<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function apply(admin: SupabaseClient, body: Body, userId: string) {
  const items = parseItems(body.items);
  if (!items) return errorResponse(`Envie de 1 a ${MAX_APPLY_ITEMS} itens válidos`, 400);
  const dryRun = body.dryRun === true;
  let runId = validRunId(body.runId);
  if (!dryRun && !runId) runId = await createRun(admin, "apply", userId);

  const variantIds = items.map((item) => item.variantId);
  const keys = [...new Set(items.map((item) => normalizeSku(item.sku)))];
  const [snapshotResult, costResult, franchiseResult, subscriberResult] = await Promise.all([
    // leitura-limitada: SKUs do lote (até 100)
    admin.from("olist_product_snapshot")
      .select("olist_product_id,sku,sku_key,name,cost,status")
      .in("sku_key", keys),
    // leitura-limitada: variantes do lote (até 100)
    admin.from("product_costs").select("shopify_variant_id,cost,package_weight_kg").in("shopify_variant_id", variantIds),
    // leitura-limitada: variantes do lote (até 100)
    admin.from("franchise_prices").select("shopify_variant_id,price").in("shopify_variant_id", variantIds),
    // leitura-limitada: variantes do lote (até 100)
    admin.from("subscriber_prices").select("shopify_variant_id,subscriber_price").in("shopify_variant_id", variantIds),
  ]);
  const error = snapshotResult.error || costResult.error || franchiseResult.error || subscriberResult.error;
  if (error) throw error;

  const rules = await loadSubscriberMarginRules(admin, [...new Set(items.map((item) => item.productId))]);
  const plans = planCatalogApply(
    items,
    (snapshotResult.data ?? []) as SnapshotRow[],
    {
      costs: new Map((costResult.data ?? []).map((row) => [row.shopify_variant_id, {
        cost: Number(row.cost),
        packageWeightKg: row.package_weight_kg === null ? null : Number(row.package_weight_kg),
      }])),
      franchise: new Map((franchiseResult.data ?? []).map((row) => [row.shopify_variant_id, Number(row.price)])),
      subscriber: new Map((subscriberResult.data ?? []).map((row) => [row.shopify_variant_id, Number(row.subscriber_price)])),
    },
    (productId, cost, weightKg) => derivedPricesFromCost(productId, cost, weightKg, rules),
  );

  const results = await runLimited(plans, APPLY_CONCURRENCY, async (plan) => {
    if (dryRun || plan.status !== "ok") return plan;
    try {
      const item = items.find((entry) => entry.variantId === plan.variantId)!;
      await applyProductCost(admin, item, plan.cost.after!, rules);
      return plan;
    } catch (applyError) {
      console.error("[admin-olist-catalog] aplicar", plan.sku, applyError);
      return { ...plan, status: "error" as const, error: applyError instanceof Error ? applyError.message : "Erro ao gravar" };
    }
  });

  if (!dryRun && runId) {
    await bumpRun(admin, runId, {
      applied: results.filter((result) => result.status === "ok").length,
      changed: results.filter((result) => result.status === "ok" && result.changed).length,
      failed: results.filter((result) => result.status === "error").length,
    });
  }
  return jsonResponse({ ok: true, version: FUNCTIONS_VERSION, runId, dryRun, results });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return errorResponse("JSON inválido", 400);
  }
  const action = String(body.action || "");
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token = Deno.env.get("OLIST_API_TOKEN") || Deno.env.get("TINY_API_TOKEN") || "";
  // Leitura do admin cede a vez ao checkout no limite de chamadas compartilhado.
  setOlistCallPriority("background");

  try {
    if (action === "catalog_page" || action === "price_lists") {
      if (!token) return jsonResponse({ ok: false, version: FUNCTIONS_VERSION, error: "Secret OLIST_API_TOKEN não configurado" });
      return action === "catalog_page"
        ? await catalogPage(admin, token, body, auth.auth.userId)
        : await priceLists(admin, token, body);
    }
    if (action === "finish") return await finishRun(admin, body);
    if (action === "apply") return await apply(admin, body, auth.auth.userId);
    return errorResponse("Ação inválida", 400);
  } catch (error) {
    console.error("[admin-olist-catalog]", action, error);
    if (isOlistRateLimitError(error)) {
      return jsonResponse({ ok: false, version: FUNCTIONS_VERSION, retryable: true, error: error instanceof Error ? error.message : "Limite da Olist" });
    }
    const message = error instanceof Error ? error.message : "Erro inesperado";
    return jsonResponse({ ok: false, version: FUNCTIONS_VERSION, error: message });
  }
});
