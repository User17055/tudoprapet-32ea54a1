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

const SHOP_DOMAIN = "petjoy-deals-hb8r9.myshopify.com";
const ADMIN_API = `https://${SHOP_DOMAIN}/admin/api/2025-07`;
const STOREFRONT_API = `https://${SHOP_DOMAIN}/api/2025-07/graphql.json`;

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "CLUBE-";
  for (let i = 0; i < 10; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

async function findOrCreateCustomer(email: string, token: string): Promise<number | null> {
  // Search
  const searchRes = await fetch(
    `${ADMIN_API}/customers/search.json?query=${encodeURIComponent(`email:${email}`)}`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data?.customers?.[0]?.id) return data.customers[0].id;
  }
  // Create
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN")
      || Deno.env.get("SHOPIFY_ONLINE_ACCESS_TOKEN:user:4HrJkQRl3KUXTrTOAgUkwQSkHWo2")
      || "";
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

    const memberEmail = user.email.toLowerCase();

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: member } = await adminClient
      .from("club_members")
      .select("is_active")
      .eq("email", memberEmail)
      .eq("is_active", true)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: "Você não é membro do clube" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { items } = await req.json() as { items: LineItem[] };
    if (!items?.length) {
      return new Response(JSON.stringify({ error: "Carrinho vazio" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch subscriber prices
    const variantIds = items.map((i) => i.variantId);
    const { data: subscriberPrices } = await adminClient
      .from("subscriber_prices")
      .select("shopify_variant_id, subscriber_price")
      .in("shopify_variant_id", variantIds);
    const subPriceMap = new Map<string, number>();
    for (const sp of subscriberPrices || []) {
      subPriceMap.set(sp.shopify_variant_id, Number(sp.subscriber_price));
    }

    // Fetch current Shopify prices via Storefront API
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

    // Calculate total discount
    let totalDiscount = 0;
    for (const item of items) {
      const sub = subPriceMap.get(item.variantId);
      const cur = currentPriceMap.get(item.variantId);
      if (sub !== undefined && cur !== undefined && cur > sub) {
        totalDiscount += (cur - sub) * item.quantity;
      }
    }
    totalDiscount = Number(totalDiscount.toFixed(2));

    // Find or create customer
    const customerId = await findOrCreateCustomer(memberEmail, shopifyToken);
    if (!customerId) {
      return new Response(JSON.stringify({ error: "Falha ao identificar cliente" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create Storefront cart first (we need it regardless of discount)
    const cartRes = await fetch(STOREFRONT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": storefrontToken },
      body: JSON.stringify({
        query: `mutation($input: CartInput!){ cartCreate(input:$input){ cart { id checkoutUrl } userErrors { message } } }`,
        variables: {
          input: {
            lines: items.map((i) => ({ quantity: i.quantity, merchandiseId: i.variantId })),
            buyerIdentity: { email: memberEmail },
          },
        },
      }),
    });
    const cartData = await cartRes.json();
    const cart = cartData?.data?.cartCreate?.cart;
    if (!cart?.checkoutUrl) {
      console.error("Cart create failed:", JSON.stringify(cartData));
      return new Response(JSON.stringify({ error: "Falha ao criar carrinho" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If there is a discount, create a single-use price rule + code restricted to this customer
    if (totalDiscount > 0) {
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min
      const code = randomCode();

      const prRes = await fetch(`${ADMIN_API}/price_rules.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyToken },
        body: JSON.stringify({
          price_rule: {
            title: `Clube ${memberEmail} ${Date.now()}`,
            target_type: "line_item",
            target_selection: "all",
            allocation_method: "across",
            value_type: "fixed_amount",
            value: `-${totalDiscount.toFixed(2)}`,
            customer_selection: "prerequisite",
            prerequisite_customer_ids: [customerId],
            once_per_customer: true,
            usage_limit: 1,
            starts_at: new Date().toISOString(),
            ends_at: expiresAt,
          },
        }),
      });

      if (!prRes.ok) {
        console.error("Price rule failed:", await prRes.text());
      } else {
        const prData = await prRes.json();
        const priceRuleId = prData?.price_rule?.id;
        if (priceRuleId) {
          const dcRes = await fetch(`${ADMIN_API}/price_rules/${priceRuleId}/discount_codes.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyToken },
            body: JSON.stringify({ discount_code: { code } }),
          });
          if (!dcRes.ok) {
            console.error("Discount code failed:", await dcRes.text());
          } else {
            // Apply code to cart
            const applyRes = await fetch(STOREFRONT_API, {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": storefrontToken },
              body: JSON.stringify({
                query: `mutation($cartId: ID!, $codes: [String!]!){
                  cartDiscountCodesUpdate(cartId:$cartId, discountCodes:$codes){
                    cart { checkoutUrl discountCodes { code applicable } }
                    userErrors { message }
                  }
                }`,
                variables: { cartId: cart.id, codes: [code] },
              }),
            });
            const applyData = await applyRes.json();
            const updatedCart = applyData?.data?.cartDiscountCodesUpdate?.cart;
            if (updatedCart?.checkoutUrl) {
              const url = new URL(updatedCart.checkoutUrl);
              url.searchParams.set("channel", "online_store");
              return new Response(JSON.stringify({ checkoutUrl: url.toString() }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
          }
        }
      }
    }

    const url = new URL(cart.checkoutUrl);
    url.searchParams.set("channel", "online_store");
    return new Response(JSON.stringify({ checkoutUrl: url.toString() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Erro interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
