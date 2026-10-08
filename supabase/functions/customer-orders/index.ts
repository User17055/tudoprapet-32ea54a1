import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "../_shared/cors.ts";
import { shouldShowCustomerOrder } from "../_shared/customer-order-visibility.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

    // O checkout próprio vincula o pedido ao usuário pela sessão. Esse
    // vínculo é mais confiável do que depender do Customer/e-mail da Shopify.
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: linkedSessions, error: linkedError } = await admin
      .from("checkout_sessions")
      .select("shopify_order_id, customer_type, status")
      .eq("user_id", user.id)
      .not("shopify_order_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(250);
    if (linkedError) throw linkedError;
    const numericOrderId = (value: unknown) =>
      String(value || "").split("/").pop()?.replace(/\D/g, "") || "";
    const linkedOrderIds = [...new Set((linkedSessions ?? [])
      .map((row) => numericOrderId(row.shopify_order_id))
      .filter(Boolean))];
    const linkedSessionsByOrderId = new Map((linkedSessions ?? []).map((row) => [
      numericOrderId(row.shopify_order_id),
      row,
    ]));

    const emailOrdersUrl = `https://${shopDomain}/admin/api/2025-07/orders.json?email=${encodeURIComponent(
      user.email
    )}&status=any&limit=50`;
    const linkedOrdersUrl = linkedOrderIds.length
      ? `https://${shopDomain}/admin/api/2025-07/orders.json?ids=${encodeURIComponent(linkedOrderIds.join(","))}&status=any&limit=250`
      : null;
    const fetchOrders = (url: string) => fetch(url, {
      headers: {
        "X-Shopify-Access-Token": shopifyToken,
        "Content-Type": "application/json",
      },
    });
    const [emailOrdersResp, linkedOrdersResp] = await Promise.all([
      fetchOrders(emailOrdersUrl),
      linkedOrdersUrl ? fetchOrders(linkedOrdersUrl) : Promise.resolve(null),
    ]);

    if (!emailOrdersResp.ok) {
      console.error("Shopify email orders error:", await emailOrdersResp.text());
    }
    if (linkedOrdersResp && !linkedOrdersResp.ok) {
      console.error("Shopify linked orders error:", await linkedOrdersResp.text());
    }
    if (!emailOrdersResp.ok && (!linkedOrdersResp || !linkedOrdersResp.ok)) {
      return new Response(JSON.stringify({ error: "Falha ao buscar pedidos" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailOrdersData = emailOrdersResp.ok ? await emailOrdersResp.json() : { orders: [] };
    const linkedOrdersData = linkedOrdersResp?.ok ? await linkedOrdersResp.json() : { orders: [] };
    const ordersById = new Map<string, any>();
    for (const order of [...(emailOrdersData.orders || []), ...(linkedOrdersData.orders || [])]) {
      ordersById.set(String(order.id), order);
    }
    const rawOrders = [...ordersById.values()]
      .sort((a: any, b: any) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""));

    const validatedRaw = rawOrders.filter((o: any) => {
      const linkedSession = linkedSessionsByOrderId.get(String(o.id));
      return shouldShowCustomerOrder({
        financialStatus: String(o.financial_status || ""),
        cancelled: Boolean(o.cancelled_at),
        linkedCustomerType: linkedSession?.customer_type,
        linkedSessionStatus: linkedSession?.status,
      });
    });


    const orders = validatedRaw.map((o: any) => {
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

      const fs = (o.financial_status || "").toLowerCase();
      const cancelled = !!o.cancelled_at;
      const refunded = fs === "refunded";
      // Effective totals: refunded/cancelled orders no longer count as "spent" or "saved"
      const effectiveSpent = cancelled || refunded ? 0 : Number(o.total_price || 0);
      const effectiveSavings = cancelled || refunded ? 0 : Number(savings.toFixed(2));

      return {
        id: o.id,
        order_number: o.order_number || o.name,
        name: o.name,
        created_at: o.created_at,
        cancelled_at: o.cancelled_at || null,
        cancel_reason: o.cancel_reason || null,
        total_price: Number(o.total_price || 0),
        subtotal_price: Number(o.subtotal_price || 0),
        currency: o.currency,
        financial_status: o.financial_status,
        fulfillment_status: o.fulfillment_status,
        order_status_url: o.order_status_url,
        savings: Number(savings.toFixed(2)),
        effective_spent: effectiveSpent,
        effective_savings: effectiveSavings,
        line_items: lineItems,
      };
    });

    const totalSavings = orders.reduce(
      (s: number, o: any) => s + (o.effective_savings || 0),
      0
    );
    const totalSpent = orders.reduce(
      (s: number, o: any) => s + (o.effective_spent || 0),
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
