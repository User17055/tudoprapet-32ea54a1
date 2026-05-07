import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey =
      Deno.env.get("SUPABASE_ANON_KEY") ||
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

    const shopifyToken =
      Deno.env.get("SHOPIFY_ACCESS_TOKEN") ||
      Deno.env.get("SHOPIFY_ONLINE_ACCESS_TOKEN:user:4HrJkQRl3KUXTrTOAgUkwQSkHWo2") ||
      "";

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
    if (authError || !user?.email) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const shopDomain = "petjoy-deals-hb8r9.myshopify.com";

    // Fetch orders for this email from Shopify Admin API
    const ordersUrl = `https://${shopDomain}/admin/api/2025-07/orders.json?email=${encodeURIComponent(
      user.email
    )}&status=any&limit=50`;

    const ordersResp = await fetch(ordersUrl, {
      headers: {
        "X-Shopify-Access-Token": shopifyToken,
        "Content-Type": "application/json",
      },
    });

    if (!ordersResp.ok) {
      const errText = await ordersResp.text();
      console.error("Shopify orders error:", errText);
      return new Response(JSON.stringify({ error: "Falha ao buscar pedidos" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ordersData = await ordersResp.json();
    const rawOrders = ordersData.orders || [];

    const orders = rawOrders.map((o: any) => {
      let savings = 0;
      const lineItems = (o.line_items || []).map((li: any) => {
        const price = Number(li.price || 0);
        const compareAt = Number(li.compare_at_price || 0);
        const qty = Number(li.quantity || 0);
        const lineDiscount = Number(li.total_discount || 0);
        let lineSavings = lineDiscount;
        if (compareAt > price) {
          lineSavings += (compareAt - price) * qty;
        }
        savings += lineSavings;
        return {
          title: li.title,
          variant_title: li.variant_title,
          quantity: qty,
          price,
          compare_at_price: compareAt || null,
          image: li.image_url || null,
          savings: Number(lineSavings.toFixed(2)),
        };
      });

      // Add order-level discounts not already in line totals
      const orderDiscounts = Number(o.total_discounts || 0);
      const lineDiscountsSum = (o.line_items || []).reduce(
        (s: number, li: any) => s + Number(li.total_discount || 0),
        0
      );
      const extraOrderDiscount = Math.max(0, orderDiscounts - lineDiscountsSum);
      savings += extraOrderDiscount;

      return {
        id: o.id,
        order_number: o.order_number || o.name,
        name: o.name,
        created_at: o.created_at,
        total_price: Number(o.total_price || 0),
        subtotal_price: Number(o.subtotal_price || 0),
        currency: o.currency,
        financial_status: o.financial_status,
        fulfillment_status: o.fulfillment_status,
        order_status_url: o.order_status_url,
        savings: Number(savings.toFixed(2)),
        line_items: lineItems,
      };
    });

    const totalSavings = orders.reduce(
      (s: number, o: any) => s + (o.savings || 0),
      0
    );
    const totalSpent = orders.reduce(
      (s: number, o: any) => s + (o.total_price || 0),
      0
    );

    return new Response(
      JSON.stringify({
        orders,
        total_savings: Number(totalSavings.toFixed(2)),
        total_spent: Number(totalSpent.toFixed(2)),
        count: orders.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
