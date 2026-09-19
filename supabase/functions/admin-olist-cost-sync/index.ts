// Importa o custo do ERP Olist pelo SKU e atualiza as tabelas de precos locais.
// Regra comercial: Shopify e a venda normal; assinante paga custo + 12% em
// racoes; franquia pode pagar o custo ou mais, mas nunca menos que o custo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { requireAdmin } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, FUNCTIONS_VERSION, jsonResponse } from "../_shared/cors.ts";
import { fetchOlistCostBySku, normalizeSku, roundMoney } from "../_shared/olist.ts";

type SyncItem = {
  productId?: string;
  variantId?: string;
  sku?: string;
  isFeed?: boolean;
};

const MAX_ITEMS = 25;
const OLIST_MIN_INTERVAL_MS = 2100;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Metodo nao permitido", 405);

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const token = Deno.env.get("OLIST_API_TOKEN") || Deno.env.get("TINY_API_TOKEN") || "";
  if (!token) {
    return jsonResponse({ ok: false, version: FUNCTIONS_VERSION, error: "Secret OLIST_API_TOKEN nao configurado" });
  }

  let body: { items?: SyncItem[] };
  try {
    body = await req.json();
  } catch {
    return errorResponse("JSON invalido", 400);
  }
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_ITEMS) {
    return errorResponse(`Envie de 1 a ${MAX_ITEMS} itens`, 400);
  }

  const items = body.items.map((item) => ({
    productId: String(item.productId || ""),
    variantId: String(item.variantId || ""),
    sku: String(item.sku || "").trim(),
    isFeed: item.isFeed === true,
  }));
  const invalid = items.find((item) =>
    !item.productId.startsWith("gid://shopify/Product/") ||
    !item.variantId.startsWith("gid://shopify/ProductVariant/") ||
    !normalizeSku(item.sku)
  );
  if (invalid) return errorResponse("Produto, variante ou SKU invalido", 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const results: Array<Record<string, unknown>> = [];

  // Sequencial de proposito: evita rajadas na API do ERP e preserva a ordem do relatorio.
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    try {
      // O menor plano atual com API permite 30 chamadas/minuto. A pausa mantem
      // a importacao em ate 28 chamadas/minuto e evita respostas 429.
      if (index > 0) await wait(OLIST_MIN_INTERVAL_MS);
      const product = await fetchOlistCostBySku(item.sku, token);
      if (!product) {
        results.push({ sku: item.sku, variantId: item.variantId, status: "not_found" });
        continue;
      }

      const { data: existingCost, error: existingCostError } = await admin
        .from("product_costs")
        .select("cost,previous_cost,cost_changed_at")
        .eq("shopify_variant_id", item.variantId)
        .maybeSingle();
      if (existingCostError) throw existingCostError;

      const oldCost = existingCost ? Number(existingCost.cost) : null;
      const costChanged = oldCost === null || oldCost !== product.cost;
      const changedAt = new Date().toISOString();
      const { error: costError } = await admin.from("product_costs").upsert({
        shopify_product_id: item.productId,
        shopify_variant_id: item.variantId,
        sku: item.sku,
        cost: product.cost,
        previous_cost: costChanged && oldCost !== null ? oldCost : existingCost?.previous_cost ?? null,
        cost_changed_at: costChanged && oldCost !== null ? changedAt : existingCost?.cost_changed_at ?? null,
        source: "olist",
        synced_at: changedAt,
      }, { onConflict: "shopify_variant_id" });
      if (costError) throw costError;

      if (costChanged) {
        const { error: historyError } = await admin.from("product_cost_history").insert({
          shopify_variant_id: item.variantId,
          old_cost: oldCost,
          new_cost: product.cost,
          source: "olist",
          changed_at: changedAt,
        });
        if (historyError) throw historyError;
      }

      const { data: existingFranchise, error: existingFranchiseError } = await admin
        .from("franchise_prices")
        .select("price")
        .eq("shopify_variant_id", item.variantId)
        .maybeSingle();
      if (existingFranchiseError) throw existingFranchiseError;

      // Preserva uma margem de franquia ja cadastrada. Se nao houver valor ou
      // se ele tiver ficado abaixo do novo custo, sobe somente ate o custo.
      const currentFranchisePrice = existingFranchise ? Number(existingFranchise.price) : null;
      const franchisePrice = currentFranchisePrice !== null && currentFranchisePrice >= product.cost
        ? currentFranchisePrice
        : product.cost;
      const subscriberPrice = item.isFeed ? roundMoney(product.cost * 1.12) : null;
      const { error: franchiseError } = await admin.from("franchise_prices").upsert({
        shopify_product_id: item.productId,
        shopify_variant_id: item.variantId,
        price: franchisePrice,
      }, { onConflict: "shopify_variant_id" });
      if (franchiseError) throw franchiseError;

      if (subscriberPrice !== null) {
        const { error: subscriberError } = await admin.from("subscriber_prices").upsert({
          shopify_product_id: item.productId,
          shopify_variant_id: item.variantId,
          subscriber_price: subscriberPrice,
        }, { onConflict: "shopify_variant_id" });
        if (subscriberError) throw subscriberError;

        // Versoes anteriores da integracao gravavam custo + 12% como preco
        // regular. Remover esse override devolve a venda normal para a Shopify.
        const { error: legacyCustomerPriceError } = await admin
          .from("customer_prices")
          .delete()
          .eq("shopify_variant_id", item.variantId);
        if (legacyCustomerPriceError) throw legacyCustomerPriceError;
      }

      results.push({
        sku: item.sku,
        variantId: item.variantId,
        status: "updated",
        olistProductId: product.id,
        olistName: product.name,
        cost: product.cost,
        previousCost: oldCost,
        costChanged,
        costIncreased: oldCost !== null && product.cost > oldCost,
        franchisePrice,
        subscriberPrice,
      });
    } catch (error) {
      console.error("[admin-olist-cost-sync]", item.sku, error);
      results.push({
        sku: item.sku,
        variantId: item.variantId,
        status: "error",
        error: error instanceof Error ? error.message : "Erro inesperado",
      });
    }
  }

  return jsonResponse({
    ok: true,
    version: FUNCTIONS_VERSION,
    updated: results.filter((item) => item.status === "updated").length,
    notFound: results.filter((item) => item.status === "not_found").length,
    failed: results.filter((item) => item.status === "error").length,
    results,
  });
});
