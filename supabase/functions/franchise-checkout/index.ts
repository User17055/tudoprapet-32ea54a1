import { handleSpecialPriceCheckout } from "../_shared/checkout.ts";
import { errorResponse, jsonResponse } from "../_shared/cors.ts";
import { ensureFranchiseCosts, FRANCHISE_PRICE_BLOCKED_MESSAGE } from "../_shared/franchise-pricing.ts";
import { fetchVariantCheckoutDetails } from "../_shared/shopify.ts";

Deno.serve((req) =>
  handleSpecialPriceCheckout(req, {
    async isEligible(adminClient, user) {
      const { data: profile } = await adminClient
        .from("profiles")
        .select("is_franchisee")
        .eq("user_id", user.id)
        .maybeSingle();
      return !!profile?.is_franchisee;
    },
    ineligibleMessage: "Usuário não é franqueado",
    priceTable: "franchise_prices",
    priceColumn: "price",
    discountTitle: "Franquia TudoPraPet",
    orderTag: "franquia-tudoprapet",
    // Mantém o e-mail sem normalizar, como no código original desta função.
    buildNote: (user) => `Pedido franquia TudoPraPet - ${user.email}`,
    shopifyTokenEnvKeys: ["SHOPIFY_ACCESS_TOKEN"],
    // Franquia paga custo: sem custo e sem como buscá-lo, o item é bloqueado
    // em vez de seguir pelo preço cheio.
    async guardItems(adminClient, user, items, tokens) {
      if (!tokens.storefront) return errorResponse("Token Storefront ausente", 500);
      const details = await fetchVariantCheckoutDetails(
        items.map((item) => item.variantId),
        tokens.storefront,
        tokens.admin,
      );
      const { blocked } = await ensureFranchiseCosts(
        adminClient,
        items.flatMap((item) => {
          const detail = details.get(item.variantId);
          return detail
            ? [{
              variantId: item.variantId,
              productId: detail.productId,
              sku: detail.sku || "",
              title: detail.productTitle,
              catalogPrice: detail.price,
            }]
            : [];
        }),
        {
          token: Deno.env.get("OLIST_API_TOKEN") || Deno.env.get("TINY_API_TOKEN") || "",
          userId: user.id,
        },
      );
      return blocked.length
        ? jsonResponse({
          error: FRANCHISE_PRICE_BLOCKED_MESSAGE,
          code: "franchise_price_blocked",
          franchisePriceBlocked: blocked,
        })
        : null;
    },
  })
);
