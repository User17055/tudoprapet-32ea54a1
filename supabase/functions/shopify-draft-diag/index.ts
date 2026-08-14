import { corsHeadersWith, jsonResponse } from "../_shared/cors.ts";
import { ADMIN_API, shopifyAdminToken } from "../_shared/shopify.ts";
import { timingSafeEqual } from "../_shared/webhook.ts";

async function graphql(token: string, query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(`${ADMIN_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 6000) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeadersWith("x-payment-worker-token") });
  }
  const expected = Deno.env.get("PAYMENT_WORKER_TOKEN") || "";
  const received = req.headers.get("x-payment-worker-token") || "";
  if (!expected || !timingSafeEqual(expected, received)) {
    return jsonResponse({ error: "Não autorizado" }, 401);
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "read";
  const id = url.searchParams.get("draft_order_id");

  const token = shopifyAdminToken();
  if (!token) return jsonResponse({ error: "SHOPIFY_ACCESS_TOKEN ausente" }, 500);

  if (action === "validations") {
    const result = await graphql(
      token,
      `{ validations(first: 10) { nodes { id title enabled errorHistory { errorsFirstOccurredAt } } } }`,
    );
    return jsonResponse(result);
  }

  if (action === "shop") {
    const result = await graphql(token, `{ shop { name myshopifyDomain } }`);
    return jsonResponse(result);
  }

  if (!id) return jsonResponse({ error: "draft_order_id obrigatório" }, 400);
  if (action === "set_cpf") {
    const cpf = (url.searchParams.get("cpf") || "").replace(/\D/g, "");
    const key = url.searchParams.get("key") ||
      (cpf.length > 11 ? "TAX_CREDENTIAL_BR" : "SHIPPING_CREDENTIAL_BR");
    const result = await graphql(
      token,
      `mutation SetCpf($id: ID!, $ext: [LocalizationExtensionInput!]) {
        draftOrderUpdate(id: $id, input: { localizationExtensions: $ext }) {
          draftOrder { id localizationExtensions(first: 5) { nodes { key value purpose } } }
          userErrors { field message }
        }
      }`,
      { id: `gid://shopify/DraftOrder/${id}`, ext: [{ key, value: cpf }] },
    );
    return jsonResponse(result);
  }

  if (action === "inspect") {
    const result = await graphql(
      token,
      `query D($id: ID!) {
        draftOrder(id: $id) {
          id status
          localizationExtensions(first: 5) { nodes { key value purpose title } }
          billingAddress { countryCodeV2 provinceCode zip company phone }
          customer { id displayName email }
        }
      }`,
      { id: `gid://shopify/DraftOrder/${id}` },
    );
    return jsonResponse(result);
  }

  if (action === "fix_country") {
    const cpf = (url.searchParams.get("cpf") || "").replace(/\D/g, "");
    const read = await fetch(`${ADMIN_API}/draft_orders/${encodeURIComponent(id)}.json`, {
      headers: { "X-Shopify-Access-Token": token },
    });
    const draft = (await read.json())?.draft_order;
    const patch = (addr: Record<string, unknown> | null) => addr
      ? {
        firstName: addr.first_name, lastName: addr.last_name,
        address1: addr.address1, address2: addr.address2 || undefined,
        city: addr.city, zip: addr.zip, phone: addr.phone,
        provinceCode: addr.province_code || "SP", countryCode: "BR",
      }
      : undefined;
    const result = await graphql(
      token,
      `mutation FixCountry($id: ID!, $input: DraftOrderInput!) {
        draftOrderUpdate(id: $id, input: $input) {
          draftOrder { id localizationExtensions(first: 5) { nodes { key value } } }
          userErrors { field message }
        }
      }`,
      {
        id: `gid://shopify/DraftOrder/${id}`,
        input: {
          shippingAddress: patch(draft?.shipping_address ?? null),
          billingAddress: patch(draft?.billing_address ?? null),
          localizationExtensions: cpf ? [{ key: "TAX_CREDENTIAL_BR", value: cpf }] : undefined,
        },
      },
    );
    return jsonResponse(result);
  }


  if (action === "cancel_order") {
    const result = await graphql(
      token,
      `mutation Cancel($id: ID!) {
        orderCancel(orderId: $id, reason: OTHER, refund: false, restock: true, staffNote: "Pagamento estornado no Asaas") {
          job { id }
          orderCancelUserErrors { field message }
        }
      }`,
      { id: `gid://shopify/Order/${id}` },
    );
    return jsonResponse(result);
  }

  if (action === "complete") {
    const result = await graphql(
      token,
      `mutation Complete($id: ID!) {
        draftOrderComplete(id: $id, paymentPending: false) {
          draftOrder { id status order { id legacyResourceId } }
          userErrors { field message }
        }
      }`,
      { id: `gid://shopify/DraftOrder/${id}` },
    );
    return jsonResponse(result);
  }

  const res = await fetch(`${ADMIN_API}/draft_orders/${encodeURIComponent(id)}.json`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  const body = await res.text();
  return jsonResponse({ status: res.status, body: body.slice(0, 8000) });
});
