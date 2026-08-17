// Atualiza o preço "normal" (varejo) de uma variante na Shopify.
// Só admin autenticado — a identidade vem do JWT, nunca do corpo.

import { corsHeaders, errorResponse, FUNCTIONS_VERSION, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { ADMIN_API } from "../_shared/shopify.ts";

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

  // O token offline da integração nem sempre recebe write_products. O token online
  // do administrador pode ter o escopo, então tentamos ambos sem expor nenhum deles.
  const tokens = [
    Deno.env.get("SHOPIFY_ACCESS_TOKEN"),
    Deno.env.get("SHOPIFY_ONLINE_ACCESS_TOKEN:user:4HrJkQRl3KUXTrTOAgUkwQSkHWo2"),
  ].filter((token, index, all): token is string => Boolean(token) && all.indexOf(token) === index);
  if (!tokens.length) return errorResponse("Token Shopify ausente", 500);

  let result: { productVariants?: Array<{ id: string; price: string }>; userErrors?: Array<{ message: string }> } | null = null;
  let lastError = "A Shopify recusou a atualização do preço";

  for (const token of tokens) {
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
      lastError = `Shopify respondeu ${response.status}`;
      continue;
    }

    const graphqlErrors = data.errors as Array<{ message?: string }> | undefined;
    if (graphqlErrors?.length) {
      lastError = graphqlErrors.map((error) => error.message || "Erro na Shopify").join("; ");
      continue;
    }

    const mutationResult = data.data?.productVariantsBulkUpdate;
    if (mutationResult?.userErrors?.length) {
      return errorResponse(
        mutationResult.userErrors.map((error: { message: string }) => error.message).join("; "),
        400,
      );
    }

    result = mutationResult;
    break;
  }

  if (!result) return errorResponse(lastError, 502);

  return jsonResponse({
    ok: true,
    version: FUNCTIONS_VERSION,
    variant: result?.productVariants?.[0] ?? null,
  });
});
