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

    // Fetch subscriber prices for all variants
    const variantIds = items.map((i) => i.variantId);
    const { data: subscriberPrices } = await adminClient
      .from("subscriber_prices")
      .select("shopify_variant_id, subscriber_price")
      .in("shopify_variant_id", variantIds);

    const priceMap = new Map<string, number>();
    for (const sp of subscriberPrices || []) {
      priceMap.set(sp.shopify_variant_id, sp.subscriber_price);
    }

    // Extract numeric variant IDs from GIDs for Admin API
    const draftOrderLines = items.map((item) => {
      const numericId = item.variantId.replace("gid://shopify/ProductVariant/", "");
      const subPrice = priceMap.get(item.variantId);
      const line: Record<string, unknown> = {
        variant_id: parseInt(numericId),
        quantity: item.quantity,
      };
      if (subPrice !== undefined) {
        line.applied_discount = {
          value_type: "fixed_amount",
          value: "0", // will be calculated after fetching original price
          description: "Desconto Clube TudoPraPet",
        };
        // We need to set the price directly
        line.price = subPrice.toString();
      }
      return line;
    });

    // Create draft order via Shopify Admin API
    const shopDomain = "petjoy-deals-hb8r9.myshopify.com";
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
