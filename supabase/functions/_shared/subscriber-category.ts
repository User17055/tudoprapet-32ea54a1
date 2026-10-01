export type SubscriberCategory = { id: string; parent_id: string | null; name?: string };
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

const normalizedCategoryName = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .toLocaleLowerCase("pt-BR");

/** Considera Racao tanto quando atribuida diretamente quanto como grupo pai. */
export function isProductInFeedCategory(
  productId: string,
  categories: SubscriberCategory[],
  links: SubscriberProductCategory[],
): boolean {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const assignedIds = links
    .filter((link) => link.shopify_product_id === productId)
    .map((link) => link.category_id);

  return assignedIds.some((assignedId) => {
    let categoryId: string | null = assignedId;
    const visited = new Set<string>();
    while (categoryId && !visited.has(categoryId)) {
      visited.add(categoryId);
      const category = byId.get(categoryId);
      if (!category) return false;
      const name = normalizedCategoryName(category.name || "");
      if (name === "racao" || name === "racoes") return true;
      categoryId = category.parent_id;
    }
    return false;
  });
}

/** Regra fixa de Racao: ate 7,5 kg +60%; acima de 7,5 kg +40%. */
export function feedMarginForWeight(packageWeightKg: number | null | undefined): number | null {
  const weight = Number(packageWeightKg);
  if (!Number.isFinite(weight) || weight <= 0) return null;
  return weight > 7.5 ? 40 : 60;
}

export function subscriberMarginWithFeedRule(
  productId: string,
  packageWeightKg: number | null | undefined,
  categories: SubscriberCategory[],
  links: SubscriberProductCategory[],
  rules: SubscriberCategoryRule[],
  fallback = 5,
): number {
  const feedMargin = isProductInFeedCategory(productId, categories, links)
    ? feedMarginForWeight(packageWeightKg)
    : null;
  return feedMargin ?? subscriberMarginForProduct(productId, categories, links, rules, fallback);
}

export function priceFromCostAndMargin(cost: number, percent: number): number {
  return Math.round((cost * (1 + percent / 100) + Number.EPSILON) * 100) / 100;
}
