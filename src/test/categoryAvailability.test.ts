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
  it("mantém somente a categoria vinculada e os pais necessários", () => {
    expect(categoriesWithLinkedProducts(categories, [{ category_id: "natural" }]).map((item) => item.id))
      .toEqual(["dogs", "food", "natural"]);
  });

  it("oculta todo um ramo quando ele não possui produto vinculado", () => {
    const result = categoriesWithLinkedProducts(categories, [{ category_id: "dry" }]);
    expect(result.map((item) => item.id)).toEqual(["dogs", "food", "dry"]);
    expect(result.map((item) => item.id)).not.toContain("cats");
    expect(result.map((item) => item.id)).not.toContain("toys");
  });

  it("não exibe categorias quando não há vínculos", () => {
    expect(categoriesWithLinkedProducts(categories, [])).toEqual([]);
  });
});
