import { describe, expect, it } from "vitest";
import type { ShopifyProduct } from "@/lib/shopify";
import { isProductAvailable, selectVariationRepresentative } from "@/lib/productAvailability";

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

describe("selectVariationRepresentative", () => {
  const product = (id: string, availableForSale: boolean) => ({
    node: {
      id,
      variants: { edges: [{ node: { availableForSale } }] },
    },
  }) as ShopifyProduct;
  const variations = [
    { shopify_product_id: "1kg" },
    { shopify_product_id: "2.5kg" },
    { shopify_product_id: "15kg" },
  ];

  it("pula a primeira opção esgotada e mostra a próxima disponível", () => {
    const products = new Map([
      ["1kg", product("1kg", false)],
      ["2.5kg", product("2.5kg", true)],
      ["15kg", product("15kg", true)],
    ]);

    expect(selectVariationRepresentative(
      variations,
      products,
      new Set(["1kg", "2.5kg", "15kg"]),
    )).toBe("2.5kg");
  });

  it("mantém a primeira opção quando todas estão esgotadas", () => {
    const products = new Map([
      ["1kg", product("1kg", false)],
      ["2.5kg", product("2.5kg", false)],
    ]);

    expect(selectVariationRepresentative(
      variations,
      products,
      new Set(["1kg", "2.5kg"]),
    )).toBe("1kg");
  });

  it("nunca escolhe uma variação escondida para o perfil", () => {
    const products = new Map([
      ["1kg", product("1kg", true)],
      ["2.5kg", product("2.5kg", true)],
    ]);

    expect(selectVariationRepresentative(
      variations,
      products,
      new Set(["2.5kg"]),
    )).toBe("2.5kg");
  });
});
