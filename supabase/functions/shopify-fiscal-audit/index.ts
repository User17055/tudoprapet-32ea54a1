// Auditoria pontual (somente leitura): mostra se os pedidos recentes da Shopify
// têm o campo localizado TAX_CREDENTIAL_BR preenchido. Restrito a admin.
import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { ADMIN_API, shopifyAdminToken } from "../_shared/shopify.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.response;

  const body = await req.json().catch(() => ({}));
  const first = Math.min(Number(body?.first) || 40, 100);
  const search = typeof body?.query === "string" ? body.query : null;

  const res = await fetch(`${ADMIN_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyAdminToken() },
    body: JSON.stringify({
      query: `query O($first: Int!, $query: String) {
        orders(first: $first, sortKey: CREATED_AT, reverse: true, query: $query) {
          nodes {
            name createdAt displayFinancialStatus
            localizedFields(first: 10) { nodes { key value } }
            customAttributes { key value }
          }
        }
      }`,
      variables: { first, query: search },
    }),
  });
  const payload = await res.json().catch(() => null);
  const nodes = payload?.data?.orders?.nodes ?? [];
  const rows = nodes.map((order: any) => {
    const fields: Record<string, string> = {};
    for (const node of order.localizedFields?.nodes ?? []) fields[node.key] = node.value;
    const attr = (order.customAttributes ?? []).find((a: any) =>
      /cpf|cnpj|documento/i.test(String(a?.key || ""))
    );
    return {
      name: order.name,
      createdAt: order.createdAt,
      financialStatus: order.displayFinancialStatus,
      taxCredentialBr: fields.TAX_CREDENTIAL_BR ?? null,
      localizedKeys: Object.keys(fields),
      cpfAttribute: attr ? { key: attr.key, value: attr.value } : null,
    };
  });

  return jsonResponse({
    httpStatus: res.status,
    graphqlErrors: payload?.errors ?? null,
    count: rows.length,
    withTaxCredential: rows.filter((r: any) => r.taxCredentialBr).length,
    rows,
  });
});
