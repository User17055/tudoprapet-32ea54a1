// Atualiza o preço "normal" (varejo) de uma variante na Shopify.
// Só admin autenticado — a identidade vem do JWT, nunca do corpo.

import { corsHeaders, errorResponse, FUNCTIONS_VERSION, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { ADMIN_API, shopifyAdminToken } from "../_shared/shopify.ts";

const MUTATION = `
  mutation SetVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  let body: { productId?: string; variantId?: string; price?: number | string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("JSON inválido", 400);
  }

  const productId = String(body.productId || "");
  const variantId = String(body.variantId || "");
  const price = Number(String(body.price ?? "").replace(",", "."));

  if (!productId.startsWith("gid://shopify/Product/")) return errorResponse("productId inválido", 400);
  if (!variantId.startsWith("gid://shopify/ProductVariant/")) return errorResponse("variantId inválido", 400);
  if (!Number.isFinite(price) || price <= 0) return errorResponse("Preço inválido", 400);

  const token = shopifyAdminToken();
  if (!token) return errorResponse("Token Shopify ausente", 500);

  const response = await fetch(`${ADMIN_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: MUTATION,
      variables: {
        productId,
        variants: [{ id: variantId, price: price.toFixed(2) }],
      },
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    return errorResponse(`Shopify respondeu ${response.status}`, 502);
  }
  const graphqlErrors = data.errors;
  if (graphqlErrors?.length) {
    return errorResponse(graphqlErrors.map((e: { message: string }) => e.message).join("; "), 502);
  }
  const result = data.data?.productVariantsBulkUpdate;
  if (result?.userErrors?.length) {
    return errorResponse(result.userErrors.map((e: { message: string }) => e.message).join("; "), 400);
  }

  return jsonResponse({
    ok: true,
    version: FUNCTIONS_VERSION,
    variant: result?.productVariants?.[0] ?? null,
  });
});
