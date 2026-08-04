import { describe, expect, it } from "vitest";
import {
  indexProductVariations,
  type ProductVariationItem,
} from "@/hooks/useProductVariations";

const item = (
  id: string,
  groupId: string,
  productId: string,
  label: string,
  sortOrder: number,
): ProductVariationItem => ({
  id,
  group_id: groupId,
  shopify_product_id: productId,
  shopify_product_handle: productId,
  shopify_product_title: productId,
  label,
  sort_order: sortOrder,
});

describe("product variation groups", () => {
  it("returns every option in the group for each linked product", () => {
    const indexed = indexProductVariations([
      item("3", "food", "product-15kg", "15 kg", 2),
      item("1", "food", "product-1kg", "1 kg", 0),
      item("2", "food", "product-3kg", "3 kg", 1),
    ]);

    expect(indexed.get("product-1kg")?.map((variation) => variation.label)).toEqual([
      "1 kg",
      "3 kg",
      "15 kg",
    ]);
    expect(indexed.get("product-15kg")).toEqual(indexed.get("product-1kg"));
  });

  it("does not mix products from different groups", () => {
    const indexed = indexProductVariations([
      item("1", "food", "food-1kg", "1 kg", 0),
      item("2", "food", "food-3kg", "3 kg", 1),
      item("3", "snack", "snack-100g", "100 g", 0),
      item("4", "snack", "snack-300g", "300 g", 1),
    ]);

    expect(indexed.get("food-1kg")?.map((variation) => variation.shopify_product_id)).toEqual([
      "food-1kg",
      "food-3kg",
    ]);
    expect(indexed.get("snack-100g")?.map((variation) => variation.shopify_product_id)).toEqual([
      "snack-100g",
      "snack-300g",
    ]);
  });
});
