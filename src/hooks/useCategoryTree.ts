import { useEffect, useMemo, useState } from "react";
import { categoriesWithLinkedProducts } from "@/lib/categoryAvailability";
import { fetchProductCategoryRows, fetchStoreCategories, type StoreCategory } from "@/lib/catalogData";
import { fetchAllShopifyProducts } from "@/lib/shopify";
import { useClientSaleVisibility } from "@/hooks/useClientSaleVisibility";
import { useIsFranchisee } from "@/hooks/useIsFranchisee";
import { isClientProductVisible } from "@/lib/clientSaleVisibility";

export type Category = StoreCategory;

export function useCategoryTree() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const { blockedVariantIds, loading: saleLoading } = useClientSaleVisibility();
  const { isFranchisee, loading: franchiseLoading } = useIsFranchisee();

  useEffect(() => {
    if (saleLoading || franchiseLoading) return;
    let active = true;
    Promise.all([
      fetchStoreCategories(),
      fetchProductCategoryRows(),
      fetchAllShopifyProducts(),
    ]).then(([allCategories, links, products]) => {
        if (!active) return;
        setCategories(categoriesWithLinkedProducts(
          allCategories,
          links,
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
