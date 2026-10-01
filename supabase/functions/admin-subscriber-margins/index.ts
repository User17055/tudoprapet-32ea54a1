import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { requireAdmin } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { priceFromCostAndMargin, subscriberMarginWithFeedRule } from "../_shared/subscriber-category.ts";

async function allRows(client: SupabaseClient, table: string, select: string) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0;; from += 1000) {
    const { data, error } = await client.from(table).select(select).range(from, from + 999);
    if (error) throw error;
    rows.push(...((data || []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < 1000) return rows;
  }
}

async function reprice(admin: SupabaseClient) {
  const [costs, categories, links, rules] = await Promise.all([
    allRows(admin, "product_costs", "shopify_product_id,shopify_variant_id,cost,package_weight_kg"),
    allRows(admin, "categories", "id,name,parent_id"),
    allRows(admin, "product_categories", "shopify_product_id,category_id"),
    allRows(admin, "subscriber_category_margins", "category_id,percent"),
  ]);
  const prices = costs.map((row) => {
    const productId = String(row.shopify_product_id || "");
    const cost = Number(row.cost);
    const packageWeightKg = row.package_weight_kg === null || row.package_weight_kg === undefined
      ? null
      : Number(row.package_weight_kg);
    const percent = subscriberMarginWithFeedRule(
      productId,
      packageWeightKg,
      categories as never[],
      links as never[],
      rules as never[],
    );
    return {
      shopify_product_id: productId,
      shopify_variant_id: String(row.shopify_variant_id),
      subscriber_price: priceFromCostAndMargin(cost, percent),
    };
  }).filter((row) => row.shopify_product_id && row.shopify_variant_id && Number.isFinite(row.subscriber_price));

  for (let index = 0; index < prices.length; index += 200) {
    const { error } = await admin.from("subscriber_prices")
      .upsert(prices.slice(index, index + 200), { onConflict: "shopify_variant_id" });
    if (error) throw error;
  }
  return prices.length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Metodo nao permitido", 405);
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "list");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (action === "save") {
      const categoryId = String(body.categoryId || "");
      const percent = Number(body.percent);
      if (!/^[0-9a-f-]{36}$/i.test(categoryId) || !Number.isFinite(percent) || percent < 0 || percent > 500) {
        return errorResponse("Categoria ou percentual invalido", 400);
      }
      const { error } = await admin.from("subscriber_category_margins")
        .upsert({ category_id: categoryId, percent }, { onConflict: "category_id" });
      if (error) throw error;
      return jsonResponse({ ok: true, repriced: await reprice(admin) });
    }

    if (action === "delete") {
      const categoryId = String(body.categoryId || "");
      if (!/^[0-9a-f-]{36}$/i.test(categoryId)) return errorResponse("Categoria invalida", 400);
      const { error } = await admin.from("subscriber_category_margins").delete().eq("category_id", categoryId);
      if (error) throw error;
      return jsonResponse({ ok: true, repriced: await reprice(admin) });
    }

    if (action === "reprice") return jsonResponse({ ok: true, repriced: await reprice(admin) });
    const [categories, rules] = await Promise.all([
      allRows(admin, "categories", "id,name,parent_id,sort_order"),
      allRows(admin, "subscriber_category_margins", "category_id,percent,updated_at"),
    ]);
    return jsonResponse({ ok: true, categories, rules });
  } catch (error) {
    console.error("admin-subscriber-margins:", error);
    return errorResponse("Nao foi possivel atualizar os percentuais de assinante", 500);
  }
});
