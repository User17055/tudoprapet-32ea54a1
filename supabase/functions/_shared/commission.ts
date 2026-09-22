export type CommissionStatus = "paid" | "pending" | "reversed";

export type CommissionRule = {
  id: string;
  scope: "category" | "product";
  category_id: string | null;
  shopify_product_id: string | null;
  percent: number;
};

export type CommissionCategory = { id: string; parent_id: string | null };

export function selectCommissionRule(
  productId: string,
  categoryIds: string[],
  categories: CommissionCategory[],
  rules: CommissionRule[],
  storePercent: number,
): { percent: number; scope: "store" | "category" | "product"; ruleId: string | null; categoryId: string | null } {
  const productRule = rules.find((rule) => rule.scope === "product" && rule.shopify_product_id === productId);
  if (productRule) return { percent: Number(productRule.percent), scope: "product", ruleId: productRule.id, categoryId: null };

  const parents = new Map(categories.map((category) => [category.id, category.parent_id]));
  const categoryRules = new Map(rules.filter((rule) => rule.scope === "category").map((rule) => [rule.category_id, rule]));
  const matches: Array<{ rule: CommissionRule; distance: number }> = [];
  for (const assignedId of categoryIds) {
    let id: string | null = assignedId;
    const visited = new Set<string>();
    let distance = 0;
    while (id && !visited.has(id)) {
      visited.add(id);
      const rule = categoryRules.get(id);
      if (rule) matches.push({ rule, distance });
      id = parents.get(id) ?? null;
      distance++;
    }
  }
  matches.sort((a, b) => a.distance - b.distance || a.rule.id.localeCompare(b.rule.id));
  const match = matches[0]?.rule;
  return match
    ? { percent: Number(match.percent), scope: "category", ruleId: match.id, categoryId: match.category_id }
    : { percent: storePercent, scope: "store", ruleId: null, categoryId: null };
}

export function commissionForLine(lineTotal: number, percent: number): number {
  return Math.round((Number(lineTotal) || 0) * percent) / 100;
}

export function commissionStatus(sessionStatus: string, paymentStatuses: string[]): CommissionStatus {
  if (["cancelled", "expired", "failed"].includes(sessionStatus)
    || paymentStatuses.some((status) => ["refunded", "chargeback"].includes(status))) return "reversed";
  if (paymentStatuses.some((status) => ["confirmed", "received"].includes(status))) return "paid";
  return "pending";
}

export function commissionOnProducts(
  items: Array<{ lineTotal?: number | null }>,
  percent: number,
  status: CommissionStatus,
) {
  const productsTotal = Math.round(items.reduce((sum, item) => sum + (Number(item.lineTotal) || 0), 0) * 100) / 100;
  return {
    productsTotal,
    commissionAmount: status === "paid" && Number.isFinite(percent)
      ? Math.round(productsTotal * percent) / 100 : 0,
  };
}
