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
  it("mantém somente a categoria ligada diretamente ao produto", () => {
    expect(categoriesWithLinkedProducts(categories, [{ category_id: "natural" }]).map((item) => item.id))
      .toEqual(["natural"]);
  });

  it("não mostra pais ou categorias irmãs sem vínculo direto", () => {
    const result = categoriesWithLinkedProducts(categories, [{ category_id: "dry" }]);
    expect(result.map((item) => item.id)).toEqual(["dry"]);
    expect(result.map((item) => item.id)).not.toContain("dogs");
    expect(result.map((item) => item.id)).not.toContain("food");
    expect(result.map((item) => item.id)).not.toContain("cats");
    expect(result.map((item) => item.id)).not.toContain("toys");
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

    expect(result.map((item) => item.id)).toEqual(["dry"]);
  });
});
