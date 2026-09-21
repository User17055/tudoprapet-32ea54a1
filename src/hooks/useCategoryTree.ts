import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { categoriesWithLinkedProducts } from "@/lib/categoryAvailability";
import { fetchAllShopifyProducts } from "@/lib/shopify";
import { useClientSaleVisibility } from "@/hooks/useClientSaleVisibility";
import { useIsFranchisee } from "@/hooks/useIsFranchisee";
import { isClientProductVisible } from "@/lib/clientSaleVisibility";

export interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
}

export function useCategoryTree() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const { blockedVariantIds, loading: saleLoading } = useClientSaleVisibility();
  const { isFranchisee, loading: franchiseLoading } = useIsFranchisee();

  useEffect(() => {
    if (saleLoading || franchiseLoading) return;
    let active = true;
    Promise.all([
      supabase.from("categories").select("*").order("sort_order").order("name"),
      supabase.from("product_categories").select("shopify_product_id, category_id"),
      fetchAllShopifyProducts(),
    ]).then(([categoryResult, linkResult, products]) => {
        if (!active) return;
        setCategories(categoriesWithLinkedProducts(
          (categoryResult.data || []) as Category[],
          linkResult.data || [],
          new Set(products
            .filter((product) => isClientProductVisible(product, blockedVariantIds, isFranchisee))
            .map((product) => product.node.id)),
        ));
        setLoading(false);
      }).catch((error) => {
        console.error("Não foi possível carregar as categorias disponíveis:", error);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [blockedVariantIds, isFranchisee, saleLoading, franchiseLoading]);

  const rootCats = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);

  const childrenOf = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of categories) {
      if (!c.parent_id) continue;
      if (!map.has(c.parent_id)) map.set(c.parent_id, []);
      map.get(c.parent_id)!.push(c);
    }
    return map;
  }, [categories]);

  return { categories, rootCats, childrenOf, loading };
}
