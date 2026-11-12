import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { ensureFranchiseCosts, type FranchisePricingItem } from "./franchise-pricing.ts";

// Banco falso: só o que ensureFranchiseCosts usa (select/in/eq, upsert, rpc).
function fakeAdmin(tables: Record<string, Array<Record<string, unknown>>>) {
  const upserts: Array<{ table: string; payload: unknown }> = [];
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const query: any = {
      select: () => query,
      in: (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[column]));
        return query;
      },
      eq: (column: string, value: unknown) => {
        rows = rows.filter((row) => row[column] === value);
        return query;
      },
      upsert: (payload: unknown) => {
        upserts.push({ table, payload });
        return Promise.resolve({ error: null });
      },
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    return query;
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    rpcs.push({ name, args });
    const reviews = (tables.franchise_price_reviews ??= []);
    if (!reviews.some((row) => row.shopify_variant_id === args.p_variant_id)) {
      reviews.push({
        id: `review-${args.p_variant_id}`,
        shopify_variant_id: args.p_variant_id,
        status: "blocked",
        decision_note: null,
      });
    }
    return Promise.resolve({ data: "blocked", error: null });
  };
  return { admin: { from, rpc } as unknown as SupabaseClient, upserts, rpcs };
}

const item = (id: string, sku = `SKU${id}`): FranchisePricingItem => ({
  variantId: `gid://shopify/ProductVariant/${id}`,
  productId: `gid://shopify/Product/${id}`,
  sku,
  title: `Produto ${id}`,
  catalogPrice: 34.5,
});

Deno.test("produto com custo passa direto e ganha preço de franquia se faltar", async () => {
  const fake = fakeAdmin({
    product_costs: [{ shopify_variant_id: item("1").variantId, cost: 15.9 }],
    franchise_prices: [],
  });
  const result = await ensureFranchiseCosts(fake.admin, [item("1")], {
    token: "t",
    lookup: () => Promise.reject(new Error("não deveria consultar a Olist")),
  });
  assertEquals(result.blocked, []);
  assertEquals(fake.upserts.length, 1);
  assertEquals((fake.upserts[0].payload as Array<{ price: number }>)[0].price, 15.9);
});

Deno.test("sem custo: busca na Olist e libera sem revisão", async () => {
  const fake = fakeAdmin({ product_costs: [], franchise_prices: [] });
  const applied: Array<[string, number]> = [];
  const result = await ensureFranchiseCosts(fake.admin, [item("2")], {
    token: "t",
    lookup: () => Promise.resolve({ id: "9", sku: "SKU2", name: "Ômega", cost: 15.9 }),
    applyCost: (entry, cost) => Promise.resolve(void applied.push([entry.variantId, cost])),
  });
  assertEquals(result.blocked, []);
  assertEquals(result.resolved, [item("2").variantId]);
  assertEquals(applied, [[item("2").variantId, 15.9]]);
  assertEquals(fake.rpcs.length, 0);
});

Deno.test("sem custo e sem SKU: bloqueia em vez de cobrar preço cheio", async () => {
  const fake = fakeAdmin({ product_costs: [], franchise_prices: [] });
  const result = await ensureFranchiseCosts(fake.admin, [item("3", "")], { token: "t" });
  assertEquals(result.blocked.length, 1);
  assertEquals(result.blocked[0].reason, "missing_sku");
  assertEquals(result.blocked[0].canRequestReview, true);
  assertEquals(fake.rpcs[0].name, "record_franchise_price_block");
});

Deno.test("Olist fora do ar bloqueia só o item, sem derrubar o checkout", async () => {
  const fake = fakeAdmin({ product_costs: [], franchise_prices: [] });
  const result = await ensureFranchiseCosts(fake.admin, [item("4")], {
    token: "t",
    lookup: () => Promise.reject(new Error("HTTP 503")),
  });
  assertEquals(result.blocked.map((entry) => entry.reason), ["olist_unavailable"]);
});

Deno.test("preço de franquia definido pelo admin vale mesmo sem custo", async () => {
  const fake = fakeAdmin({
    product_costs: [],
    franchise_prices: [{ shopify_variant_id: item("5").variantId, price: 72.64 }],
  });
  const result = await ensureFranchiseCosts(fake.admin, [item("5")], {
    token: "t",
    lookup: () => Promise.resolve(null),
  });
  assertEquals(result.blocked, []);
});

Deno.test("respeita o limite de consultas à Olist por checkout", async () => {
  const fake = fakeAdmin({ product_costs: [], franchise_prices: [] });
  let calls = 0;
  const result = await ensureFranchiseCosts(fake.admin, [item("6"), item("7"), item("8")], {
    token: "t",
    maxLookups: 1,
    lookup: () => Promise.resolve(void calls++ as unknown as null),
  });
  assertEquals(calls, 1);
  assertEquals(result.blocked.map((entry) => entry.reason), [
    "not_found_in_olist",
    "olist_unavailable",
    "olist_unavailable",
  ]);
});

Deno.test("quem já pediu revisão não vê o botão de novo; recusado mostra o motivo", async () => {
  const fake = fakeAdmin({
    product_costs: [],
    franchise_prices: [],
    franchise_price_reviews: [
      { id: "r9", shopify_variant_id: item("9").variantId, status: "requested", decision_note: null },
      { id: "r10", shopify_variant_id: item("10").variantId, status: "rejected", decision_note: "fora de linha" },
    ],
    franchise_price_review_requests: [{ review_id: "r9", user_id: "user-1" }],
  });
  const result = await ensureFranchiseCosts(fake.admin, [item("9", ""), item("10", "")], {
    token: "t",
    userId: "user-1",
  });
  const [requested, rejected] = result.blocked;
  assertEquals(requested.canRequestReview, false);
  assertEquals(requested.message.includes("já solicitada"), true);
  assertEquals(rejected.canRequestReview, false);
  assertEquals(rejected.message, "Produto indisponível para franquia: fora de linha");
});

const NOW = Date.parse("2026-11-12T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

Deno.test("custo com mais de 7 dias é reconsultado e o preço de franquia acompanha", async () => {
  const fake = fakeAdmin({
    product_costs: [{ shopify_variant_id: item("11").variantId, cost: 20, synced_at: daysAgo(10) }],
    franchise_prices: [{ shopify_variant_id: item("11").variantId, price: 20 }],
  });
  const applied: number[] = [];
  const result = await ensureFranchiseCosts(fake.admin, [item("11")], {
    token: "t",
    now: NOW,
    lookup: () => Promise.resolve({ id: "1", sku: "SKU11", name: "x", cost: 17 }),
    applyCost: (_entry, cost) => Promise.resolve(void applied.push(cost)),
  });
  assertEquals(result.refreshed, [item("11").variantId]);
  assertEquals(applied, [17]);
  assertEquals(result.blocked, []);
});

Deno.test("custo recente não consulta a Olist", async () => {
  const fake = fakeAdmin({
    product_costs: [{ shopify_variant_id: item("12").variantId, cost: 20, synced_at: daysAgo(2) }],
    franchise_prices: [{ shopify_variant_id: item("12").variantId, price: 20 }],
  });
  const result = await ensureFranchiseCosts(fake.admin, [item("12")], {
    token: "t",
    now: NOW,
    lookup: () => Promise.reject(new Error("não deveria consultar a Olist")),
  });
  assertEquals(result.refreshed, []);
  assertEquals(fake.upserts.length, 0);
});

Deno.test("falha ao atualizar custo antigo não bloqueia: segue com o custo cadastrado", async () => {
  const fake = fakeAdmin({
    product_costs: [{ shopify_variant_id: item("13").variantId, cost: 20, synced_at: daysAgo(30) }],
    franchise_prices: [{ shopify_variant_id: item("13").variantId, price: 20 }],
  });
  const result = await ensureFranchiseCosts(fake.admin, [item("13")], {
    token: "t",
    now: NOW,
    lookup: () => Promise.reject(new Error("API Bloqueada")),
  });
  assertEquals(result.blocked, []);
  assertEquals(result.refreshed, []);
});

Deno.test("item sem custo tem prioridade no limite de consultas sobre custo antigo", async () => {
  const fake = fakeAdmin({
    product_costs: [{ shopify_variant_id: item("14").variantId, cost: 20, synced_at: daysAgo(30) }],
    franchise_prices: [{ shopify_variant_id: item("14").variantId, price: 20 }],
  });
  const consulted: string[] = [];
  await ensureFranchiseCosts(fake.admin, [item("14"), item("15")], {
    token: "t",
    now: NOW,
    maxLookups: 1,
    lookup: (sku) => {
      consulted.push(sku);
      return Promise.resolve({ id: "1", sku, name: "x", cost: 9 });
    },
    applyCost: () => Promise.resolve(),
  });
  assertEquals(consulted, ["SKU15"]);
});

Deno.test("preço de franquia acima do custo volta para o custo (sem margem)", async () => {
  const fake = fakeAdmin({
    product_costs: [{ shopify_variant_id: item("16").variantId, cost: 17, synced_at: daysAgo(1) }],
    franchise_prices: [{ shopify_variant_id: item("16").variantId, price: 20 }],
  });
  const result = await ensureFranchiseCosts(fake.admin, [item("16")], { token: "t", now: NOW });
  assertEquals(result.blocked, []);
  assertEquals(fake.upserts.length, 1);
  assertEquals((fake.upserts[0].payload as Array<{ price: number }>)[0].price, 17);
});
