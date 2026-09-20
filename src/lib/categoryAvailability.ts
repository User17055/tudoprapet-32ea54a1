export type CatalogCategory = {
  id: string;
  parent_id: string | null;
};

export type ProductCategoryLink = {
  category_id: string;
};

/**
 * Mantém categorias com produto vinculado e seus ancestrais. Assim um ramo
 * vazio desaparece, mas os pais necessários para chegar a uma subcategoria
 * que possui produtos continuam visíveis.
 */
export function categoriesWithLinkedProducts<T extends CatalogCategory>(
  categories: T[],
  links: ProductCategoryLink[],
): T[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const visibleIds = new Set<string>();

  for (const link of links) {
    let current = byId.get(link.category_id);
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      visibleIds.add(current.id);
      visited.add(current.id);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
  }

  return categories.filter((category) => visibleIds.has(category.id));
}
