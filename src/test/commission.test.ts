import { describe, expect, it } from "vitest";
import { commissionForLine, commissionOnProducts, commissionStatus, selectCommissionRule } from "../../supabase/functions/_shared/commission.ts";

describe("comissões sobre vendas", () => {
  it("prioriza produto, depois subgrupo, grupo geral e loja", () => {
    const categories = [
      { id: "racao", parent_id: null },
      { id: "seca", parent_id: "racao" },
      { id: "natural", parent_id: "racao" },
    ];
    const rules = [
      { id: "racao-rule", scope: "category" as const, category_id: "racao", shopify_product_id: null, percent: 3 },
      { id: "seca-rule", scope: "category" as const, category_id: "seca", shopify_product_id: null, percent: 5 },
      { id: "item-rule", scope: "product" as const, category_id: null, shopify_product_id: "item", percent: 8 },
    ];
    expect(selectCommissionRule("item", ["seca"], categories, rules, 1).percent).toBe(8);
    expect(selectCommissionRule("outro", ["seca"], categories, rules, 1).percent).toBe(5);
    expect(selectCommissionRule("outro", ["natural"], categories, rules, 1).percent).toBe(3);
    expect(selectCommissionRule("outro", [], categories, rules, 1).percent).toBe(1);
    expect(commissionForLine(99.9, 5)).toBe(5);
  });
  it("só calcula comissão depois do pagamento confirmado", () => {
    const items = [{ lineTotal: 100 }, { lineTotal: 50 }];
    expect(commissionOnProducts(items, 5, "pending")).toEqual({ productsTotal: 150, commissionAmount: 0 });
    expect(commissionOnProducts(items, 5, "paid")).toEqual({ productsTotal: 150, commissionAmount: 7.5 });
  });

  it("desconsidera frete, estorno e cobrança apenas criada", () => {
    expect(commissionStatus("awaiting_payment", ["pending"])).toBe("pending");
    expect(commissionStatus("shopify_created", ["confirmed"])).toBe("paid");
    expect(commissionStatus("shopify_created", ["confirmed", "refunded"])).toBe("reversed");
    expect(commissionOnProducts([{ lineTotal: 40 }], 5, "reversed").commissionAmount).toBe(0);
  });
});
