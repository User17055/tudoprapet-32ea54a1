// Bundle portátil mantido no repositório; o gerador foi desativado no Vite.
// supabase function: mcp
// Bundled from src/lib/mcp/index.ts by @lovable.dev/mcp-js.
// src/lib/mcp/index.ts
import { auth, defineMcp } from "npm:@lovable.dev/mcp-js@0.26.2";

// src/lib/mcp/tools/get-my-profile.ts
import { defineTool } from "npm:@lovable.dev/mcp-js@0.26.2";

// src/lib/mcp/supabase.ts
import { createClient } from "npm:@supabase/supabase-js@^2.102.1";
function runtimeEnv(name: string): string | undefined {
  const runtime = globalThis;
  return runtime.Deno?.env?.get?.(name) ?? runtime.process?.env?.[name];
}
function configuredEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = runtimeEnv(name)?.trim();
    if (value) return value;
  }
  return void 0;
}
function supabaseProjectUrl() {
  const url = configuredEnv(["SUPABASE_URL", "VITE_SUPABASE_URL"]);
  if (!url) throw new Error("SUPABASE_URL (ou VITE_SUPABASE_URL) \xE9 obrigat\xF3rio");
  return url;
}
function supabasePublishableKey() {
  const direct = configuredEnv(["SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY"]);
  if (direct) return direct;
  const keyset = runtimeEnv("SUPABASE_PUBLISHABLE_KEYS");
  if (keyset) {
    try {
      const parsed = JSON.parse(keyset);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const keys = parsed;
        const key = [keys.default, ...Object.values(keys)].find((v) => typeof v === "string" && v.trim().startsWith("sb_publishable_"))?.trim();
        if (key) return key;
      }
    } catch {
    }
  }
  const legacy = configuredEnv(["SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY"]);
  if (legacy) return legacy;
  throw new Error("SUPABASE_PUBLISHABLE_KEY, SUPABASE_PUBLISHABLE_KEYS ou SUPABASE_ANON_KEY \xE9 obrigat\xF3rio");
}
function supabaseForUser(ctx: { getToken: () => string | undefined }) {
  const token = ctx.getToken();
  if (!token) throw new Error("supabaseForUser exige um token OAuth verificado");
  return createClient(supabaseProjectUrl(), supabasePublishableKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

// src/lib/mcp/tools/get-my-profile.ts
var get_my_profile_default = defineTool({
  name: "get_my_profile",
  title: "Meu perfil",
  description: "Retorna o perfil da conta TudoPraPet do usu\xE1rio conectado (nome, e-mail, franqueado).",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "N\xE3o autenticado." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.from("profiles").select("id,name,email,cpf,is_franchisee,referral_code,created_at").eq("user_id", ctx.getUserId()).maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) {
      return { content: [{ type: "text", text: "Nenhum perfil encontrado para esta conta." }] };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { profile: data, email: ctx.getUserEmail() ?? null }
    };
  }
});

// src/lib/mcp/tools/list-my-orders.ts
import { defineTool as defineTool2 } from "npm:@lovable.dev/mcp-js@0.26.2";
import { z } from "npm:zod@^3.25.76";
var list_my_orders_default = defineTool2({
  name: "list_my_orders",
  title: "Meus pedidos",
  description: "Lista as compras mais recentes do usu\xE1rio conectado na loja TudoPraPet, com status e total.",
  inputSchema: {
    limit: z.number().int().optional().describe("Quantidade de pedidos a retornar (1 a 25, padr\xE3o 10).")
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "N\xE3o autenticado." }], isError: true };
    }
    const take = Math.min(Math.max(Math.trunc(limit ?? 10), 1), 25);
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.from("checkout_sessions").select("id,status,subtotal,discount,shipping_amount,total,currency,shipping_method,shopify_order_id,created_at").eq("user_id", ctx.getUserId()).order("created_at", { ascending: false }).limit(take);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const orders = data ?? [];
    return {
      content: [{
        type: "text",
        text: orders.length ? JSON.stringify(orders) : "Nenhum pedido encontrado nesta conta."
      }],
      structuredContent: { orders }
    };
  }
});

// src/lib/mcp/tools/get-my-cart.ts
import { defineTool as defineTool3 } from "npm:@lovable.dev/mcp-js@0.26.2";
var get_my_cart_default = defineTool3({
  name: "get_my_cart",
  title: "Meu carrinho",
  description: "Mostra os itens salvos no carrinho da conta TudoPraPet do usu\xE1rio conectado.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "N\xE3o autenticado." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.from("user_carts").select("items,updated_at").eq("user_id", ctx.getUserId()).maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const items = Array.isArray(data?.items) ? data?.items : [];
    return {
      content: [{
        type: "text",
        text: items.length ? JSON.stringify(items) : "O carrinho desta conta est\xE1 vazio."
      }],
      structuredContent: { items, updatedAt: data?.updated_at ?? null }
    };
  }
});

// src/lib/mcp/tools/list-categories.ts
import { defineTool as defineTool4 } from "npm:@lovable.dev/mcp-js@0.26.2";
import { z as z2 } from "npm:zod@^3.25.76";
var list_categories_default = defineTool4({
  name: "list_categories",
  title: "Categorias da loja",
  description: "Lista as categorias publicadas da loja TudoPraPet, opcionalmente filtrando por nome.",
  inputSchema: {
    search: z2.string().optional().describe("Texto para filtrar categorias pelo nome.")
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "N\xE3o autenticado." }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase.from("categories").select("id,name,slug,parent_id,sort_order").order("sort_order", { ascending: true }).limit(200);
    const term = search?.trim();
    if (term) query = query.ilike("name", `%${term}%`);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const categories = data ?? [];
    return {
      content: [{
        type: "text",
        text: categories.length ? JSON.stringify(categories) : "Nenhuma categoria encontrada."
      }],
      structuredContent: { categories }
    };
  }
});

// src/lib/mcp/index.ts
var projectRef = "smvtnflhkvxdmvqbxwrf";
var mcp_default = defineMcp({
  name: "tudoprapet",
  title: "TudoPraPet",
  version: "0.1.0",
  instructions: "Ferramentas da loja TudoPraPet. Use `get_my_profile` para os dados da conta conectada, `list_my_orders` para as compras recentes, `get_my_cart` para o carrinho salvo e `list_categories` para navegar pelas categorias do cat\xE1logo.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated"
  }),
  tools: [get_my_profile_default, list_my_orders_default, get_my_cart_default, list_categories_default]
});

// lovable-mcp-supabase-entry.ts
import { createSupabaseHandler } from "npm:@lovable.dev/mcp-js@0.26.2/stacks/supabase";
Deno.serve(createSupabaseHandler(mcp_default, { functionName: "mcp" }));
