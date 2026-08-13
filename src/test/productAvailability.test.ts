import { describe, expect, it } from "vitest";
import type { ShopifyProduct } from "@/lib/shopify";
import { isProductAvailable } from "@/lib/productAvailability";

const productWithAvailability = (...availability: boolean[]) => ({
  node: {
    variants: {
      edges: availability.map((availableForSale) => ({ node: { availableForSale } })),
    },
  },
}) as ShopifyProduct;

describe("isProductAvailable", () => {
  it("returns false when every variant is unavailable", () => {
    expect(isProductAvailable(productWithAvailability(false, false))).toBe(false);
  });

  it("returns true when at least one variant is available", () => {
    expect(isProductAvailable(productWithAvailability(false, true))).toBe(true);
  });
});
