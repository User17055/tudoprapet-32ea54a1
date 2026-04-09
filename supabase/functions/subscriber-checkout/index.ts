import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface LineItem {
  variantId: string; // Shopify GID
  quantity: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify user is a club member
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    // Try multiple token sources
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN") 
      || Deno.env.get("SHOPIFY_ONLINE_ACCESS_TOKEN:user:4HrJkQRl3KUXTrTOAgUkwQSkHWo2")
      || "";
    
    console.log("Token available:", !!shopifyToken, "Token length:", shopifyToken.length);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check club membership
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: member } = await adminClient
      .from("club_members")
      .select("is_active")
      .eq("email", user.email)
      .eq("is_active", true)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: "Você não é membro do clube" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { items } = await req.json() as { items: LineItem[] };
    if (!items?.length) {
      return new Response(JSON.stringify({ error: "Carrinho vazio" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shopDomain = "petjoy-deals-hb8r9.myshopify.com";

    // Fetch subscriber prices for all variants
    const variantIds = items.map((i) => i.variantId);
    const { data: subscriberPrices } = await adminClient
      .from("subscriber_prices")
      .select("shopify_variant_id, subscriber_price")
      .in("shopify_variant_id", variantIds);

    const priceMap = new Map<string, number>();
    for (const sp of subscriberPrices || []) {
      priceMap.set(sp.shopify_variant_id, Number(sp.subscriber_price));
    }

    const storefrontToken =
      Deno.env.get("SHOPIFY_STOREFRONT_ACCESS_TOKEN") ||
      Deno.env.get("SHOPIFY_STOREFRONT_TOKEN") ||
      "";

    const currentPriceMap = new Map<string, number>();

    if (storefrontToken) {
      const variantPriceResponse = await fetch(
        `https://${shopDomain}/api/2025-07/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Storefront-Access-Token": storefrontToken,
          },
          body: JSON.stringify({
            query: `
              query VariantPrices($ids: [ID!]!) {
                nodes(ids: $ids) {
                  ... on ProductVariant {
                    id
                    price {
                      amount
                    }
                  }
                }
              }
            `,
            variables: { ids: variantIds },
          }),
        }
      );

      if (variantPriceResponse.ok) {
        const variantPriceData = await variantPriceResponse.json();
        for (const node of variantPriceData?.data?.nodes || []) {
          const amount = Number(node?.price?.amount);
          if (node?.id && Number.isFinite(amount)) {
            currentPriceMap.set(node.id, amount);
          }
        }
      } else {
        console.error("Failed to fetch current variant prices");
      }
    }

    // Apply exact club discount based on current Shopify price
    const draftOrderLines = items.map((item) => {
      const numericId = item.variantId.replace("gid://shopify/ProductVariant/", "");
      const subPrice = priceMap.get(item.variantId);
      const currentPrice = currentPriceMap.get(item.variantId);
      const line: Record<string, unknown> = {
        variant_id: parseInt(numericId),
        quantity: item.quantity,
      };

      if (
        subPrice !== undefined &&
        currentPrice !== undefined &&
        currentPrice > subPrice
      ) {
        const discountPerUnit = Number((currentPrice - subPrice).toFixed(2));
        line.applied_discount = {
          value_type: "fixed_amount",
          value: discountPerUnit,
          amount: Number((discountPerUnit * item.quantity).toFixed(2)),
          description: "Desconto Clube TudoPraPet",
        };
      }

      return line;
    });

    // Create draft order via Shopify Admin API
    const draftOrderResponse = await fetch(
      `https://${shopDomain}/admin/api/2025-07/draft_orders.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": shopifyToken,
        },
        body: JSON.stringify({
          draft_order: {
            line_items: draftOrderLines,
            use_customer_default_address: true,
          },
        }),
      }
    );

    if (!draftOrderResponse.ok) {
      const errorText = await draftOrderResponse.text();
      console.error("Draft order creation failed:", errorText);
      return new Response(
        JSON.stringify({ error: "Falha ao criar pedido" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const draftOrderData = await draftOrderResponse.json();
    const invoiceUrl = draftOrderData.draft_order?.invoice_url;

    if (!invoiceUrl) {
      return new Response(
        JSON.stringify({ error: "Não foi possível gerar o link de checkout" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ checkoutUrl: invoiceUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
