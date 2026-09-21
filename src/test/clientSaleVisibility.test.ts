import { describe, expect, it } from "vitest";
import { isClientProductVisible } from "@/lib/clientSaleVisibility";
import type { ShopifyProduct } from "@/lib/shopify";

const product = { node: { variants: { edges: [
  { node: { id: "first" } },
  { node: { id: "second" } },
] } } } as ShopifyProduct;

describe("visibilidade da venda para clientes", () => {
  it("oculta somente quando todas as variantes estão sem margem", () => {
    expect(isClientProductVisible(product, new Set(["first", "second"]), false)).toBe(false);
    expect(isClientProductVisible(product, new Set(["first"]), false)).toBe(true);
  });

  it("mantém o produto visível para franquia e fecha a vitrine sem verificação", () => {
    expect(isClientProductVisible(product, new Set(["first", "second"]), true)).toBe(true);
    expect(isClientProductVisible(product, null, false)).toBe(false);
  });
});
