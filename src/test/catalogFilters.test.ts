import { describe, expect, it } from "vitest";
import {
  PRICE_RANGES,
  buildCatalogParams,
  buildCategoryIndex,
  categoryDescendants,
  categoryPath,
  computeCatalogFacets,
  parseCatalogParams,
  priceInRange,
  resolveCategory,
  type FacetProduct,
} from "@/lib/catalogFilters";

const categories = [
  { id: "dog", slug: "cachorro", name: "Cachorro", parent_id: null },
  { id: "dog-food", slug: "racao", name: "Ração", parent_id: "dog" },
  { id: "dog-dry", slug: "racao-seca", name: "Ração Seca", parent_id: "dog-food" },
  { id: "dog-treats", slug: "petiscos", name: "Petiscos", parent_id: "dog" },
  { id: "cat", slug: "gato", name: "Gato", parent_id: null },
  { id: "cat-food", slug: "racao", name: "Ração", parent_id: "cat" },
];
const index = buildCategoryIndex(categories);
const parentOf = new Map(categories.map((c) => [c.id, c.parent_id]));

const product = (
  id: string,
  price: number,
  brandId: string | null,
  categoryIds: string[],
  attrs: Record<string, string[]> = {},
): FacetProduct => ({
  id,
  price,
  brandId,
  categoryIds: new Set(categoryIds),
  attrs: new Map(Object.entries(attrs).map(([key, values]) => [key, new Set(values)])),
});

const noSelection = { categoryIds: null, brandIds: new Set<string>(), priceKeys: new Set<string>(), attrs: {} };

describe("faixas de preço", () => {
  it("coloca cada preço em uma faixa só, inclusive nas bordas", () => {
    for (const price of [0, 24.99, 25, 50, 100, 200, 999]) {
      expect(PRICE_RANGES.filter((range) => priceInRange(price, range))).toHaveLength(1);
    }
    expect(PRICE_RANGES.find((range) => priceInRange(25, range))?.key).toBe("25-50");
  });
});

describe("filtros na URL", () => {
  it("ida e volta preserva todos os filtros", () => {
    const params = new URLSearchParams(
      "busca=golden&categoria=racao&categoria_id=dog-food&marca=premier&marca=golden&preco=25-50"
      + "&f.Idade=Adulto&f.Idade=Filhote&f.Indica%C3%A7%C3%A3o+Veterin%C3%A1ria=Obesidade&ordem=price-asc&pagina=3",
    );
    const state = parseCatalogParams(params);
    expect(state.search).toBe("golden");
    expect(state.categoryId).toBe("dog-food");
    expect([...state.brandSlugs]).toEqual(["premier", "golden"]);
    expect([...state.attrs.Idade]).toEqual(["Adulto", "Filhote"]);
    expect([...state.attrs["Indicação Veterinária"]]).toEqual(["Obesidade"]);
    expect(state.sort).toBe("price-asc");
    expect(state.page).toBe(3);
    expect(parseCatalogParams(buildCatalogParams(state))).toEqual(state);
  });

  it("ignora valores inválidos e o atributo Pet", () => {
    const state = parseCatalogParams(new URLSearchParams("preco=abc&ordem=x&pagina=-2&f.Pet=Cachorro"));
    expect(state.priceKeys.size).toBe(0);
    expect(state.sort).toBe("relevance");
    expect(state.page).toBe(1);
    expect(state.attrs).toEqual({});
  });

  it("aceita o formato antigo ?pet=", () => {
    expect(parseCatalogParams(new URLSearchParams("pet=Cachorro")).categorySlug).toBe("Cachorro");
  });
});

describe("árvore de categorias", () => {
  it("monta caminho e descendentes", () => {
    expect(categoryPath(index, "dog-dry").map((c) => c.id)).toEqual(["dog", "dog-food", "dog-dry"]);
    expect([...categoryDescendants(index, "dog")].sort()).toEqual(["dog", "dog-dry", "dog-food", "dog-treats"]);
  });

  it("o ID decide entre slugs repetidos; sem ID, a raiz tem preferência", () => {
    expect(resolveCategory(categories, "racao", "cat-food")?.id).toBe("cat-food");
    expect(resolveCategory(categories, "racao", null)?.id).toBe("dog-food");
    expect(resolveCategory(categories, "Cachorro", null)?.id).toBe("dog");
    expect(resolveCategory(categories, "ave", null)).toBeUndefined();
  });
});

describe("facetas", () => {
  const products = [
    product("p1", 10, "golden", ["dog-dry"], { Idade: ["Adulto"] }),
    product("p2", 30, "premier", ["dog-dry", "dog"], { Idade: ["Filhote"] }),
    product("p3", 60, "whiskas", ["cat-food"], { Idade: ["Adulto"] }),
    product("p4", 15, "golden", ["dog-treats"], { Idade: ["Adulto", "Adulto"] }),
  ];

  it("conta categorias somando descendentes, cada produto uma vez", () => {
    const result = computeCatalogFacets(products, noSelection, parentOf);
    expect(result.categoryCounts.get("dog")).toBe(3);
    expect(result.categoryCounts.get("dog-food")).toBe(2);
    expect(result.categoryCounts.get("cat")).toBe(1);
  });

  it("marca conta só dentro da categoria escolhida", () => {
    const result = computeCatalogFacets(
      products,
      { ...noSelection, categoryIds: categoryDescendants(index, "dog") },
      parentOf,
    );
    expect([...result.matchingIds].sort()).toEqual(["p1", "p2", "p4"]);
    expect(result.brandCounts.get("whiskas")).toBeUndefined();
    expect(result.brandCounts.get("golden")).toBe(2);
  });

  it("dentro do mesmo grupo soma (OU) e entre grupos restringe (E)", () => {
    const result = computeCatalogFacets(
      products,
      { ...noSelection, brandIds: new Set(["golden"]), attrs: { Idade: new Set(["Adulto"]) } },
      parentOf,
    );
    expect([...result.matchingIds].sort()).toEqual(["p1", "p4"]);
    // O grupo da marca ignora a própria escolha: ainda mostra quantos Premier existem.
    expect(result.brandCounts.get("premier")).toBeUndefined(); // p2 é Filhote
    expect(result.brandCounts.get("whiskas")).toBe(1);
    // O grupo Idade ignora a própria escolha, mas respeita a marca.
    expect(result.attrCounts.get("Idade")?.get("Adulto")).toBe(2);
    expect(result.attrCounts.get("Idade")?.get("Filhote")).toBeUndefined();
  });

  it("faixa de preço conta sem considerar a própria seleção", () => {
    const result = computeCatalogFacets(products, { ...noSelection, priceKeys: new Set(["0-25"]) }, parentOf);
    expect([...result.matchingIds].sort()).toEqual(["p1", "p4"]);
    expect(result.priceCounts.get("25-50")).toBe(1);
    expect(result.priceCounts.get("50-100")).toBe(1);
  });

  it("categoria escolhida sem produto nenhum devolve zero, não a loja inteira", () => {
    const result = computeCatalogFacets(products, { ...noSelection, categoryIds: new Set() }, parentOf);
    expect(result.matchingIds.size).toBe(0);
  });
});
