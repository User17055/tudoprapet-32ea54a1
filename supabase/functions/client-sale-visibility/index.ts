import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { fetchCurrentVariantPrices } from "../_shared/shopify.ts";

function readFirstEnv(keys: string[]) {
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value) return value;
  }
  return "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);

  try {
    const body = await req.json() as { variantIds?: unknown };
    if (!Array.isArray(body.variantIds) || body.variantIds.length > 500 ||
      body.variantIds.some((id) => typeof id !== "string" || !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id))) {
      return errorResponse("Variantes inválidas", 400);
    }
    const ids = [...new Set(body.variantIds as string[])];
    if (!ids.length) return jsonResponse({ blockedVariantIds: [] });

    const storefrontToken = readFirstEnv(["SHOPIFY_STOREFRONT_ACCESS_TOKEN", "SHOPIFY_STOREFRONT_TOKEN"]);
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!storefrontToken || !serviceKey || !supabaseUrl) return errorResponse("Configuração indisponível", 503);

    // O cliente informa apenas IDs. O preço é obtido da Shopify no servidor:
    // assim ninguém consegue usar esta rota para descobrir custos por tentativa.
    const prices = new Map<string, number>();
    for (let start = 0; start < ids.length; start += 100) {
      const current = await fetchCurrentVariantPrices(ids.slice(start, start + 100), storefrontToken);
      for (const [id, price] of current) prices.set(id, price);
    }
    // Variantes sem preço na Shopify (removidas/ocultas) não derrubam o lote: só não são avaliadas.

    const admin = createClient(supabaseUrl, serviceKey);
    const costRows: Array<{ shopify_variant_id: string; cost: number }> = [];
    const customerRows: Array<{ shopify_variant_id: string; price: number }> = [];
    // Lotes pequenos evitam URLs gigantes no filtro .in(); uma nova tentativa cobre falhas de rede.
    for (let start = 0; start < ids.length; start += 80) {
      const chunk = ids.slice(start, start + 80);
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const [costResult, customerResult] = await Promise.all([
          admin.from("product_costs").select("shopify_variant_id,cost").in("shopify_variant_id", chunk),
          admin.from("customer_prices").select("shopify_variant_id,price").in("shopify_variant_id", chunk),
        ]);
        lastError = costResult.error || customerResult.error;
        if (!lastError) {
          costRows.push(...(costResult.data || []));
          customerRows.push(...(customerResult.data || []));
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      if (lastError) throw lastError;
    }
    const customerPrices = new Map(customerRows.map((row) => [row.shopify_variant_id, Number(row.price)]));
    const blockedVariantIds = costRows.filter((row) => {
      const override = customerPrices.get(row.shopify_variant_id);
      const sale = override !== undefined && Number.isFinite(override) && override > 0
        ? override : prices.get(row.shopify_variant_id);
      return sale !== undefined && sale > 0 && Number(row.cost) >= sale;
    }).map((row) => row.shopify_variant_id);
    return jsonResponse({ blockedVariantIds });
  } catch (error) {
    console.error("[client-sale-visibility]", error);
    return errorResponse("Não foi possível verificar os produtos", 503);
  }
});
