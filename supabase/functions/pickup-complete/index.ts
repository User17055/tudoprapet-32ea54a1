import { createClient } from "npm:@supabase/supabase-js@2.75.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SHOPIFY_DOMAIN = "petjoy-deals-hb8r9.myshopify.com";
const SHOPIFY_API_VERSION = "2025-07";

async function shopifyGraphQL(query: string, variables: Record<string, unknown>) {
  const token = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  if (!token) throw new Error("SHOPIFY_ACCESS_TOKEN não configurado");
  const resp = await fetch(
    `https://${SHOPIFY_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  const data = await resp.json();
  if (!resp.ok || data.errors) {
    throw new Error(`Shopify GraphQL: ${JSON.stringify(data.errors || data)}`);
  }
  return data.data;
}

function toGid(orderId: string | number): string {
  const s = String(orderId);
  if (s.startsWith("gid://")) return s;
  return `gid://shopify/Order/${s.replace(/\D/g, "")}`;
}

async function fulfillShopifyOrder(orderId: string | number) {
  const orderGid = toGid(orderId);

  // 1) Get open fulfillment orders
  const foData = await shopifyGraphQL(
    `query($id: ID!) {
      order(id: $id) {
        id
        name
        displayFulfillmentStatus
        fulfillmentOrders(first: 20, query: "status:open OR status:in_progress") {
          nodes {
            id
            status
            lineItems(first: 50) {
              nodes { id remainingQuantity }
            }
          }
        }
      }
    }`,
    { id: orderGid },
  );
  const order = foData?.order;
  if (!order) throw new Error(`Pedido Shopify não encontrado: ${orderGid}`);

  if (order.displayFulfillmentStatus === "FULFILLED") {
    return { already_fulfilled: true, order_name: order.name };
  }

  const fulfillmentOrders = (order.fulfillmentOrders?.nodes || []).filter(
    (fo: { status: string }) =>
      fo.status === "OPEN" || fo.status === "IN_PROGRESS",
  );
  if (fulfillmentOrders.length === 0) {
    return { already_fulfilled: true, order_name: order.name };
  }

  const lineItemsByFulfillmentOrder = fulfillmentOrders
    .map((fo: { id: string; lineItems: { nodes: { id: string; remainingQuantity: number }[] } }) => ({
      fulfillmentOrderId: fo.id,
      fulfillmentOrderLineItems: fo.lineItems.nodes
        .filter((li) => li.remainingQuantity > 0)
        .map((li) => ({ id: li.id, quantity: li.remainingQuantity })),
    }))
    .filter((x) => x.fulfillmentOrderLineItems.length > 0);

  if (lineItemsByFulfillmentOrder.length === 0) {
    return { already_fulfilled: true, order_name: order.name };
  }

  // 2) Create fulfillment (no tracking, notify=false por ser retirada em loja)
  const createData = await shopifyGraphQL(
    `mutation fulfill($fulfillment: FulfillmentV2Input!) {
      fulfillmentCreateV2(fulfillment: $fulfillment) {
        fulfillment { id status }
        userErrors { field message }
      }
    }`,
    {
      fulfillment: {
        lineItemsByFulfillmentOrder,
        notifyCustomer: false,
      },
    },
  );
  const errors = createData?.fulfillmentCreateV2?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(`Shopify fulfillment: ${errors.map((e: { message: string }) => e.message).join("; ")}`);
  }
  return {
    fulfilled: true,
    order_name: order.name,
    fulfillment: createData.fulfillmentCreateV2.fulfillment,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Sessão inválida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub;
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Acesso restrito a administradores" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const code = String(body.code || "").trim();
    if (!code) {
      return new Response(JSON.stringify({ error: "Código obrigatório" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Chama o PHP externo
    const baseUrl = (Deno.env.get("EXTERNAL_API_BASE_URL") || "https://andrejrs.com.br").replace(/\/$/, "");
    const apiToken = Deno.env.get("EXTERNAL_API_TOKEN");
    const endpoint = `${baseUrl}/api/pickup/complete`;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { "X-API-Key": apiToken } : {}),
      },
      body: JSON.stringify({
        code,
        confirmed_by: "Lovable",
        operator_id: userId,
        operator_email: claims.claims.email,
      }),
    });
    const text = await resp.text();
    let phpJson: Record<string, unknown>;
    try { phpJson = JSON.parse(text); } catch { phpJson = { raw: text }; }

    // 2) Só marca na Shopify se PHP retornou ok:true e status:picked_up
    const phpOk = phpJson?.ok === true && phpJson?.status === "picked_up";
    if (!resp.ok || !phpOk) {
      return new Response(
        JSON.stringify({
          error: phpJson?.error || phpJson?.message || "PHP não confirmou a retirada",
          php: phpJson,
          shopify_updated: false,
        }),
        {
          status: resp.ok ? 400 : resp.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 3) Fulfill na Shopify
    const shopifyOrderId =
      phpJson.shopify_order_id ||
      phpJson.order_id ||
      (phpJson.order as { shopify_id?: string; id?: string } | undefined)?.shopify_id ||
      (phpJson.order as { shopify_id?: string; id?: string } | undefined)?.id;

    let shopifyResult: unknown = null;
    let shopifyError: string | null = null;
    if (shopifyOrderId) {
      try {
        shopifyResult = await fulfillShopifyOrder(shopifyOrderId as string | number);
      } catch (e) {
        shopifyError = String(e);
        console.error("Shopify fulfill error:", e);
      }
    } else {
      shopifyError = "PHP não retornou shopify_order_id/order_id";
    }

    return new Response(
      JSON.stringify({
        ok: true,
        php: phpJson,
        shopify_updated: !!shopifyResult && !shopifyError,
        shopify: shopifyResult,
        shopify_error: shopifyError,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Complete error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
