// Função TEMPORÁRIA de diagnóstico do campo fiscal brasileiro em draft orders.
// Deve ser removida assim que a causa do TAX_CREDENTIAL_BR for confirmada.
import { corsHeaders } from "../_shared/cors.ts";

const PROBE_TOKEN = "tpp-probe-2026-08-16";
const SHOP = "petjoy-deals-hb8r9.myshopify.com";
const ADMIN = `https://${SHOP}/admin/api/2025-07/graphql.json`;

function token(): string {
  return Deno.env.get("SHOPIFY_ACCESS_TOKEN") ||
    Deno.env.get("SHOPIFY_ONLINE_ACCESS_TOKEN:user:4HrJkQRl3KUXTrTOAgUkwQSkHWo2") || "";
}

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(ADMIN, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token() },
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.headers.get("x-probe-token") !== PROBE_TOKEN) {
    return new Response("no", { status: 401, headers: corsHeaders });
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  out.inputFields = await gql(`{ __type(name: "DraftOrderInput") { inputFields { name } } }`);
  out.localizedFieldInput = await gql(`{ __type(name: "LocalizedFieldInput") { inputFields { name } } __enum: __type(name: "LocalizedFieldKey") { enumValues { name } } }`);
  out.markets = await gql(`{ shop { name billingAddress { countryCodeV2 } } }`);

  if (body.draftId) {
    out.draft = await gql(
      `query($id: ID!){ draftOrder(id:$id){ id localizedFields(first:5){ nodes{ key value title } } billingAddress{ countryCodeV2 } shippingAddress{ countryCodeV2 } } }`,
      { id: `gid://shopify/DraftOrder/${body.draftId}` },
    );
  }
  if (body.tryCreate) {
    out.create = await gql(
      `mutation($input: DraftOrderInput!){ draftOrderCreate(input:$input){ draftOrder{ id localizedFields(first:5){ nodes{ key value } } } userErrors{ field message } } }`,
      { input: body.tryCreate },
    );
  }
  if (body.clearShipping) {
    out.clear = await gql(
      `mutation($id: ID!, $input: DraftOrderInput!){ draftOrderUpdate(id:$id, input:$input){ draftOrder{ id shippingAddress{ countryCodeV2 } shippingLine{ title price } localizedFields(first:5){ nodes{ key value } } } userErrors{ field message } } }`,
      { id: `gid://shopify/DraftOrder/${body.clearShipping}`, input: { shippingAddress: null } },
    );
  }
  return new Response(JSON.stringify(out), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
