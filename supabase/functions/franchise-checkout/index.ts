import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface LineItem {
  variantId: string;
  quantity: number;
}

const SHOP_DOMAIN = "petjoy-deals-hb8r9.myshopify.com";
const ADMIN_API = `https://${SHOP_DOMAIN}/admin/api/2025-07`;
const STOREFRONT_API = `https://${SHOP_DOMAIN}/api/2025-07/graphql.json`;

function gidToNumericId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1];
}

async function findOrCreateCustomer(email: string, token: string): Promise<number | null> {
  const searchRes = await fetch(
    `${ADMIN_API}/customers/search.json?query=${encodeURIComponent(`email:${email}`)}`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data?.customers?.[0]?.id) return data.customers[0].id;
  }
  const createRes = await fetch(`${ADMIN_API}/customers.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ customer: { email, accepts_marketing: false, send_email_invite: false } }),
  });
  if (!createRes.ok) {
    console.error("Customer create failed:", await createRes.text());
    return null;
  }
  const data = await createRes.json();
  return data?.customer?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN") || "";
    const storefrontToken = Deno.env.get("SHOPIFY_STOREFRONT_ACCESS_TOKEN")
      || Deno.env.get("SHOPIFY_STOREFRONT_TOKEN")
      || "";

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user?.email) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: profile } = await adminClient
      .from("profiles")
      .select("is_franchisee")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile?.is_franchisee) {
      return new Response(JSON.stringify({ error: "Usuário não é franqueado" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { items } = await req.json() as { items: LineItem[] };
    if (!items?.length) {
      return new Response(JSON.stringify({ error: "Carrinho vazio" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const variantIds = items.map((i) => i.variantId);
    const { data: franchisePrices } = await adminClient
      .from("franchise_prices")
      .select("shopify_variant_id, price")
      .in("shopify_variant_id", variantIds);
    const frPriceMap = new Map<string, number>();
    for (const fp of franchisePrices || []) {
      frPriceMap.set(fp.shopify_variant_id, Number(fp.price));
    }

    if (!storefrontToken) {
      return new Response(JSON.stringify({ error: "Token Storefront ausente" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const priceRes = await fetch(STOREFRONT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": storefrontToken },
      body: JSON.stringify({
        query: `query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id price { amount } } } }`,
        variables: { ids: variantIds },
      }),
    });
    const priceData = await priceRes.json();
    const currentPriceMap = new Map<string, number>();
    for (const n of priceData?.data?.nodes || []) {
      const amt = Number(n?.price?.amount);
      if (n?.id && Number.isFinite(amt)) currentPriceMap.set(n.id, amt);
    }

    const customerId = await findOrCreateCustomer(user.email.toLowerCase(), shopifyToken);
    if (!customerId) {
      return new Response(JSON.stringify({ error: "Falha ao identificar cliente" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lineItems = items.map((item) => {
      const fr = frPriceMap.get(item.variantId);
      const cur = currentPriceMap.get(item.variantId);
      const li: Record<string, unknown> = {
        variant_id: Number(gidToNumericId(item.variantId)),
        quantity: item.quantity,
      };
      if (fr !== undefined && cur !== undefined && cur > fr) {
        const perUnitDiscount = Number((cur - fr).toFixed(2));
        li.applied_discount = {
          description: "Franquia TudoPraPet",
          value_type: "fixed_amount",
          value: perUnitDiscount.toFixed(2),
          amount: (perUnitDiscount * item.quantity).toFixed(2),
          title: "Franquia TudoPraPet",
        };
      }
      return li;
    });

    const draftRes = await fetch(`${ADMIN_API}/draft_orders.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyToken },
      body: JSON.stringify({
        draft_order: {
          line_items: lineItems,
          customer: { id: customerId },
          email: user.email.toLowerCase(),
          use_customer_default_address: true,
          tags: "franquia-tudoprapet",
          note: `Pedido franquia TudoPraPet - ${user.email}`,
        },
      }),
    });

    if (!draftRes.ok) {
      const errText = await draftRes.text();
      console.error("Draft order failed:", errText);
      return new Response(JSON.stringify({ error: "Falha ao criar pedido" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const draftData = await draftRes.json();
    const invoiceUrl: string | undefined = draftData?.draft_order?.invoice_url;

    if (!invoiceUrl) {
      return new Response(JSON.stringify({ error: "Link de checkout indisponível" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ checkoutUrl: invoiceUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Erro interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
