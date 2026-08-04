import { handleSpecialPriceCheckout } from "../_shared/checkout.ts";

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
  })
);
