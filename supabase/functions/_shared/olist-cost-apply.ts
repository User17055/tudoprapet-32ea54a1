import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { fetchAllRowsResult } from "./fetch-all-rows.ts";
import { priceFromCostAndMargin, subscriberMarginWithFeedRule } from "./subscriber-category.ts";

/**
 * Grava um custo de produto e recalcula os preços que dependem dele. É a mesma
 * regra do botão "sincronizar custos" do admin, usada também pelo checkout de
 * franquia (custo buscado na hora) e pela revisão de preço:
 *  - product_costs + histórico quando o custo muda;
 *  - franquia: preserva preço de franquia >= custo; senão sobe até o custo;
 *  - assinante: custo + margem da categoria mais específica;
 *  - remove o override legado em customer_prices.
 */

export interface SubscriberMarginRules {
  categories: Array<{ id: string; name: string; parent_id: string | null }>;
  links: Array<{ shopify_product_id: string; category_id: string }>;
  rules: Array<{ category_id: string; percent: number }>;
}

export async function loadSubscriberMarginRules(
  admin: SupabaseClient,
  productIds: string[],
): Promise<SubscriberMarginRules> {
  const [categoryResult, linkResult, ruleResult] = await Promise.all([
    fetchAllRowsResult<{ id: string; name: string; parent_id: string | null }>(
      admin,
      "categories",
      "id,name,parent_id",
      { orderBy: "id" },
    ),
    fetchAllRowsResult<{ shopify_product_id: string; category_id: string }>(
      admin,
      "product_categories",
      "id,shopify_product_id,category_id",
      { orderBy: "id", filter: (query) => query.in("shopify_product_id", productIds) },
    ),
    fetchAllRowsResult<{ category_id: string; percent: number }>(
      admin,
      "subscriber_category_margins",
      "category_id,percent",
      { orderBy: "category_id" },
    ),
  ]);
  const error = categoryResult.error || linkResult.error || ruleResult.error;
  if (error) throw error;
  return {
    categories: categoryResult.data || [],
    links: linkResult.data || [],
    rules: ruleResult.data || [],
  };
}

export interface AppliedCost {
  cost: number;
  oldCost: number | null;
  costChanged: boolean;
  franchisePrice: number;
  subscriberPrice: number;
  subscriberMarginPercent: number;
  packageWeightKg: number | null;
}

export async function applyProductCost(
  admin: SupabaseClient,
  item: { productId: string; variantId: string; sku: string; weightKg?: number | null },
  cost: number,
  rules: SubscriberMarginRules,
  source: "olist" | "manual" = "olist",
): Promise<AppliedCost> {
  const { data: existingCost, error: existingCostError } = await admin
    .from("product_costs")
    .select("cost,previous_cost,cost_changed_at,package_weight_kg")
    .eq("shopify_variant_id", item.variantId)
    .maybeSingle();
  if (existingCostError) throw existingCostError;

  const oldCost = existingCost ? Number(existingCost.cost) : null;
  const packageWeightKg = item.weightKg ?? (existingCost?.package_weight_kg === null ||
      existingCost?.package_weight_kg === undefined
    ? null
    : Number(existingCost.package_weight_kg));
  const costChanged = oldCost === null || oldCost !== cost;
  const changedAt = new Date().toISOString();
  const { error: costError } = await admin.from("product_costs").upsert({
    shopify_product_id: item.productId,
    shopify_variant_id: item.variantId,
    sku: item.sku || null,
    cost,
    previous_cost: costChanged && oldCost !== null ? oldCost : existingCost?.previous_cost ?? null,
    cost_changed_at: costChanged && oldCost !== null
      ? changedAt
      : existingCost?.cost_changed_at ?? null,
    source,
    synced_at: changedAt,
    package_weight_kg: packageWeightKg,
  }, { onConflict: "shopify_variant_id" });
  if (costError) throw costError;

  if (costChanged) {
    const { error: historyError } = await admin.from("product_cost_history").insert({
      shopify_variant_id: item.variantId,
      old_cost: oldCost,
      new_cost: cost,
      source,
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

  // Preserva uma margem de franquia já cadastrada. Se não houver valor ou se
  // ele tiver ficado abaixo do novo custo, sobe somente até o custo.
  const currentFranchisePrice = existingFranchise ? Number(existingFranchise.price) : null;
  const franchisePrice = currentFranchisePrice !== null && currentFranchisePrice >= cost
    ? currentFranchisePrice
    : cost;
  const subscriberMarginPercent = subscriberMarginWithFeedRule(
    item.productId,
    packageWeightKg,
    rules.categories,
    rules.links,
    rules.rules,
  );
  const subscriberPrice = priceFromCostAndMargin(cost, subscriberMarginPercent);
  const { error: franchiseError } = await admin.from("franchise_prices").upsert({
    shopify_product_id: item.productId,
    shopify_variant_id: item.variantId,
    price: franchisePrice,
  }, { onConflict: "shopify_variant_id" });
  if (franchiseError) throw franchiseError;

  const { error: subscriberError } = await admin.from("subscriber_prices").upsert({
    shopify_product_id: item.productId,
    shopify_variant_id: item.variantId,
    subscriber_price: subscriberPrice,
  }, { onConflict: "shopify_variant_id" });
  if (subscriberError) throw subscriberError;

  // Versões anteriores da integração gravavam o preço calculado como preço
  // regular. Remover esse override devolve a venda normal para a Shopify.
  const { error: legacyCustomerPriceError } = await admin
    .from("customer_prices")
    .delete()
    .eq("shopify_variant_id", item.variantId);
  if (legacyCustomerPriceError) throw legacyCustomerPriceError;

  return {
    cost,
    oldCost,
    costChanged,
    franchisePrice,
    subscriberPrice,
    subscriberMarginPercent,
    packageWeightKg,
  };
}
