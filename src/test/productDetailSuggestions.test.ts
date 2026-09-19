import { describe, expect, it } from "vitest";
import { suggestProductDetails } from "@/lib/productDetailSuggestions";

const categories = [
  { id: "dogs", name: "Cães", parent_id: null },
  { id: "dog-food", name: "Alimentação", parent_id: "dogs" },
  { id: "dog-dry", name: "Ração seca", parent_id: "dog-food" },
  { id: "dog-wet", name: "Ração úmida", parent_id: "dog-food" },
  { id: "cats", name: "Gatos", parent_id: null },
  { id: "cat-dry", name: "Ração seca", parent_id: "cats" },
];

it("sugere cães, ração seca, grãos e a marca encontrada", () => {
  const result = suggestProductDetails(
    { title: "Ração Premier Cães Adultos Frango 15 kg", vendor: "Premier Pet" },
    categories,
    [{ id: "premier", name: "Premier" }, { id: "golden", name: "Golden" }],
    [
      { attr_key: "Pet", attr_value: "Cães" },
      { attr_key: "Pet", attr_value: "Gatos" },
      { attr_key: "Formato", attr_value: "Grãos" },
      { attr_key: "Idade", attr_value: "Adultos" },
    ],
  );

  expect(result.rootCategoryId).toBe("dogs");
  expect(result.categoryIds).toEqual(["dogs", "dog-food", "dog-dry"]);
  expect(result.brandId).toBe("premier");
  expect(result.attributes).toEqual(expect.arrayContaining([
    { attr_key: "Pet", attr_value: "Cães" },
    { attr_key: "Formato", attr_value: "Grãos" },
    { attr_key: "Idade", attr_value: "Adultos" },
  ]));
});

it("não mistura categorias de gatos e cães", () => {
  const result = suggestProductDetails(
    { title: "Ração seca para gatos castrados" },
    categories,
    [],
    [],
  );
  expect(result.categoryIds).toEqual(["cats", "cat-dry"]);
  expect(result.categoryIds).not.toContain("dog-dry");
});

it("reconhece sachê como ração úmida", () => {
  const result = suggestProductDetails(
    { title: "Sachê para Cães sabor carne" },
    categories,
    [],
    [{ attr_key: "Tipo", attr_value: "Ração úmida" }],
  );
  expect(result.categoryIds).toEqual(["dogs", "dog-food", "dog-wet"]);
  expect(result.attributes).toContainEqual({ attr_key: "Tipo", attr_value: "Ração úmida" });
});
