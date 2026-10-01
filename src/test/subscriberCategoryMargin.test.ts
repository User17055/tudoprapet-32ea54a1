import { describe, expect, it } from "vitest";
import { priceFromCostAndMargin, subscriberMarginForProduct } from "../../supabase/functions/_shared/subscriber-category.ts";

const categories = [
  { id: "dogs", parent_id: null },
  { id: "medicine", parent_id: "dogs" },
  { id: "flea", parent_id: "medicine" },
];
const links = [{ shopify_product_id: "product-1", category_id: "flea" }];

describe("margem de assinante por categoria", () => {
  it("usa a regra mais especifica da hierarquia", () => {
    expect(subscriberMarginForProduct("product-1", categories, links, [
      { category_id: "dogs", percent: 5 },
      { category_id: "medicine", percent: 8 },
      { category_id: "flea", percent: 12 },
    ])).toBe(12);
  });

  it("herda a regra do grupo pai", () => {
    expect(subscriberMarginForProduct("product-1", categories, links, [
      { category_id: "dogs", percent: 5 },
      { category_id: "medicine", percent: 8 },
    ])).toBe(8);
  });

  it("usa 5% quando nenhuma categoria possui regra", () => {
    expect(subscriberMarginForProduct("product-1", categories, links, [])).toBe(5);
    expect(priceFromCostAndMargin(100, 5)).toBe(105);
  });
});
