// Diagnóstico pontual do rascunho brasileiro: mostra as respostas cruas da
// Shopify ao gravar e ao reler a credencial fiscal (CPF/CNPJ).
import { corsHeadersWith, jsonResponse } from "../_shared/cors.ts";
import { ADMIN_API, shopifyAdminToken } from "../_shared/shopify.ts";

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersWith("x-payment-worker-token") });
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido" }, 405);

  const expected = Deno.env.get("PAYMENT_WORKER_TOKEN") || "";
  const received = req.headers.get("x-payment-worker-token") || "";
  if (!expected || !timingSafeEqual(expected, received)) return jsonResponse({ error: "Não autorizado" }, 401);

  const body = await req.json().catch(() => ({}));
  const draftOrderId = String(body?.draftOrderId || "");
  const cpfCnpj = String(body?.cpfCnpj || "").replace(/\D/g, "");
  if (!draftOrderId) return jsonResponse({ error: "draftOrderId obrigatório" }, 400);

  const token = shopifyAdminToken();
  const gid = `gid://shopify/DraftOrder/${draftOrderId}`;
  const gql = async (query: string, variables: Record<string, unknown>) => {
    const res = await fetch(`${ADMIN_API}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  const before = await gql(
    `query D($id: ID!) {
      draftOrder(id: $id) {
        id name status
        localizedFields(first: 10) { nodes { key title value } }
        purchasingEntity { __typename }
        billingAddress { countryCodeV2 city zip }
        shippingAddress { countryCodeV2 city zip }
        customer { id email }
      }
    }`,
    { id: gid },
  );

  let update: unknown = null;
  let after: unknown = null;
  if (cpfCnpj) {
    update = await gql(
      `mutation U($id: ID!, $input: DraftOrderInput!) {
        draftOrderUpdate(id: $id, input: $input) {
          draftOrder { id localizedFields(first: 10) { nodes { key value } } }
          userErrors { field message }
        }
      }`,
      { id: gid, input: { localizedFields: [{ key: "TAX_CREDENTIAL_BR", value: cpfCnpj }] } },
    );
    after = await gql(
      `query D($id: ID!) { draftOrder(id: $id) { localizedFields(first: 10) { nodes { key value } } } }`,
      { id: gid },
    );
  }

  return jsonResponse({ before, update, after });
});
