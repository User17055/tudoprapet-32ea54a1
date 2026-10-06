import { useEffect, useMemo, useState } from "react";
import { fetchAllRowsResult } from "@/lib/fetchAllRows";

export interface ProductVariationItem {
  id: string;
  group_id: string;
  shopify_product_id: string;
  shopify_product_handle: string;
  shopify_product_title: string;
  label: string;
  sort_order: number;
}

export interface ProductVariationGroup {
  id: string;
  name: string;
}

interface ProductVariationsData {
  items: ProductVariationItem[];
  groups: ProductVariationGroup[];
}

let cachedData: ProductVariationsData | null = null;
let pendingData: Promise<ProductVariationsData> | null = null;

type VariationMeasure = { dimension: "mass" | "volume" | "count" | "number"; value: number };

function variationMeasure(label: string): VariationMeasure | null {
  const match = label.toLocaleLowerCase("pt-BR").match(
    /(\d+(?:[.,]\d+)?)\s*(kg|mg|g|ml|l|un(?:id(?:ade)?s?)?)?\b/i,
  );
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value)) return null;
  const unit = (match[2] || "").toLowerCase();
  if (unit === "kg") return { dimension: "mass", value: value * 1_000 };
  if (unit === "g") return { dimension: "mass", value };
  if (unit === "mg") return { dimension: "mass", value: value / 1_000 };
  if (unit === "l") return { dimension: "volume", value: value * 1_000 };
  if (unit === "ml") return { dimension: "volume", value };
  if (unit.startsWith("un")) return { dimension: "count", value };
  return { dimension: "number", value };
}

export function compareProductVariations(a: ProductVariationItem, b: ProductVariationItem) {
  const aMeasure = variationMeasure(a.label);
  const bMeasure = variationMeasure(b.label);
  if (aMeasure && bMeasure) {
    const numericDifference = aMeasure.dimension === bMeasure.dimension
      ? aMeasure.value - bMeasure.value
      : Number(a.label.match(/\d+(?:[.,]\d+)?/)?.[0].replace(",", ".")) -
        Number(b.label.match(/\d+(?:[.,]\d+)?/)?.[0].replace(",", "."));
    if (numericDifference !== 0) return numericDifference;
  } else if (aMeasure || bMeasure) {
    return aMeasure ? -1 : 1;
  }
  return a.sort_order - b.sort_order || a.label.localeCompare(b.label, "pt-BR", { numeric: true });
}

async function fetchProductVariations(forceRefresh = false): Promise<ProductVariationsData> {
  if (!forceRefresh && cachedData) return cachedData;
  if (pendingData) return pendingData;

  pendingData = (async () => {
    try {
      const [itemsResult, groupsResult] = await Promise.all([
        fetchAllRowsResult<ProductVariationItem>(
          "product_variation_items",
          "id, group_id, shopify_product_id, shopify_product_handle, shopify_product_title, label, sort_order",
          { orderBy: ["sort_order", "id"] },
        ),
        fetchAllRowsResult<ProductVariationGroup>("product_variation_groups", "id, name", { orderBy: "id" }),
      ]);
      if (itemsResult.error) throw itemsResult.error;
      if (groupsResult.error) throw groupsResult.error;
      cachedData = {
        items: (itemsResult.data || []) as ProductVariationItem[],
        groups: (groupsResult.data || []) as ProductVariationGroup[],
      };
      return cachedData;
    } finally {
      pendingData = null;
    }
  })();

  return pendingData;
}

export function indexProductVariations(items: ProductVariationItem[]) {
  const result = new Map<string, ProductVariationItem[]>();
  const groups = new Map<string, ProductVariationItem[]>();

  items.forEach((item) => {
    const group = groups.get(item.group_id) || [];
    group.push(item);
    groups.set(item.group_id, group);
  });

  groups.forEach((group) => {
    const sortedGroup = [...group].sort(compareProductVariations);
    sortedGroup.forEach((item) => result.set(item.shopify_product_id, sortedGroup));
  });

  return result;
}

export function useProductVariations(refreshKey?: string) {
  const [data, setData] = useState<ProductVariationsData>(
    cachedData || { items: [], groups: [] },
  );
  const [loading, setLoading] = useState(!cachedData);

  useEffect(() => {
    fetchProductVariations(Boolean(refreshKey))
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const itemsByProduct = useMemo(() => indexProductVariations(data.items), [data.items]);
  const groupNames = useMemo(
    () => new Map(data.groups.map((group) => [group.id, group.name])),
    [data.groups],
  );

  const getVariations = (productId: string) => itemsByProduct.get(productId) || [];
  const getVariationGroupName = (productId: string) => {
    const groupId = itemsByProduct.get(productId)?.[0]?.group_id;
    return groupId ? groupNames.get(groupId) || null : null;
  };

  return { items: data.items, groups: data.groups, loading, getVariations, getVariationGroupName };
}

export function invalidateProductVariationsCache() {
  cachedData = null;
}
