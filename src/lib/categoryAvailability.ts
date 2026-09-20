export type CatalogCategory = {
  id: string;
  parent_id: string | null;
};

export type ProductCategoryLink = {
  category_id: string;
};

/** Mantém somente categorias que possuem ao menos um produto ligado diretamente. */
export function categoriesWithLinkedProducts<T extends CatalogCategory>(
  categories: T[],
  links: ProductCategoryLink[],
): T[] {
  const linkedCategoryIds = new Set(links.map((link) => link.category_id));
  return categories.filter((category) => linkedCategoryIds.has(category.id));
}
