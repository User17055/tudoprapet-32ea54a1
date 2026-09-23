import { describe, expect, it } from "vitest";
import { categoriesWithLinkedProducts } from "@/lib/categoryAvailability";

const categories = [
  { id: "dogs", name: "Cães", parent_id: null },
  { id: "food", name: "Alimentação", parent_id: "dogs" },
  { id: "dry", name: "Ração seca", parent_id: "food" },
  { id: "natural", name: "Ração natural", parent_id: "food" },
  { id: "toys", name: "Brinquedos", parent_id: "dogs" },
  { id: "cats", name: "Gatos", parent_id: null },
];

describe("categorias disponíveis no catálogo", () => {
  it("mantém a categoria ligada ao produto e toda a cadeia de mães", () => {
    expect(categoriesWithLinkedProducts(categories, [{ category_id: "natural" }]).map((item) => item.id))
      .toEqual(["dogs", "food", "natural"]);
  });

  it("não mostra categorias irmãs sem vínculo", () => {
    const result = categoriesWithLinkedProducts(categories, [{ category_id: "dry" }]);
    expect(result.map((item) => item.id)).toEqual(["dogs", "food", "dry"]);
    expect(result.map((item) => item.id)).not.toContain("natural");
    expect(result.map((item) => item.id)).not.toContain("toys");
    expect(result.map((item) => item.id)).not.toContain("cats");
  });

  it("não exibe categorias quando não há vínculos", () => {
    expect(categoriesWithLinkedProducts(categories, [])).toEqual([]);
  });

  it("ignora vínculos antigos de produtos que não existem mais no catálogo", () => {
    const result = categoriesWithLinkedProducts(
      categories,
      [
        { category_id: "dry", shopify_product_id: "current" },
        { category_id: "toys", shopify_product_id: "removed" },
      ],
      new Set(["current"]),
    );

    expect(result.map((item) => item.id)).toEqual(["dogs", "food", "dry"]);
  });
});
