import { fetchAllRowsResult } from "../_shared/fetch-all-rows.ts";
// Valores pela Olist em duas etapas (26/11/2026):
//  1. Ler: baixa o catálogo inteiro da Olist (~8 chamadas de 100 produtos) e as
//     listas de preço (~15 chamadas) para um retrato no banco. Cada pedido faz
//     UMA chamada à Olist: a leitura inteira (~23) passa do limite por minuto
//     das automações, então a tela espera o tempo devolvido e continua;
//  2. Aplicar: grava custo, franquia e assinante a partir do retrato para os
//     itens escolhidos, sem chamar a Olist (mesma regra de applyProductCost).
// Mão única: nada aqui grava na Olist. Antes eram ~765 chamadas e ~27 minutos.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { requireAdmin } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, FUNCTIONS_VERSION, jsonResponse } from "../_shared/cors.ts";
import {
  fetchOlistCatalogPage,
  fetchOlistPriceListExceptionsPage,
  fetchOlistPriceLists,
  normalizeOlistId,
  normalizeSku,
  OlistRateLimitError,
  setOlistCallPriority,
} from "../_shared/olist.ts";
import {

  derivedPricesFromCost,
  loadSubscriberMarginRules,
} from "../_shared/olist-cost-apply.ts";
import { effectiveListPrice, priceListIds, positiveMoney } from "../_shared/olist-list-values.ts";
import { planCatalogApply, type CatalogApplyItem, type SnapshotRow } from "../_shared/olist-catalog.ts";

const MAX_APPLY_ITEMS = 100;
const APPLY_CONCURRENCY = 4;
const MAX_CATALOG_PAGES = 100;
const MAX_EXCEPTION_PAGES = 100;
// "API Bloqueada" da própria Olist: o limitador compartilhado para por 90 s.
const OLIST_BLOCK_WAIT_MS = 90_000;

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
    const { error } = await admin.from("olist_product_snapshot_stage").upsert(part, { onConflict: "run_id,olist_product_id" });
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
  for (const list of lists) {
    const { error } = await admin.from("olist_price_lists_stage").upsert({
      olist_price_list_id: list.id,
      name: list.name,
      adjustment_percent: list.adjustmentPercent,
      run_id: runId,
      fetched_at: fetchedAt,
    }, { onConflict: "run_id,olist_price_list_id" });
    if (error) throw error;
  }
  const { error: runError } = await admin.from("olist_catalog_runs").update({ price_lists: lists.length }).eq("id", runId);
  if (runError) throw runError;
  return jsonResponse({
    ok: true,
    version: FUNCTIONS_VERSION,
    runId,
    lists: lists.length,
    priceLists: lists.map((list) => ({ id: list.id, name: list.name })),
  });
}

/** Uma página das exceções de uma lista; as que sumiram saem no finish. */
async function priceListPage(admin: SupabaseClient, token: string, body: Body) {
  const runId = validRunId(body.runId);
  if (!runId) return errorResponse("Execução inválida", 400);
  const listId = normalizeOlistId(body.listId);
  if (!listId) return errorResponse("Lista inválida", 400);
  const page = Number(body.page);
  if (!Number.isInteger(page) || page < 1 || page > MAX_EXCEPTION_PAGES) return errorResponse("Página inválida", 400);
  const { data: list, error: listError } = await admin.from("olist_price_lists_stage")
    .select("olist_price_list_id")
    .eq("olist_price_list_id", listId)
    .eq("run_id", runId)
    .maybeSingle();
  if (listError) throw listError;
  if (!list) return errorResponse("Lista não lida nesta execução", 400);

  const result = await fetchOlistPriceListExceptionsPage(token, listId, page);
  const fetchedAt = new Date().toISOString();
  const rows = [...new Map(result.exceptions.map((entry) => [entry.productId, entry])).values()].map((entry) => ({
    olist_price_list_id: listId,
    olist_product_id: entry.productId,
    price: entry.price,
    promo_price: entry.promoPrice,
    run_id: runId,
    fetched_at: fetchedAt,
  }));
  for (const part of chunks(rows, 500)) {
    const { error } = await admin.from("olist_price_list_exceptions_stage")
      .upsert(part, { onConflict: "run_id,olist_price_list_id,olist_product_id" });
    if (error) throw error;
  }
  return jsonResponse({
    ok: true,
    version: FUNCTIONS_VERSION,
    runId,
    listId,
    page,
    totalPages: result.totalPages,
    exceptions: rows.length,
  });
}

async function countRows(admin: SupabaseClient, table: string, runId: string): Promise<number> {
  const { count, error } = await admin.from(table).select("run_id", { count: "exact", head: true }).eq("run_id", runId);
  if (error) throw error;
  return count ?? 0;
}

async function finishRun(admin: SupabaseClient, body: Body) {
  const runId = validRunId(body.runId);
  if (!runId) return errorResponse("Execução inválida", 400);
  let failed = typeof body.error === "string" && body.error.trim() !== "";
  let failure = failed ? String(body.error) : "";
  const { data: run, error } = await admin.from("olist_catalog_runs").select("kind,status,products").eq("id", runId).maybeSingle();
  if (error) throw error;
  if (!run) return errorResponse("Execução não encontrada", 404);
  if (run.status === "done") return jsonResponse({ ok: true, runId, failed: false });
  if (run.kind === "catalog") {
    // Conta o que de fato entrou: uma página repetida depois de uma falha de
    // rede não pode contar em dobro.
    const products = await countRows(admin, "olist_product_snapshot_stage", runId);
    const exceptions = await countRows(admin, "olist_price_list_exceptions_stage", runId);
    const { error: countError } = await admin.from("olist_catalog_runs").update({ products, exceptions }).eq("id", runId);
    if (countError) throw countError;
    run.products = products;
  }
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
    const { error } = await admin.rpc("publish_olist_catalog", { p_run: runId });
    if (error) throw error;
    return jsonResponse({ ok: true, runId, failed: false });
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
    shopifyPrice: positiveMoney(item?.shopifyPrice),
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
  const [snapshotResult, costResult, franchiseResult, subscriberResult, customerResult, listResult] = await Promise.all([
    fetchAllRowsResult<SnapshotRow & { price: number | null; promo_price: number | null }>(admin,
      "olist_product_snapshot", "olist_product_id,sku,sku_key,name,cost,status,price,promo_price,run_id,fetched_at",
      { orderBy: "olist_product_id", filter: query => query.in("sku_key", keys) }),
    // leitura-limitada: variantes do lote (até 100)
    admin.from("product_costs").select("shopify_variant_id,cost,package_weight_kg").in("shopify_variant_id", variantIds),
    // leitura-limitada: variantes do lote (até 100)
    admin.from("franchise_prices").select("shopify_variant_id,price").in("shopify_variant_id", variantIds),
    // leitura-limitada: variantes do lote (até 100)
    admin.from("subscriber_prices").select("shopify_variant_id,subscriber_price").in("shopify_variant_id", variantIds),
    // leitura-limitada: até 100 variantes selecionadas.
    admin.from("customer_prices").select("shopify_variant_id,price").in("shopify_variant_id", variantIds),
    // leitura-limitada: somente os dois IDs de lista configurados.
    admin.from("olist_price_lists").select("olist_price_list_id,adjustment_percent,run_id").in("olist_price_list_id", Object.values(priceListIds)),
  ]);
  const error = customerResult.error || listResult.error || snapshotResult.error || costResult.error || franchiseResult.error || subscriberResult.error;
  if (error) throw error;

  const rules = await loadSubscriberMarginRules(admin, [...new Set(items.map((item) => item.productId))]);
  const products = snapshotResult.data ?? [];
  const productIds = products.map(row => row.olist_product_id);
  const exceptionsByProduct = new Map<string, { price: number | null; promoPrice: number | null; runId: string }>();
  for (const ids of chunks(productIds, 100)) {
    // leitura-limitada: até 100 produtos e duas listas (200 exceções).
    const { data, error } = await admin.from("olist_price_list_exceptions")
      .select("olist_product_id,olist_price_list_id,price,promo_price,run_id")
      .in("olist_price_list_id", Object.values(priceListIds)).in("olist_product_id", ids);
    if (error) throw error;
    for (const entry of data ?? []) {
      exceptionsByProduct.set(entry.olist_price_list_id + "|" + entry.olist_product_id,
        { price: entry.price, promoPrice: entry.promo_price, runId: entry.run_id });
    }
  }
  const { data: latest, error: latestError } = await admin.from("olist_catalog_runs")
    .select("id").eq("kind", "catalog").eq("status", "done").order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (latestError) throw latestError;
  if (!latest || latest.id !== body.catalogId || products.some(row => row.run_id !== latest.id) ||
      listResult.data?.some(row => row.run_id !== latest.id) || [...exceptionsByProduct.values()].some(row => row.runId !== latest.id)) {
    throw new Error("O catálogo mudou ou está incompleto. Atualize a aba e simule novamente.");
  }
  const snapshot = products.map(row => {
    const sale = positiveMoney(row.promo_price) ?? positiveMoney(row.price);
    const priceFor = (id: string) => {
      const list = listResult.data?.find(list => list.olist_price_list_id === id && list.run_id === row.run_id);
      const exception = exceptionsByProduct.get(id + "|" + row.olist_product_id);
      return effectiveListPrice(sale, list ? Number(list.adjustment_percent) : undefined, exception);
    };
    return { ...row, sale, franchiseList: priceFor(priceListIds.franchise), subscriberList: priceFor(priceListIds.subscriber) };
  });
  const plans = planCatalogApply(
    items,
    snapshot as SnapshotRow[],
    {
      customers: new Map((customerResult.data ?? []).map(row => [row.shopify_variant_id, Number(row.price)])),
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
      const expected = (body.expected as Record<string, string> | undefined)?.[plan.variantId];
      if (expected !== JSON.stringify(plan)) throw new Error("Os valores mudaram ou a simulação expirou. Simule novamente.");
      const values: Record<string, unknown> = {};
      for (const key of ["cost", "franchise", "subscriber"] as const) {
        if (plan[key].after !== null) values[key] = plan[key].after;
      }
      if (plan.sale.after !== null && plan.sale.before !== plan.sale.after) values.customer = plan.sale.after;
      values.franchiseOrigin = plan.franchiseOrigin;
      values.subscriberOrigin = plan.subscriberOrigin;
      const { error } = await admin.rpc("save_variant_values", {
        p_product: item.productId, p_variant: item.variantId, p_sku: item.sku, p_values: values,
        p_origin: "olist", p_checked: plan.fetchedAt, p_weight: item.weightKg, p_catalog: plan.catalogId,
        p_before: { cost: plan.cost.before, franchise: plan.franchise.before, subscriber: plan.subscriber.before, customer: plan.customerBefore },
      });
      if (error) throw new Error(error.message);
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
    if (action === "catalog_page" || action === "price_lists" || action === "price_list_page") {
      if (!token) return jsonResponse({ ok: false, version: FUNCTIONS_VERSION, error: "Secret OLIST_API_TOKEN não configurado" });
      if (action === "catalog_page") return await catalogPage(admin, token, body, auth.auth.userId);
      if (action === "price_lists") return await priceLists(admin, token, body);
      return await priceListPage(admin, token, body);
    }
    if (action === "finish") return await finishRun(admin, body);
    if (action === "manual") {
      const item = body.item as CatalogApplyItem;
      if (!item?.productId?.startsWith("gid://shopify/Product/") || !item.variantId?.startsWith("gid://shopify/ProductVariant/")) return errorResponse("Variante inválida", 400);
      const values = body.values as Record<string, unknown>;
      if (!values || !Object.entries(values).every(([key,value]) => ["customer","subscriber","franchise","cost"].includes(key) &&
        ((key !== "cost" && value === null) || (typeof value === "number" && Number.isFinite(value) && value > 0)))) return errorResponse("Valores inválidos", 400);
      const { error } = await admin.rpc("save_variant_values", { p_product: item.productId, p_variant: item.variantId, p_sku: item.sku ?? "", p_values: values, p_origin: "manual" });
      if (error) throw new Error(error.message);
      return jsonResponse({ ok: true });
    }
    if (action === "apply") return await apply(admin, body, auth.auth.userId);
    return errorResponse("Ação inválida", 400);
  } catch (error) {
    console.error("[admin-olist-catalog]", action, error);
    const message = error instanceof Error ? error.message : "Erro inesperado";
    // Limite por minuto cheio (o checkout tem prioridade) ou Olist bloqueada:
    // a tela espera o tempo devolvido e repete só este pedido.
    const retryAfterMs = error instanceof OlistRateLimitError
      ? error.waitMs
      : message.includes("API Bloqueada") ? OLIST_BLOCK_WAIT_MS : null;
    if (retryAfterMs !== null) {
      return jsonResponse({ ok: false, version: FUNCTIONS_VERSION, retryable: true, retryAfterMs, error: message });
    }
    return jsonResponse({ ok: false, version: FUNCTIONS_VERSION, error: message });
  }
});
