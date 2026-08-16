import { describe, expect, it } from "vitest";
import {
  buildDraftLineItems,
  buildShippingLine,
  CHECKOUT_SERVICE_FEE,
  gidToNumericId,
  toGraphqlDraftLineItems,
  type LineItem,
} from "../../supabase/functions/_shared/pricing.ts";

describe("checkout sem taxa de serviço", () => {
  it("mantém a taxa operacional zerada para novos pedidos", () => {
    expect(CHECKOUT_SERVICE_FEE).toBe(0);
  });

  it("mantém a modalidade de entrega separada dos produtos", () => {
    expect(buildShippingLine("PAC", 24.9)).toEqual({
      title: "PAC",
      price: "24.90",
    });
    expect(buildShippingLine("Retirada na loja", 0)).toEqual({
      title: "Retirada na loja",
      price: "0.00",
    });
  });
});


const VARIANT_A = "gid://shopify/ProductVariant/111";
const VARIANT_B = "gid://shopify/ProductVariant/222";

function itemsOf(...items: LineItem[]): LineItem[] {
  return items;
}

describe("gidToNumericId", () => {
  it("extracts the numeric id from a Shopify GID", () => {
    expect(gidToNumericId(VARIANT_A)).toBe("111");
  });

  it("returns the input when there is no slash to split on", () => {
    expect(gidToNumericId("333")).toBe("333");
  });
});

describe("buildDraftLineItems", () => {
  it("maps variant id and quantity onto every line", () => {
    const lines = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 2 }),
      new Map(),
      new Map(),
      "Clube TudoPraPet",
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].variant_id).toBe(111);
    expect(lines[0].quantity).toBe(2);
  });

  it("applies no discount when there is no special price", () => {
    const lines = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map(),
      new Map([[VARIANT_A, 100]]),
      "Clube TudoPraPet",
    );

    expect(lines[0].applied_discount).toBeUndefined();
  });

  it("applies no discount when the current price is unknown", () => {
    const lines = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map([[VARIANT_A, 80]]),
      new Map(),
      "Clube TudoPraPet",
    );

    expect(lines[0].applied_discount).toBeUndefined();
  });

  it("never creates a negative discount when the special price is not cheaper", () => {
    const equal = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map([[VARIANT_A, 100]]),
      new Map([[VARIANT_A, 100]]),
      "Clube TudoPraPet",
    );
    const moreExpensive = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map([[VARIANT_A, 120]]),
      new Map([[VARIANT_A, 100]]),
      "Clube TudoPraPet",
    );

    expect(equal[0].applied_discount).toBeUndefined();
    expect(moreExpensive[0].applied_discount).toBeUndefined();
  });

  it("discounts the difference per unit and multiplies the amount by quantity", () => {
    const lines = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 3 }),
      new Map([[VARIANT_A, 79.99]]),
      new Map([[VARIANT_A, 100]]),
      "Clube TudoPraPet",
    );

    expect(lines[0].applied_discount).toEqual({
      description: "Clube TudoPraPet",
      value_type: "fixed_amount",
      value: "20.01",
      amount: "60.03",
      title: "Clube TudoPraPet",
    });
  });

  it("rounds away floating point noise in the per-unit discount", () => {
    const lines = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map([[VARIANT_A, 19.9]]),
      new Map([[VARIANT_A, 29.9]]),
      "Franquia TudoPraPet",
    );

    // 29.9 - 19.9 dá 10.000000000000002 em ponto flutuante.
    expect((lines[0].applied_discount as Record<string, string>).value).toBe("10.00");
  });

  it("uses the given label on both description and title", () => {
    const lines = buildDraftLineItems(
      itemsOf({ variantId: VARIANT_A, quantity: 1 }),
      new Map([[VARIANT_A, 50]]),
      new Map([[VARIANT_A, 60]]),
      "Franquia TudoPraPet",
    );

    const discount = lines[0].applied_discount as Record<string, string>;
    expect(discount.description).toBe("Franquia TudoPraPet");
    expect(discount.title).toBe("Franquia TudoPraPet");
  });

  it("discounts only the items that have a special price", () => {
    const lines = buildDraftLineItems(
      itemsOf(
        { variantId: VARIANT_A, quantity: 1 },
        { variantId: VARIANT_B, quantity: 1 },
      ),
      new Map([[VARIANT_A, 50]]),
      new Map([[VARIANT_A, 60], [VARIANT_B, 60]]),
      "Clube TudoPraPet",
    );

    expect(lines[0].applied_discount).toBeDefined();
    expect(lines[1].applied_discount).toBeUndefined();
  });
});

describe("toGraphqlDraftLineItems", () => {
  it("preserva a variante real em vez de criar um item personalizado", () => {
    const [line] = toGraphqlDraftLineItems([
      { variant_id: 111, quantity: 2 },
    ]);
    expect(line).toEqual({
      variantId: VARIANT_A,
      quantity: 2,
    });
  });

  it("converte o desconto unitário REST para o total fixo da linha GraphQL", () => {
    const [line] = toGraphqlDraftLineItems([{
      variant_id: 111,
      quantity: 3,
      applied_discount: {
        description: "Clube TudoPraPet",
        title: "Clube TudoPraPet",
        value: "10.00",
        amount: "30.00",
      },
    }]);
    expect(line.appliedDiscount).toEqual({
      description: "Clube TudoPraPet",
      title: "Clube TudoPraPet",
      valueType: "FIXED_AMOUNT",
      value: 30,
    });
  });
});
