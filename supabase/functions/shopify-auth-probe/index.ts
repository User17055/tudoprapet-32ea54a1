import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { ADMIN_API, shopifyAdminToken } from "../_shared/shopify.ts";

const token = shopifyAdminToken();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!token) return jsonResponse({ ok: false, error: "admin_token_missing" }, 500);

  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token,
  };

  const [scopesResponse, installationResponse] = await Promise.all([
    fetch(`https://petjoy-deals-hb8r9.myshopify.com/admin/oauth/access_scopes.json`, { headers }),
    fetch(`${ADMIN_API}/graphql.json`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: `query AuthProbe {
          currentAppInstallation {
            id
            app { id title handle }
            accessScopes { handle }
          }
        }`,
      }),
    }),
  ]);

  const scopesPayload = await scopesResponse.json().catch(() => null);
  const installationPayload = await installationResponse.json().catch(() => null);
  const restScopes = Array.isArray(scopesPayload?.access_scopes)
    ? scopesPayload.access_scopes.map((scope: { handle?: string }) => scope.handle).filter(Boolean)
    : [];
  const installation = installationPayload?.data?.currentAppInstallation;

  return jsonResponse({
    ok: scopesResponse.ok && installationResponse.ok,
    effectiveTokenSource: Deno.env.get("SHOPIFY_ACCESS_TOKEN") ? "SHOPIFY_ACCESS_TOKEN" : "online_fallback",
    accessScopesStatus: scopesResponse.status,
    scopes: restScopes,
    installationStatus: installationResponse.status,
    installation: installation
      ? {
          id: installation.id,
          app: installation.app,
          scopes: installation.accessScopes?.map((scope: { handle?: string }) => scope.handle).filter(Boolean) ?? [],
        }
      : null,
    graphqlErrors: installationPayload?.errors?.map((error: { message?: string }) => error.message).filter(Boolean) ?? [],
  });
});