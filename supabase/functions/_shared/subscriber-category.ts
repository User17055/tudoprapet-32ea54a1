export type SubscriberCategory = { id: string; parent_id: string | null };
export type SubscriberCategoryRule = { category_id: string; percent: number | string };
export type SubscriberProductCategory = { shopify_product_id: string; category_id: string };

/** A regra da categoria mais profunda prevalece; sem regra, usa 5%. */
export function subscriberMarginForProduct(
  productId: string,
  categories: SubscriberCategory[],
  links: SubscriberProductCategory[],
  rules: SubscriberCategoryRule[],
  fallback = 5,
): number {
  const parentById = new Map(categories.map((category) => [category.id, category.parent_id]));
  const ruleByCategory = new Map(rules.map((rule) => [rule.category_id, Number(rule.percent)]));
  let selected: { percent: number; depth: number } | null = null;
  const depthOf = (id: string) => {
    let depth = 0;
    let current: string | null = id;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      depth += 1;
      current = parentById.get(current) ?? null;
    }
    return depth;
  };

  for (const assignedId of links.filter((link) => link.shopify_product_id === productId).map((link) => link.category_id)) {
    let categoryId: string | null = assignedId;
    const visited = new Set<string>();
    while (categoryId && !visited.has(categoryId)) {
      visited.add(categoryId);
      const percent = ruleByCategory.get(categoryId);
      if (percent !== undefined && Number.isFinite(percent) && percent >= 0) {
        const specificity = depthOf(categoryId);
        if (!selected || specificity > selected.depth) selected = { percent, depth: specificity };
        break;
      }
      categoryId = parentById.get(categoryId) ?? null;
    }
  }
  return selected?.percent ?? fallback;
}

export function priceFromCostAndMargin(cost: number, percent: number): number {
  return Math.round((cost * (1 + percent / 100) + Number.EPSILON) * 100) / 100;
}
