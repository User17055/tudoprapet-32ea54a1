import { handleSpecialPriceCheckout } from "../_shared/checkout.ts";

Deno.serve((req) =>
  handleSpecialPriceCheckout(req, {
    async isEligible(adminClient, user) {
      const { data: member } = await adminClient
        .from("club_members")
        .select("is_active")
        .eq("email", user.email.toLowerCase())
        .eq("is_active", true)
        .maybeSingle();
      return !!member;
    },
    ineligibleMessage: "Você não é membro do clube",
    priceTable: "subscriber_prices",
    priceColumn: "subscriber_price",
    discountTitle: "Clube TudoPraPet",
    orderTag: "clube-tudoprapet",
    buildNote: (user) => `Pedido do Clube TudoPraPet - ${user.email.toLowerCase()}`,
    shopifyTokenEnvKeys: [
      "SHOPIFY_ACCESS_TOKEN",
      "SHOPIFY_ONLINE_ACCESS_TOKEN:user:4HrJkQRl3KUXTrTOAgUkwQSkHWo2",
    ],
  })
);
