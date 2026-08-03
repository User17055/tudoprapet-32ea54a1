// Fluxo de checkout com preço especial, compartilhado por subscriber-checkout
// e franchise-checkout. As duas diferem apenas na regra de elegibilidade,
// na tabela de preços e nos rótulos — tudo o mais é idêntico.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, jsonResponse } from "./cors.ts";
import { buildDraftLineItems } from "./pricing.ts";
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

    const specialPriceMap = new Map<string, number>();
    for (const row of (specialRows ?? []) as Record<string, unknown>[]) {
      specialPriceMap.set(String(row.shopify_variant_id), Number(row[config.priceColumn]));
    }

    if (!storefrontToken) return errorResponse("Token Storefront ausente", 500);

    const currentPriceMap = await fetchCurrentVariantPrices(variantIds, storefrontToken);

    const customerId = await findOrCreateCustomer(normalizedEmail, shopifyToken);
    if (!customerId) return errorResponse("Falha ao identificar cliente", 500);

    const lineItems = buildDraftLineItems(
      items,
      specialPriceMap,
      currentPriceMap,
      config.discountTitle,
    );

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
