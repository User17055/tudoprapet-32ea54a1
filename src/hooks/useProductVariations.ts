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

let cachedItems: ProductVariationItem[] | null = null;
let pendingItems: Promise<ProductVariationItem[]> | null = null;

async function fetchVariationItems(): Promise<ProductVariationItem[]> {
  if (cachedItems) return cachedItems;
  if (pendingItems) return pendingItems;

  pendingItems = (async () => {
    try {
      const { data, error } = await supabase
        .from("product_variation_items")
        .select("id, group_id, shopify_product_id, shopify_product_handle, shopify_product_title, label, sort_order")
        .order("sort_order");
      if (error) throw error;
      cachedItems = (data || []) as ProductVariationItem[];
      return cachedItems;
    } finally {
      pendingItems = null;
    }
  })();

  return pendingItems;
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
  const [items, setItems] = useState<ProductVariationItem[]>(cachedItems || []);
  const [loading, setLoading] = useState(!cachedItems);

  useEffect(() => {
    fetchVariationItems()
      .then(setItems)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const itemsByProduct = useMemo(() => indexProductVariations(items), [items]);

  const getVariations = (productId: string) => itemsByProduct.get(productId) || [];

  return { items, loading, getVariations };
}

export function invalidateProductVariationsCache() {
  cachedItems = null;
}
