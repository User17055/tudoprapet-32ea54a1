export type CatalogCategory = {
  id: string;
  parent_id: string | null;
};

export type ProductCategoryLink = {
  category_id: string;
  shopify_product_id?: string;
};

/** Mantém categorias ligadas diretamente a um produto existente no catálogo atual. */
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
  return categories.filter((category) => linkedCategoryIds.has(category.id));
}
