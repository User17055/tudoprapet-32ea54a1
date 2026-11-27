import { describe, expect, it } from "vitest";
import {
  categoryWithDescendants,
  changedSince,
  isStale,
  listRole,
  matchesOlistFilter,
  olistListPrice,
  olistSalePrice,
  olistSkuKey,
  type OlistProduct,
  type RowComparison,
} from "@/lib/olistComparison";

const product = (overrides: Partial<OlistProduct> = {}): OlistProduct => ({
  id: "341237229",
  sku: "10000556",
  skuKey: "10000556",
  name: "Celesporin 600 mg",
  price: 133.45,
  promoPrice: null,
  cost: 83.42,
  status: "A",
  fetchedAt: "2026-11-26T15:00:00Z",
  ...overrides,
});

const franqueados = { id: "1872", name: "Franqueados", adjustmentPercent: 0 };
const planoSF = { id: "1871", name: "Plano São Francisco", adjustmentPercent: 0 };

const comparison = (overrides: Partial<RowComparison> = {}): RowComparison => ({
  hasSku: true,
  olist: product(),
  siteCost: 83.42,
  siteSale: 133.45,
  siteFranchise: 83.42,
  siteSubscriber: 87.59,
  franchiseList: 83.42,
  subscriberList: 87.59,
  ...overrides,
});

describe("preço das listas da Olist (formato conferido em 26/11/2026)", () => {
  it("usa o promocional da exceção (Franqueados: preço 78,43, promocional 41,28 = custo)", () => {
    expect(olistListPrice(franqueados, product(), { listId: "1872", productId: "341237229", price: 78.43, promoPrice: 41.28 })).toBe(41.28);
  });

  it("sem promocional na exceção, vale o preço da exceção", () => {
    expect(olistListPrice(franqueados, product(), { listId: "1872", productId: "341237229", price: 10, promoPrice: null })).toBe(10);
  });

  it("sem exceção, vale o preço de venda com o acréscimo/desconto da lista", () => {
    expect(olistListPrice(planoSF, product(), null)).toBe(133.45);
    // As duas listas reais têm 0%; arredondamento de meio centavo da Olist não foi conferido.
    expect(olistListPrice({ ...planoSF, adjustmentPercent: -10 }, product({ price: 100 }), null)).toBe(90);
    expect(olistListPrice(planoSF, product({ promoPrice: 100 }), null)).toBe(100);
    expect(olistListPrice(planoSF, null, null)).toBeNull();
  });

  it("reconhece qual lista é a da franquia e qual é a do Clube pelo nome", () => {
    expect(listRole(franqueados)).toBe("franchise");
    expect(listRole(planoSF)).toBe("subscriber");
    expect(listRole({ id: "9", name: "Atacado", adjustmentPercent: 0 })).toBeNull();
  });
});

describe("chave do SKU e preço de venda", () => {
  it("igual ao servidor: tira espaços e põe maiúsculas, mas não tira zero à esquerda", () => {
    expect(olistSkuKey(" c55nia ")).toBe("C55NIA");
    expect(olistSkuKey("05244")).toBe("05244");
    expect(olistSkuKey(null)).toBe("");
  });

  it("venda da Olist é a promoção quando existe", () => {
    expect(olistSalePrice(product({ promoPrice: 99.9 }))).toBe(99.9);
    expect(olistSalePrice(product())).toBe(133.45);
    expect(olistSalePrice(null)).toBeNull();
  });
});

describe("filtros de comparação com a Olist", () => {
  it("tudo igual não aparece em nenhum filtro de diferença", () => {
    for (const filter of ["cost_diff", "sale_diff", "franchise_list_diff", "subscriber_list_diff", "not_in_olist", "olist_no_cost", "no_sku"] as const) {
      expect(matchesOlistFilter(comparison(), filter)).toBe(false);
    }
    expect(matchesOlistFilter(comparison(), "all")).toBe(true);
  });

  it("custo: diferente ou ainda não importado no site", () => {
    expect(matchesOlistFilter(comparison({ siteCost: 80 }), "cost_diff")).toBe(true);
    expect(matchesOlistFilter(comparison({ siteCost: null }), "cost_diff")).toBe(true);
    expect(matchesOlistFilter(comparison({ siteCost: 83.424 }), "cost_diff")).toBe(false);
  });

  it("listas: franquia abaixo do custo na Olist aparece como diferença", () => {
    expect(matchesOlistFilter(comparison({ franchiseList: 25 }), "franchise_list_diff")).toBe(true);
    expect(matchesOlistFilter(comparison({ subscriberList: 140 }), "subscriber_list_diff")).toBe(true);
  });

  it("fora do catálogo, sem custo na Olist e sem SKU", () => {
    expect(matchesOlistFilter(comparison({ olist: null }), "not_in_olist")).toBe(true);
    expect(matchesOlistFilter(comparison({ olist: null, hasSku: false }), "not_in_olist")).toBe(false);
    expect(matchesOlistFilter(comparison({ olist: null, hasSku: false }), "no_sku")).toBe(true);
    expect(matchesOlistFilter(comparison({ olist: product({ cost: null }) }), "olist_no_cost")).toBe(true);
  });
});

describe("datas", () => {
  const now = Date.parse("2026-11-26T12:00:00Z");

  it("conferido há mais de N dias (nunca conferido conta)", () => {
    expect(isStale(null, 7, now)).toBe(true);
    expect(isStale("2026-11-18T12:00:00Z", 7, now)).toBe(true);
    expect(isStale("2026-11-20T12:00:00Z", 7, now)).toBe(false);
  });

  it("alterado desde uma data (qualquer um dos valores)", () => {
    expect(changedSince([null, "2026-11-25T15:00:00Z"], "2026-11-25")).toBe(true);
    expect(changedSince(["2026-11-10T15:00:00Z", null], "2026-11-25")).toBe(false);
    expect(changedSince([null, undefined], "2026-11-25")).toBe(false);
  });
});

describe("categoria com subcategorias", () => {
  it("inclui filhos e netos, sem laço infinito", () => {
    const categories = [
      { id: "cao", parent_id: null },
      { id: "racao", parent_id: "cao" },
      { id: "seca", parent_id: "racao" },
      { id: "gato", parent_id: null },
      { id: "loop", parent_id: "loop" },
    ];
    expect([...categoryWithDescendants("cao", categories)].sort()).toEqual(["cao", "racao", "seca"]);
    expect([...categoryWithDescendants("loop", categories)]).toEqual(["loop"]);
  });
});
