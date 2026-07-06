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

function gidToNumericId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1];
}

// Resolve um código de cupom (price rule) e converte em applied_discount de pedido.
// Draft orders não aceitam discount codes nativamente, então o valor é replicado aqui.
// Só regras simples (percentual ou valor fixo sobre o pedido todo) são suportadas.
async function resolveCoupon(
  code: string,
  orderSubtotal: number,
  token: string,
): Promise<{ appliedDiscount?: Record<string, unknown>; error?: string }> {
  const lookupRes = await fetch(
    `${ADMIN_API}/discount_codes/lookup.json?code=${encodeURIComponent(code)}`,
    { headers: { "X-Shopify-Access-Token": token } },
  );
  if (!lookupRes.ok) return { error: "Cupom não encontrado" };
  const dc = (await lookupRes.json())?.discount_code;
  if (!dc?.price_rule_id) return { error: "Cupom não encontrado" };

  const ruleRes = await fetch(`${ADMIN_API}/price_rules/${dc.price_rule_id}.json`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  if (!ruleRes.ok) return { error: "Cupom não encontrado" };
  const rule = (await ruleRes.json())?.price_rule;
  if (!rule) return { error: "Cupom não encontrado" };

  const now = new Date();
  if (rule.starts_at && new Date(rule.starts_at) > now) return { error: "Este cupom ainda não está ativo" };
  if (rule.ends_at && new Date(rule.ends_at) < now) return { error: "Este cupom expirou" };
  if (rule.usage_limit && dc.usage_count >= rule.usage_limit) {
    return { error: "Este cupom atingiu o limite de uso" };
  }

  const minSubtotal = Number(rule.prerequisite_subtotal_range?.greater_than_or_equal_to);
  if (Number.isFinite(minSubtotal) && orderSubtotal < minSubtotal) {
    return { error: `Este cupom exige pedido mínimo de R$ ${minSubtotal.toFixed(2).replace(".", ",")}` };
  }

  const incompatible = "Este cupom não pode ser combinado com os preços do clube";
  if (rule.target_type !== "line_item" || rule.target_selection !== "all") return { error: incompatible };
  if (rule.customer_selection !== "all") return { error: incompatible };

  const value = Math.abs(Number(rule.value));
  if (!Number.isFinite(value) || value <= 0) return { error: incompatible };

  if (rule.value_type === "percentage") {
    return {
      appliedDiscount: {
        description: `Cupom ${dc.code}`,
        title: dc.code,
        value_type: "percentage",
        value: value.toFixed(2),
        amount: ((orderSubtotal * value) / 100).toFixed(2),
      },
    };
  }
  if (rule.value_type === "fixed_amount" && rule.allocation_method === "across") {
    const amount = Math.min(value, orderSubtotal);
    return {
      appliedDiscount: {
        description: `Cupom ${dc.code}`,
        title: dc.code,
        value_type: "fixed_amount",
        value: amount.toFixed(2),
        amount: amount.toFixed(2),
      },
    };
  }
  return { error: incompatible };
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

    const { items, discountCode } = await req.json() as { items: LineItem[]; discountCode?: string };
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

    // Subtotal com preços do clube (mesma lógica dos line items abaixo)
    let clubSubtotal = 0;
    for (const item of items) {
      const sub = subPriceMap.get(item.variantId);
      const cur = currentPriceMap.get(item.variantId);
      const unit = sub !== undefined && cur !== undefined && cur > sub ? sub : (cur ?? sub ?? 0);
      clubSubtotal += unit * item.quantity;
    }

    // Cupom do carrinho, se houver — falha explícita em vez de descartar em silêncio
    let couponDiscount: Record<string, unknown> | null = null;
    if (discountCode) {
      const coupon = await resolveCoupon(discountCode, clubSubtotal, shopifyToken);
      if (coupon.error || !coupon.appliedDiscount) {
        return new Response(JSON.stringify({ couponError: coupon.error || "Cupom inválido" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      couponDiscount = coupon.appliedDiscount;
    }

    // Find or create customer
    const customerId = await findOrCreateCustomer(memberEmail, shopifyToken);
    if (!customerId) {
      return new Response(JSON.stringify({ error: "Falha ao identificar cliente" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build draft order line items. Shopify ignora "price" quando passamos variant_id,
    // então aplicamos applied_discount por linha (fixed_amount por unidade).
    const lineItems = items.map((item) => {
      const sub = subPriceMap.get(item.variantId);
      const cur = currentPriceMap.get(item.variantId);
      const li: Record<string, unknown> = {
        variant_id: Number(gidToNumericId(item.variantId)),
        quantity: item.quantity,
      };
      if (sub !== undefined && cur !== undefined && cur > sub) {
        const perUnitDiscount = Number((cur - sub).toFixed(2));
        li.applied_discount = {
          description: "Clube TudoPraPet",
          value_type: "fixed_amount",
          value: perUnitDiscount.toFixed(2),
          amount: (perUnitDiscount * item.quantity).toFixed(2),
          title: "Clube TudoPraPet",
        };
      }
      return li;
    });

    // Create draft order tied to customer; prices are already the subscriber prices,
    // so no discount line is shown at checkout.
    const draftRes = await fetch(`${ADMIN_API}/draft_orders.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyToken },
      body: JSON.stringify({
        draft_order: {
          line_items: lineItems,
          ...(couponDiscount ? { applied_discount: couponDiscount } : {}),
          customer: { id: customerId },
          email: memberEmail,
          use_customer_default_address: true,
          tags: "clube-tudoprapet",
          note: `Pedido do Clube TudoPraPet - ${memberEmail}`,
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
