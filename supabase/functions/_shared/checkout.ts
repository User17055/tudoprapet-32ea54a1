// Fluxo de checkout com preço especial, compartilhado por subscriber-checkout
// e franchise-checkout. As duas diferem apenas na regra de elegibilidade,
// na tabela de preços e nos rótulos — tudo o mais é idêntico.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, jsonResponse } from "./cors.ts";
import {
  applyCostFloor,
  buildDraftLineItems,
  buildPriceAdjustmentLine,
  findUnpricedVariants,
  resolveUnitPrice,
} from "./pricing.ts";
import { createDraftOrder, fetchCurrentVariantPrices, findOrCreateCustomer } from "./shopify.ts";
import { parseCheckoutItems } from "./validation.ts";

export interface CheckoutUser {
  id: string;
  email: string;
}

export interface SpecialPriceCheckoutConfig {
  /** Decide se o usuário pode usar este checkout. false → 403. */
  isEligible(adminClient: SupabaseClient, user: CheckoutUser): Promise<boolean>;
  ineligibleMessage: string;
  /** Tabela e coluna do preço especial (ex.: subscriber_prices / subscriber_price). */
  priceTable: string;
  priceColumn: string;
  /** Rótulo do desconto na linha do pedido. */
  discountTitle: string;
  orderTag: string;
  buildNote(user: CheckoutUser): string;
  /** Env vars do token Admin, na ordem de preferência. */
  shopifyTokenEnvKeys: string[];
}

function readFirstEnv(keys: string[]): string {
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value) return value;
  }
  return "";
}

export async function handleSpecialPriceCheckout(
  req: Request,
  config: SpecialPriceCheckoutConfig,
): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const shopifyToken = readFirstEnv(config.shopifyTokenEnvKeys);
    const storefrontToken = readFirstEnv([
      "SHOPIFY_STOREFRONT_ACCESS_TOKEN",
      "SHOPIFY_STOREFRONT_TOKEN",
    ]);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse("Não autorizado", 401);

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user?.email) return errorResponse("Não autorizado", 401);

    const checkoutUser: CheckoutUser = { id: user.id, email: user.email };
    const normalizedEmail = user.email.toLowerCase();

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    if (!(await config.isEligible(adminClient, checkoutUser))) {
      return errorResponse(config.ineligibleMessage, 403);
    }

    const body = await req.json() as { items?: unknown };
    const parsed = parseCheckoutItems(body?.items);
    if (!parsed.ok) return errorResponse(parsed.message, 400);
    const items = parsed.value;

    const variantIds = items.map((i) => i.variantId);
    const { data: specialRows } = await adminClient
      .from(config.priceTable)
      .select(`shopify_variant_id, ${config.priceColumn}`)
      .in("shopify_variant_id", variantIds);

    // O nome da coluna é dinâmico (subscriber_price / price), então o parser de
    // tipos do postgrest-js não consegue inferir a linha e devolve um
    // ParserError. O cast passa por unknown de propósito.
    const specialPriceMap = new Map<string, number>();
    for (const row of (specialRows ?? []) as unknown as Record<string, unknown>[]) {
      specialPriceMap.set(String(row.shopify_variant_id), Number(row[config.priceColumn]));
    }

    const { data: customerRows } = await adminClient
      .from("customer_prices")
      .select("shopify_variant_id,price")
      .in("shopify_variant_id", variantIds);
    // O valor cadastrado em Valores é o preço regular exibido no site. O preço
    // de perfil (clube/franquia) só vale quando é menor que ele.
    const customerPriceMap = new Map<string, number>();
    for (const row of customerRows ?? []) {
      const customerPrice = Number(row.price);
      if (!Number.isFinite(customerPrice) || customerPrice <= 0) continue;
      customerPriceMap.set(row.shopify_variant_id, customerPrice);
      const profilePrice = specialPriceMap.get(row.shopify_variant_id);
      if (profilePrice === undefined || customerPrice < profilePrice) {
        specialPriceMap.set(row.shopify_variant_id, customerPrice);
      }
    }

    const costFloorMap = new Map<string, number>();
    if (config.priceTable === "franchise_prices") {
      const { data: costRows } = await adminClient
        .from("product_costs")
        .select("shopify_variant_id,cost")
        .in("shopify_variant_id", variantIds);
      for (const row of costRows ?? []) {
        const cost = Number(row.cost);
        if (!Number.isFinite(cost) || cost <= 0) continue;
        costFloorMap.set(row.shopify_variant_id, cost);
        const current = specialPriceMap.get(row.shopify_variant_id)
          ?? customerPriceMap.get(row.shopify_variant_id);
        // Quando nao ha nenhum preco local, o piso e aplicado depois de buscar
        // o valor atual da Shopify, no laco que monta finalPriceMap.
        if (current !== undefined && current < cost) specialPriceMap.set(row.shopify_variant_id, cost);
      }
    }

    if (!storefrontToken) return errorResponse("Token Storefront ausente", 500);

    const currentPriceMap = await fetchCurrentVariantPrices(variantIds, storefrontToken);

    const customerId = await findOrCreateCustomer(normalizedEmail, shopifyToken);
    if (!customerId) return errorResponse("Falha ao identificar cliente", 500);

    // Preço final por variante: o menor entre o preço de perfil e o preço
    // regular do sistema; sem nenhum dos dois, o da Shopify.
    const finalPriceMap = new Map<string, number>();
    for (const item of items) {
      const base = customerPriceMap.get(item.variantId) ?? currentPriceMap.get(item.variantId);
      let profilePrice = specialPriceMap.get(item.variantId);
      if (config.priceTable === "franchise_prices") {
        const cost = costFloorMap.get(item.variantId);
        if (cost !== undefined && (profilePrice === undefined || profilePrice < cost)) {
          profilePrice = cost;
        }
      }
      const resolved = resolveUnitPrice(base, profilePrice);
      const costFloor = config.priceTable === "franchise_prices" ? costFloorMap.get(item.variantId) : undefined;
      const final = applyCostFloor(resolved, costFloor);
      if (final !== undefined) finalPriceMap.set(item.variantId, final);
    }

    const lineItems = buildDraftLineItems(
      items,
      finalPriceMap,
      currentPriceMap,
      config.discountTitle,
    );
    const adjustmentLine = buildPriceAdjustmentLine(items, finalPriceMap, currentPriceMap);
    if (adjustmentLine) lineItems.push(adjustmentLine);

    // Diferente do checkout próprio, aqui os itens NÃO passam por um filtro de
    // disponibilidade antes da precificação: parseCheckoutItems valida o formato,
    // não a existência na Shopify. Então uma variante pode chegar até aqui sem
    // preço nativo, e nesse caso o ajuste não consegue cobrar a diferença --
    // volta a divergência silenciosa. Não dá para corrigir sem inventar preço;
    // dá para não deixar passar em branco.
    for (const variantId of findUnpricedVariants(items, finalPriceMap, currentPriceMap)) {
      console.error(
        `${config.orderTag}: variante ${variantId} sem preço da Shopify. O valor de ${finalPriceMap.get(variantId)?.toFixed(2)} não entra na linha de ajuste e o pedido pode registrar menos do que foi anunciado.`,
      );
    }

    const { requestOk, invoiceUrl } = await createDraftOrder({
      line_items: lineItems,
      customer: { id: customerId },
      email: normalizedEmail,
      use_customer_default_address: true,
      tags: config.orderTag,
      note: config.buildNote(checkoutUser),
    }, shopifyToken);

    if (!requestOk) return errorResponse("Falha ao criar pedido", 500);
    if (!invoiceUrl) return errorResponse("Link de checkout indisponível", 500);

    return jsonResponse({ checkoutUrl: invoiceUrl });
  } catch (error) {
    console.error("Error:", error);
    return errorResponse("Erro interno", 500);
  }
}
