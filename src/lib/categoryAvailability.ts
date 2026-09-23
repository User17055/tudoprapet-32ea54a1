export type CatalogCategory = {
  id: string;
  parent_id: string | null;
};

export type ProductCategoryLink = {
  category_id: string;
  shopify_product_id?: string;
};

/**
 * Mantém categorias ligadas a um produto existente no catálogo atual e também
 * as categorias mães dessas categorias. Sem os ancestrais o menu perde o ramo
 * inteiro (o atalho de pet e o filtro do catálogo dependem da categoria raiz)
 * e os subgrupos ficam inalcançáveis.
 */
export function categoriesWithLinkedProducts<T extends CatalogCategory>(
  categories: T[],
  links: ProductCategoryLink[],
  currentProductIds?: ReadonlySet<string>,
): T[] {
  const linkedCategoryIds = new Set(
    links
      .filter((link) => (
        !currentProductIds
        || (typeof link.shopify_product_id === "string" && currentProductIds.has(link.shopify_product_id))
      ))
      .map((link) => link.category_id),
  );

  const byId = new Map(categories.map((category) => [category.id, category]));
  const visibleIds = new Set<string>();
  for (const category of categories) {
    if (!linkedCategoryIds.has(category.id)) continue;
    let current: T | undefined = category;
    while (current && !visibleIds.has(current.id)) {
      visibleIds.add(current.id);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
  }

  return categories.filter((category) => visibleIds.has(category.id));
}
