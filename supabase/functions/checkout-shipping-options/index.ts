import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { parseCheckoutAddress, parseCheckoutCustomer } from "../_shared/checkout-input.ts";
import { parseCheckoutItems } from "../_shared/validation.ts";
import { fetchShopifyDraftDeliveryOptions } from "../_shared/shopify.ts";
import { optionalCheckoutUser } from "../_shared/checkout-access.ts";
import { applyDeliveryPolicy } from "../_shared/shipping-policy.ts";

function shopifyToken(): string {
  return Deno.env.get("SHOPIFY_ACCESS_TOKEN") || Deno.env.get("SHOPIFY_ONLINE_ACCESS_TOKEN:user:4HrJkQRl3KUXTrTOAgUkwQSkHWo2") || "";
}

async function requestKey(req: Request, userId: string | null): Promise<string> {
  const forwarded = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId ? `shipping-user:${userId}` : `shipping-ip:${forwarded.trim()}`));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);
  try {
    const auth = await optionalCheckoutUser(req);
    if (auth.invalidAuthorization) return errorResponse("Sessão inválida", 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error: rateError } = await admin.rpc("consume_checkout_rate_limit", {
      p_key_hash: await requestKey(req, auth.user?.id ?? null), p_limit: 20, p_window_seconds: 600,
    });
    if (rateError) {
      const limited = rateError.message?.includes("checkout_rate_limit_exceeded");
      return errorResponse(limited ? "Muitas consultas de frete. Aguarde alguns minutos." : "Falha ao validar consulta", limited ? 429 : 500);
    }
    const body = await req.json() as Record<string, unknown>;
    const items = parseCheckoutItems(body.items);
    const customer = parseCheckoutCustomer(body.customer);
    const address = parseCheckoutAddress(body.address);
    if (!items.ok) return errorResponse(items.message, 400);
    if (!customer.ok) return errorResponse(customer.message, 400);
    if (!address.ok) return errorResponse(address.message, 400);
    const token = shopifyToken();
    if (!token) return errorResponse("Loja temporariamente indisponível. Tente novamente em instantes.", 500);
    const providerOptions = await fetchShopifyDraftDeliveryOptions({
      items: items.value,
      customerName: customer.value.name,
      phone: customer.value.mobilePhone,
      address: address.value,
    }, token);
    const options = applyDeliveryPolicy(address.value, providerOptions);
    if (!options.length) return errorResponse("Nenhuma forma de entrega disponível para este endereço", 409);
    return jsonResponse({ options });
  } catch (error) {
    console.error("checkout-shipping-options:", error);
    return errorResponse("Não foi possível calcular o frete", 500);
  }
});
