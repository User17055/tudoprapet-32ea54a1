import { describe, expect, it } from "vitest";
import {
  MAX_ITEMS,
  MAX_QUANTITY,
  parseCheckoutItems,
} from "../../supabase/functions/_shared/validation.ts";

const VALID = { variantId: "gid://shopify/ProductVariant/111", quantity: 2 };

function rejectionOf(raw: unknown): string {
  const result = parseCheckoutItems(raw);
  if (result.ok) throw new Error("esperava rejeição, mas passou");
  return result.message;
}

describe("parseCheckoutItems", () => {
  it("accepts a well formed cart", () => {
    const result = parseCheckoutItems([VALID]);
    expect(result).toEqual({ ok: true, value: [VALID] });
  });

  it("drops unknown fields instead of forwarding them to Shopify", () => {
    const result = parseCheckoutItems([{ ...VALID, price: 0.01, admin: true }]);
    expect(result.ok && result.value[0]).toEqual(VALID);
  });

  it("keeps the original message for an empty cart", () => {
    // O frontend já trata essa mensagem — não pode mudar.
    expect(rejectionOf([])).toBe("Carrinho vazio");
    expect(rejectionOf(undefined)).toBe("Carrinho vazio");
    expect(rejectionOf(null)).toBe("Carrinho vazio");
    expect(rejectionOf("nao e array")).toBe("Carrinho vazio");
  });

  it("rejects a cart above the item limit", () => {
    const huge = Array.from({ length: MAX_ITEMS + 1 }, () => VALID);
    expect(rejectionOf(huge)).toContain(String(MAX_ITEMS));
  });

  it("rejects entries that are not objects", () => {
    expect(rejectionOf(["gid://shopify/ProductVariant/111"])).toBe("Item inválido no carrinho");
    expect(rejectionOf([null])).toBe("Item inválido no carrinho");
  });

  it("rejects malformed variant ids", () => {
    const bad = [
      "111",
      "gid://shopify/Product/111",
      "gid://shopify/ProductVariant/",
      "gid://shopify/ProductVariant/abc",
      "gid://shopify/ProductVariant/111 OR 1=1",
      "",
    ];
    for (const variantId of bad) {
      expect(rejectionOf([{ variantId, quantity: 1 }])).toBe("Identificador de produto inválido");
    }
  });

  it("rejects a variant id that is not a string", () => {
    expect(rejectionOf([{ variantId: 111, quantity: 1 }]))
      .toBe("Identificador de produto inválido");
  });

  it("rejects non integer quantities", () => {
    for (const quantity of [1.5, NaN, Infinity, "2", null]) {
      expect(rejectionOf([{ ...VALID, quantity }])).toBe("Quantidade inválida");
    }
  });

  it("rejects zero, negative and absurd quantities", () => {
    for (const quantity of [0, -1, -999, MAX_QUANTITY + 1]) {
      expect(rejectionOf([{ ...VALID, quantity }])).toContain("entre 1 e");
    }
  });

  it("reports the first offending item of a mixed cart", () => {
    expect(rejectionOf([VALID, { ...VALID, quantity: -1 }])).toContain("entre 1 e");
  });
});
