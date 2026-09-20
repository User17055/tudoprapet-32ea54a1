import { describe, expect, it } from "vitest";
import { suggestProductDetails } from "@/lib/productDetailSuggestions";

const categories = [
  { id: "dogs", name: "Cães", parent_id: null },
  { id: "dog-food", name: "Alimentação", parent_id: "dogs" },
  { id: "dog-dry", name: "Ração seca", parent_id: "dog-food" },
  { id: "dog-wet", name: "Ração úmida", parent_id: "dog-food" },
  { id: "dog-natural", name: "Ração natural", parent_id: "dog-food" },
  { id: "dog-prescription", name: "Ração prescrita", parent_id: "dog-food" },
  { id: "cats", name: "Gatos", parent_id: null },
  { id: "cat-dry", name: "Ração seca", parent_id: "cats" },
  { id: "cat-prescription", name: "Ração prescrita", parent_id: "cats" },
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

it("reconhece ração natural como categoria e tipo de alimento", () => {
  const result = suggestProductDetails(
    { title: "Ração Natural para Cães Adultos 10 kg" },
    categories,
    [],
    [
      { attr_key: "Tipo de alimento", attr_value: "Natural" },
      { attr_key: "Tipo de alimento", attr_value: "Prescrita" },
      { attr_key: "Formato de alimento", attr_value: "Grãos" },
    ],
  );

  expect(result.categoryIds).toEqual(["dogs", "dog-food", "dog-natural"]);
  expect(result.attributes).toEqual(expect.arrayContaining([
    { attr_key: "Tipo de alimento", attr_value: "Natural" },
    { attr_key: "Formato de alimento", attr_value: "Grãos" },
  ]));
  expect(result.attributes).not.toContainEqual({ attr_key: "Tipo de alimento", attr_value: "Prescrita" });
});

it("reconhece ração prescrita sem confundir com ração seca", () => {
  const result = suggestProductDetails(
    { title: "Ração Prescrita para Gatos Adultos 2 kg" },
    categories,
    [],
    [
      { attr_key: "Classificação", attr_value: "Natural" },
      { attr_key: "Classificação", attr_value: "Prescrita" },
      { attr_key: "Formato de alimento", attr_value: "Grãos" },
    ],
  );

  expect(result.categoryIds).toEqual(["cats", "cat-prescription"]);
  expect(result.attributes).toEqual(expect.arrayContaining([
    { attr_key: "Classificação", attr_value: "Prescrita" },
    { attr_key: "Formato de alimento", attr_value: "Grãos" },
  ]));
  expect(result.attributes).not.toContainEqual({ attr_key: "Classificação", attr_value: "Natural" });
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

it("preenche Formato de alimento com Grãos para qualquer ração não úmida", () => {
  const result = suggestProductDetails(
    { title: "Ração para Cães Adultos sabor frango" },
    categories,
    [],
    [
      { attr_key: "Formato de alimento", attr_value: "Grãos" },
      { attr_key: "Formato de alimento", attr_value: "Sachê" },
    ],
  );

  expect(result.attributes).toContainEqual({ attr_key: "Formato de alimento", attr_value: "Grãos" });
  expect(result.attributes).not.toContainEqual({ attr_key: "Formato de alimento", attr_value: "Sachê" });
});

it("não força Grãos no formato de uma ração úmida", () => {
  const result = suggestProductDetails(
    { title: "Ração úmida em sachê para Gatos" },
    categories,
    [],
    [
      { attr_key: "Formato de alimento", attr_value: "Grãos" },
      { attr_key: "Formato de alimento", attr_value: "Sachê" },
      { attr_key: "Formato de alimento", attr_value: "Patê" },
    ],
  );

  expect(result.attributes).toContainEqual({ attr_key: "Formato de alimento", attr_value: "Sachê" });
  expect(result.attributes).not.toContainEqual({ attr_key: "Formato de alimento", attr_value: "Grãos" });
  expect(result.attributes).not.toContainEqual({ attr_key: "Formato de alimento", attr_value: "Patê" });
});

it("deixa o formato em aberto quando a ração é úmida mas não informa a embalagem", () => {
  const result = suggestProductDetails(
    { title: "Ração úmida para Gatos sabor frango" },
    categories,
    [],
    [
      { attr_key: "Formato de alimento", attr_value: "Grãos" },
      { attr_key: "Formato de alimento", attr_value: "Sachê" },
      { attr_key: "Formato de alimento", attr_value: "Lata" },
    ],
  );

  expect(result.attributes.filter((attribute) => attribute.attr_key === "Formato de alimento")).toEqual([]);
});

it("reconhece filhotes mesmo quando o valor cadastrado está no singular", () => {
  const result = suggestProductDetails(
    { title: "Ração para Cães Filhotes" },
    categories,
    [],
    [{ attr_key: "Idade", attr_value: "Filhote" }],
  );
  expect(result.attributes).toContainEqual({ attr_key: "Idade", attr_value: "Filhote" });
});

it("pode sugerir mais de um porte para rações de raças médias e grandes", () => {
  const result = suggestProductDetails(
    { title: "Ração Premier Cães Adultos Raças Médias e Grandes" },
    categories,
    [],
    [
      { attr_key: "Porte de Raça", attr_value: "Pequeno" },
      { attr_key: "Porte de Raça", attr_value: "Médio" },
      { attr_key: "Porte de Raça", attr_value: "Grande" },
    ],
  );
  expect(result.attributes).toEqual(expect.arrayContaining([
    { attr_key: "Porte de Raça", attr_value: "Médio" },
    { attr_key: "Porte de Raça", attr_value: "Grande" },
  ]));
  expect(result.attributes).not.toContainEqual({ attr_key: "Porte de Raça", attr_value: "Pequeno" });
});

it("aplica todas as idades e todos os portes quando a ração não os especifica", () => {
  const availableAttributes = [
    { attr_key: "Idade", attr_value: "Filhote" },
    { attr_key: "Idade", attr_value: "Adulto" },
    { attr_key: "Idade", attr_value: "Sênior" },
    { attr_key: "Porte de Raça", attr_value: "Pequeno" },
    { attr_key: "Porte de Raça", attr_value: "Médio" },
    { attr_key: "Porte de Raça", attr_value: "Grande" },
    { attr_key: "Porte de Raça", attr_value: "Gigante" },
  ];
  const result = suggestProductDetails(
    { title: "Ração para Cães sabor frango 10 kg" },
    categories,
    [],
    availableAttributes,
  );

  expect(result.attributes).toEqual(expect.arrayContaining(availableAttributes));
});

it("mantém somente a idade e o porte informados no produto", () => {
  const result = suggestProductDetails(
    { title: "Ração para Cães Adultos de Porte Pequeno" },
    categories,
    [],
    [
      { attr_key: "Idade", attr_value: "Filhote" },
      { attr_key: "Idade", attr_value: "Adulto" },
      { attr_key: "Idade", attr_value: "Sênior" },
      { attr_key: "Porte de Raça", attr_value: "Pequeno" },
      { attr_key: "Porte de Raça", attr_value: "Médio" },
      { attr_key: "Porte de Raça", attr_value: "Grande" },
    ],
  );

  expect(result.attributes.filter((attribute) => attribute.attr_key === "Idade")).toEqual([
    { attr_key: "Idade", attr_value: "Adulto" },
  ]);
  expect(result.attributes.filter((attribute) => attribute.attr_key === "Porte de Raça")).toEqual([
    { attr_key: "Porte de Raça", attr_value: "Pequeno" },
  ]);
});
