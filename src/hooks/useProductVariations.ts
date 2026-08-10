import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

async function fetchProductVariations(): Promise<ProductVariationsData> {
  if (cachedData) return cachedData;
  if (pendingData) return pendingData;

  pendingData = (async () => {
    try {
      const [itemsResult, groupsResult] = await Promise.all([
        supabase
          .from("product_variation_items")
          .select("id, group_id, shopify_product_id, shopify_product_handle, shopify_product_title, label, sort_order")
          .order("sort_order"),
        supabase.from("product_variation_groups").select("id, name"),
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
    const sortedGroup = [...group].sort((a, b) => a.sort_order - b.sort_order);
    sortedGroup.forEach((item) => result.set(item.shopify_product_id, sortedGroup));
  });

  return result;
}

export function useProductVariations() {
  const [data, setData] = useState<ProductVariationsData>(
    cachedData || { items: [], groups: [] },
  );
  const [loading, setLoading] = useState(!cachedData);

  useEffect(() => {
    fetchProductVariations()
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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
