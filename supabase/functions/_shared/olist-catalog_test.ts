import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pickSnapshotProduct, planCatalogApply, type SnapshotRow } from "./olist-catalog.ts";
import { parseOlistCatalogProduct } from "./olist.ts";
import { applyProductCost, derivedPricesFromCost } from "./olist-cost-apply.ts";

const row = (overrides: Partial<SnapshotRow>): SnapshotRow => ({
  olist_product_id: "1",
  sku: "75831",
  sku_key: "75831",
  name: "Ração Premier",
  cost: "172.28",
  status: "A",
  ...overrides,
});

const item = (sku: string, variant = "1", weightKg: number | null = null) => ({
  productId: `gid://shopify/Product/${variant}`,
  variantId: `gid://shopify/ProductVariant/${variant}`,
  sku,
  weightKg,
});

const noRules = { categories: [], links: [], rules: [] };
const derive = (productId: string, cost: number, weightKg: number | null) =>
  derivedPricesFromCost(productId, cost, weightKg, noRules);
const empty = () => ({ costs: new Map(), franchise: new Map(), subscriber: new Map() });

Deno.test("catálogo: lê o produto da Olist e descarta preço vazio ou zero", () => {
  assertEquals(
    parseOlistCatalogProduct({
      id: "352534092",
      codigo: " 10000556 ",
      nome: " Celesporin 600 mg",
      preco: "133.45",
      preco_promocional: 0,
      preco_custo: "",
      situacao: "A",
      tipoVariacao: "N",
    }),
    {
      id: "352534092",
      sku: "10000556",
      name: "Celesporin 600 mg",
      price: 133.45,
      promoPrice: null,
      cost: null,
      status: "A",
      variationType: "N",
    },
  );
  assertEquals(parseOlistCatalogProduct({ id: "0", codigo: "X" }), null);
});

Deno.test("aplicar: SKU exato (maiúsculas, sem tirar zero à esquerda)", () => {
  const snapshot = [row({ sku: "05244", sku_key: "05244", cost: 21.98 }), row({ olist_product_id: "2", sku: "abc", sku_key: "ABC" })];
  const plans = planCatalogApply([item("05244"), item("5244", "2"), item(" abc ", "3")], snapshot, empty(), derive);
  assertEquals(plans.map((plan) => plan.status), ["ok", "not_in_catalog", "ok"]);
  assertEquals(plans[0].cost.after, 21.98);
  assertEquals(plans[0].franchise.after, 21.98);
});

Deno.test("aplicar: Olist sem custo não grava nada", () => {
  const [plan] = planCatalogApply([item("11650046")], [row({ sku: "11650046", sku_key: "11650046", cost: null })], empty(), derive);
  assertEquals(plan.status, "no_cost");
  assertEquals(plan.cost.after, null);
});

Deno.test("aplicar: franquia = custo; assinante = custo + 5% sem regra; detecta o que muda", () => {
  const current = {
    costs: new Map([["gid://shopify/ProductVariant/1", { cost: 41.35, packageWeightKg: 7.5 }]]),
    franchise: new Map([["gid://shopify/ProductVariant/1", 41.35]]),
    subscriber: new Map([["gid://shopify/ProductVariant/1", 43.42]]),
  };
  const [plan] = planCatalogApply([item("75831")], [row({})], current, derive);
  assertEquals(plan.status, "ok");
  assertEquals(plan.cost, { before: 41.35, after: 172.28 });
  assertEquals(plan.franchise, { before: 41.35, after: 172.28 });
  assertEquals(plan.subscriber, { before: 43.42, after: 180.89 });
  assertEquals(plan.changed, true);

  const same = {
    costs: new Map([["gid://shopify/ProductVariant/1", { cost: 172.28, packageWeightKg: 7.5 }]]),
    franchise: new Map([["gid://shopify/ProductVariant/1", 172.28]]),
    subscriber: new Map([["gid://shopify/ProductVariant/1", 180.89]]),
  };
  assertEquals(planCatalogApply([item("75831")], [row({})], same, derive)[0].changed, false);
});

Deno.test("aplicar: sem peso no título usa o peso já gravado (regra da ração)", () => {
  const weights: Array<number | null> = [];
  const spy = (productId: string, cost: number, weightKg: number | null) => {
    weights.push(weightKg);
    return derive(productId, cost, weightKg);
  };
  const current = { ...empty(), costs: new Map([["gid://shopify/ProductVariant/1", { cost: 10, packageWeightKg: 15 }]]) };
  planCatalogApply([item("75831")], [row({})], current, spy);
  planCatalogApply([item("75831", "1", 2.5)], [row({})], current, spy);
  assertEquals(weights, [15, 2.5]);
});

Deno.test("SKU repetido na Olist: vale o único ativo; custos diferentes sem ativo único = não aplica", () => {
  assertEquals(pickSnapshotProduct([]), null);
  const ativo = row({ olist_product_id: "2", status: "A", cost: 10 });
  assertEquals(pickSnapshotProduct([row({ status: "I", cost: 9 }), ativo]), ativo);
  assertEquals(pickSnapshotProduct([row({ cost: 10 }), row({ olist_product_id: "2", cost: 10 })]), "duplicate");
  assertEquals(pickSnapshotProduct([row({ cost: 10 }), row({ olist_product_id: "2", cost: 12 })]), "duplicate");
  const [plan] = planCatalogApply([item("75831")], [row({ cost: 10 }), row({ olist_product_id: "2", cost: 12 })], empty(), derive);
  assertEquals(plan.status, "duplicate_sku");
});

Deno.test("applyProductCost não apaga mais o Valor do Cliente (customer_prices)", async () => {
  const touched: string[] = [];
  const query = (table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      upsert: () => {
        touched.push(`upsert ${table}`);
        return Promise.resolve({ error: null });
      },
      insert: () => {
        touched.push(`insert ${table}`);
        return Promise.resolve({ error: null });
      },
      delete: () => {
        touched.push(`delete ${table}`);
        return chain;
      },
    };
    return chain;
  };
  const admin = { from: query } as any;
  const result = await applyProductCost(admin, item("75831"), 172.28, noRules);
  assertEquals(result.franchisePrice, 172.28);
  assertEquals(touched.some((entry) => entry.includes("customer_prices")), false);
  assertEquals(touched, [
    "upsert product_costs",
    "insert product_cost_history",
    "upsert franchise_prices",
    "upsert subscriber_prices",
  ]);
});

Deno.test("SKU 381161 aplica preços da Olist mesmo quando o custo já confere", () => {
  const target = { ...item("381161"), shopifyPrice: 54.70 };
  const current = empty();
  current.costs.set(target.variantId, { cost: 31.98, packageWeightKg: 1 });
  current.franchise.set(target.variantId, 31.98);
  current.subscriber.set(target.variantId, 33.58);
  const snapshot = row({ sku_key: "381161", cost: 31.98, franchiseList: 34.17, subscriberList: 32.19, sale: 51.17 });
  const [plan] = planCatalogApply([target], [snapshot], current, derive);
  assertEquals(plan.changed, true);
  assertEquals(plan.franchise, { before: 31.98, after: 34.17 });
  assertEquals(plan.sale, { before: 54.70, after: 51.17 });
  assertEquals(plan.subscriber, { before: 33.58, after: 32.19 });
  current.franchise.set(target.variantId, 34.17);
  current.subscriber.set(target.variantId, 32.19);
  assertEquals(planCatalogApply([target], [snapshot], { ...current, customers: new Map([[target.variantId,51.17]]) }, derive)[0].changed, false);
});
