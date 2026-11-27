import { selectCatalogProduct } from "./olist-list-values.ts";
import { normalizeSku, roundMoney } from "./olist.ts";

/**
 * Plano da aplicação do retrato da Olist (sem efeito colateral, testável):
 * para cada variante, acha o produto da Olist pelo SKU exato e calcula custo,
 * franquia e assinante antes/depois. A simulação e a gravação usam o mesmo plano.
 */

export interface CatalogApplyItem {
  productId: string;
  variantId: string;
  sku: string;
  shopifyPrice?: number | null;
  weightKg: number | null;
}

export interface SnapshotRow {
  olist_product_id: string;
  sku: string;
  sku_key: string;
  name: string;
  cost: number | string | null;
  franchiseList?: number | null;
  subscriberList?: number | null;
  sale?: number | null;
  run_id?: string;
  fetched_at?: string;
  status: string | null;
}

export type ApplyStatus = "ok" | "not_in_catalog" | "no_cost" | "duplicate_sku" | "error";

export interface BeforeAfter {
  before: number | null;
  after: number | null;
}

export interface ApplyPlan {
  variantId: string;
  sku: string;
  status: ApplyStatus;
  olistProductId: string | null;
  olistName: string | null;
  olistStatus: string | null;
  cost: BeforeAfter;
  franchise: BeforeAfter;
  subscriber: BeforeAfter;
  sale: BeforeAfter;
  customerBefore: number | null;
  franchiseOrigin: string;
  subscriberOrigin: string;
  catalogId?: string;
  fetchedAt?: string;
  subscriberMarginPercent: number | null;
  changed: boolean;
  error?: string;
}

export interface CurrentValues {
  costs: Map<string, { cost: number; packageWeightKg: number | null }>;
  franchise: Map<string, number>;
  subscriber: Map<string, number>;
  customers?: Map<string, number>;
}

type Derive = (
  productId: string,
  cost: number,
  weightKg: number | null,
) => { franchisePrice: number; subscriberPrice: number; subscriberMarginPercent: number };

const positive = (value: unknown): number | null => {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) && number > 0 ? roundMoney(number) : null;
};

const differs = (a: number | null, b: number | null) =>
  a === null || b === null ? a !== b : Math.abs(a - b) >= 0.005;

/**
 * Escolhe o produto da Olist de um SKU. SKU repetido: vale o único ativo; sem um único ativo, as listas podem divergir mesmo com custos idênticos.
 */
export function pickSnapshotProduct(rows: SnapshotRow[]): SnapshotRow | "duplicate" | null {
  if (rows.length === 0) return null;
  return selectCatalogProduct(rows) ?? "duplicate";
}

export function planCatalogApply(
  items: CatalogApplyItem[],
  snapshot: SnapshotRow[],
  current: CurrentValues,
  derive: Derive,
): ApplyPlan[] {
  const bySku = new Map<string, SnapshotRow[]>();
  for (const row of snapshot) {
    const key = normalizeSku(row.sku_key || row.sku);
    if (!key) continue;
    bySku.set(key, [...(bySku.get(key) ?? []), row]);
  }

  return items.map((item) => {
    const existing = current.costs.get(item.variantId);
    const before = {
      cost: existing ? positive(existing.cost) : null,
      franchise: positive(current.franchise.get(item.variantId)),
      subscriber: positive(current.subscriber.get(item.variantId)),
    };
    const base: ApplyPlan = {
      variantId: item.variantId,
      sku: item.sku,
      status: "not_in_catalog",
      olistProductId: null,
      olistName: null,
      olistStatus: null,
      cost: { before: before.cost, after: null },
      franchise: { before: before.franchise, after: null },
      subscriber: { before: before.subscriber, after: null },
      subscriberMarginPercent: null,
      sale: { before: current.customers?.get(item.variantId) ?? positive(item.shopifyPrice), after: null },
      customerBefore: current.customers?.get(item.variantId) ?? null,
      subscriberOrigin: "rule", franchiseOrigin: "rule",
      changed: false,
    };

    const picked = pickSnapshotProduct(bySku.get(normalizeSku(item.sku)) ?? []);
    if (picked === null) return base;
    if (picked === "duplicate") return { ...base, status: "duplicate_sku" };
    const withProduct = {
      ...base,
      olistProductId: picked.olist_product_id,
      olistName: picked.name,
      olistStatus: picked.status,
    };
    const cost = positive(picked.cost);
    if (cost === null && !picked.sale && !picked.franchiseList && !picked.subscriberList) return { ...withProduct, status: "no_cost" };

    const weightKg = item.weightKg ?? existing?.packageWeightKg ?? null;
    const derived = cost === null ? null : derive(item.productId, cost, weightKg);
    const after = {
      cost,
      franchise: picked.franchiseList ?? derived?.franchisePrice ?? null,
      subscriber: picked.subscriberList ?? derived?.subscriberPrice ?? null,
    };
    return {
      ...withProduct,
      status: "ok",
      cost: { before: before.cost, after: after.cost },
      franchise: { before: before.franchise, after: after.franchise },
      subscriber: { before: before.subscriber, after: after.subscriber },
      subscriberMarginPercent: derived?.subscriberMarginPercent ?? null,
      catalogId: picked.run_id, fetchedAt: picked.fetched_at,
      franchiseOrigin: picked.franchiseList != null ? "olist" : "rule",
      subscriberOrigin: picked.subscriberList != null ? "olist" : "rule",
      sale: { before: base.sale.before, after: picked.sale ?? null },
      changed: (after.cost !== null && differs(before.cost, after.cost)) ||
        (after.franchise !== null && differs(before.franchise, after.franchise)) ||
        (after.subscriber !== null && differs(before.subscriber, after.subscriber)) ||
        (picked.sale != null && differs(base.sale.before, picked.sale)),
    };
  });
}
