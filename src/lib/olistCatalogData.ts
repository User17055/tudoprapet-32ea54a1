import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import type { OlistListException, OlistPriceList, OlistProduct, OlistRun } from "@/lib/olistComparison";

// Retrato da Olist gravado pela função admin-olist-catalog (só admins leem).
// Mão única: a Olist alimenta o site; daqui nada volta para a Olist.

type Numeric = number | string | null;
const money = (value: Numeric) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

export interface OlistCatalogData {
  products: OlistProduct[];
  lists: OlistPriceList[];
  exceptions: OlistListException[];
  lastCatalogRun: OlistRun | null;
  lastApplyRun: OlistRun | null;
}

const RUN_COLUMNS = "id,kind,status,started_at,finished_at,products,price_lists,exceptions,applied,changed,not_found,failed,error";

function toRun(row: Record<string, unknown> | undefined): OlistRun | null {
  if (!row) return null;
  return {
    id: String(row.id),
    kind: row.kind === "apply" ? "apply" : "catalog",
    status: String(row.status) as OlistRun["status"],
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    products: Number(row.products ?? 0),
    priceLists: Number(row.price_lists ?? 0),
    exceptions: Number(row.exceptions ?? 0),
    applied: Number(row.applied ?? 0),
    changed: Number(row.changed ?? 0),
    notFound: Number(row.not_found ?? 0),
    failed: Number(row.failed ?? 0),
    error: row.error ? String(row.error) : null,
  };
}

// Tabelas novas (26/11/2026) ainda fora dos tipos gerados: mesma saída do fetchAllRows.
const untypedTable = (table: string) => supabase.from(table as never);

async function latestRun(kind: "catalog" | "apply"): Promise<Record<string, unknown>[]> {
  let query = untypedTable("olist_catalog_runs").select(RUN_COLUMNS).eq("kind", kind);
  if (kind === "catalog") query = query.eq("status", "done");
  const { data, error } = await query.order("started_at", { ascending: false }).limit(1);
  if (error) throw error;
  return (data ?? []) as unknown as Record<string, unknown>[];
}

export async function fetchOlistCatalogData(): Promise<OlistCatalogData> {
  const [products, lists, exceptions, catalogRuns, applyRuns] = await Promise.all([
    fetchAllRows<{
      olist_product_id: string; sku: string; sku_key: string; name: string; price: Numeric;
      promo_price: Numeric; cost: Numeric; status: string | null; fetched_at: string;
    }>(
      "olist_product_snapshot",
      "olist_product_id,sku,sku_key,name,price,promo_price,cost,status,fetched_at",
      { orderBy: "olist_product_id" },
    ),
    fetchAllRows<{ olist_price_list_id: string; name: string; adjustment_percent: Numeric }>(
      "olist_price_lists",
      "olist_price_list_id,name,adjustment_percent",
      { orderBy: "olist_price_list_id" },
    ),
    fetchAllRows<{ olist_price_list_id: string; olist_product_id: string; price: Numeric; promo_price: Numeric }>(
      "olist_price_list_exceptions",
      "olist_price_list_id,olist_product_id,price,promo_price",
      { orderBy: ["olist_price_list_id", "olist_product_id"] },
    ),
    latestRun("catalog"),
    latestRun("apply"),
  ]);
  return {
    products: products.map((row) => ({
      id: row.olist_product_id,
      sku: row.sku,
      skuKey: row.sku_key,
      name: row.name,
      price: money(row.price),
      promoPrice: money(row.promo_price),
      cost: money(row.cost),
      status: row.status,
      fetchedAt: row.fetched_at,
    })),
    lists: lists.map((row) => ({
      id: row.olist_price_list_id,
      name: row.name,
      adjustmentPercent: Number(row.adjustment_percent ?? 0) || 0,
    })),
    exceptions: exceptions.map((row) => ({
      listId: row.olist_price_list_id,
      productId: row.olist_product_id,
      price: money(row.price),
      promoPrice: money(row.promo_price),
    })),
    lastCatalogRun: toRun(catalogRuns[0]),
    lastApplyRun: toRun(applyRuns[0]),
  };
}

/** Datas da mudança real de franquia e assinante (colunas novas de 26/11/2026). */
export interface PriceDates {
  changedAt: string | null;
  createdAt: string | null;
}

export async function fetchPriceDates(): Promise<{
  franchise: Map<string, PriceDates>;
  subscriber: Map<string, PriceDates>;
}> {
  const [franchise, subscriber] = await Promise.all([
    fetchAllRows<{ shopify_variant_id: string; price_changed_at: string | null; created_at: string | null }>(
      "franchise_prices",
      "shopify_variant_id,price_changed_at,created_at",
      { orderBy: "shopify_variant_id" },
    ),
    fetchAllRows<{ shopify_variant_id: string; price_changed_at: string | null; created_at: string | null }>(
      "subscriber_prices",
      "shopify_variant_id,price_changed_at,created_at",
      { orderBy: "shopify_variant_id" },
    ),
  ]);
  const toMap = (rows: typeof franchise) => new Map(rows.map((row) => [
    row.shopify_variant_id,
    { changedAt: row.price_changed_at, createdAt: row.created_at },
  ]));
  return { franchise: toMap(franchise), subscriber: toMap(subscriber) };
}

export interface PriceValueHistoryRow {
  id: string;
  kind: "franchise" | "subscriber" | "customer";
  old_value: number | null;
  new_value: number | null;
  changed_at: string;
}

export async function fetchPriceValueHistory(variantId: string): Promise<PriceValueHistoryRow[]> {
  const { data, error } = await untypedTable("price_value_history")
    .select("id,kind,old_value,new_value,changed_at")
    .eq("shopify_variant_id", variantId)
    .order("changed_at", { ascending: false })
    .limit(60);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Array<{
    id: string; kind: PriceValueHistoryRow["kind"]; old_value: Numeric; new_value: Numeric; changed_at: string;
  }>;
  return rows.map((row) => ({
    ...row,
    old_value: row.old_value === null ? null : Number(row.old_value),
    new_value: row.new_value === null ? null : Number(row.new_value),
  }));
}
