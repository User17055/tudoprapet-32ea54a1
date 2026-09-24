import { describe, expect, it } from "vitest";
import { suggestProductDetails } from "@/lib/productDetailSuggestions";

const categories = [
  { id: "dogs", name: "Cães", parent_id: null },
  { id: "dog-food", name: "Alimentação", parent_id: "dogs" },
  { id: "dog-dry", name: "Ração seca", parent_id: "dog-food" },
  { id: "dog-wet", name: "Ração úmida", parent_id: "dog-food" },
  { id: "dog-natural", name: "Ração natural", parent_id: "dog-food" },
  { id: "dog-prescription", name: "Ração prescrita", parent_id: "dog-food" },
  { id: "dog-treats", name: "Petiscos", parent_id: "dogs" },
  { id: "dog-pharmacy", name: "Farmácia", parent_id: "dogs" },
  { id: "dog-supplements", name: "Suplementos e Vitaminas", parent_id: "dog-pharmacy" },
  { id: "cats", name: "Gatos", parent_id: null },
  { id: "cat-dry", name: "Ração seca", parent_id: "cats" },
  { id: "cat-prescription", name: "Ração prescrita", parent_id: "cats" },
  { id: "cat-pharmacy", name: "Farmácia", parent_id: "cats" },
  { id: "cat-supplements", name: "Suplementos e Vitaminas", parent_id: "cat-pharmacy" },
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

it("classifica a linha Nattu como natural e nunca como ração seca", () => {
  const result = suggestProductDetails(
    { title: "Nattu para Cães Adultos sabor frango 10 kg" },
    categories,
    [],
    [
      { attr_key: "Tipo", attr_value: "Ração seca" },
      { attr_key: "Tipo", attr_value: "Natural" },
      { attr_key: "Formato de alimento", attr_value: "Grãos" },
    ],
  );

  expect(result.categoryIds).toEqual(["dogs", "dog-food", "dog-natural"]);
  expect(result.attributes).toContainEqual({ attr_key: "Tipo", attr_value: "Natural" });
  expect(result.attributes).toContainEqual({ attr_key: "Formato de alimento", attr_value: "Grãos" });
  expect(result.attributes).not.toContainEqual({ attr_key: "Tipo", attr_value: "Ração seca" });
});

it("não classifica Nattu como seca quando a categoria natural ainda não existe", () => {
  const categoriesWithoutNatural = categories.filter((category) => category.id !== "dog-natural");
  const result = suggestProductDetails(
    { title: "Nattu para Cães Adultos 10 kg" },
    categoriesWithoutNatural,
    [],
    [{ attr_key: "Tipo", attr_value: "Ração seca" }],
  );

  expect(result.categoryIds).not.toContain("dog-dry");
  expect(result.attributes).not.toContainEqual({ attr_key: "Tipo", attr_value: "Ração seca" });
});

it("classifica Nutrição Clínica como ração prescrita", () => {
  const result = suggestProductDetails(
    { title: "Nutrição Clínica para Gatos Adultos Renal 2 kg" },
    categories,
    [],
    [
      { attr_key: "Tipo", attr_value: "Ração seca" },
      { attr_key: "Tipo", attr_value: "Prescrita" },
      { attr_key: "Formato de alimento", attr_value: "Grãos" },
    ],
  );

  expect(result.categoryIds).toEqual(["cats", "cat-prescription"]);
  expect(result.attributes).toContainEqual({ attr_key: "Tipo", attr_value: "Prescrita" });
  expect(result.attributes).toContainEqual({ attr_key: "Formato de alimento", attr_value: "Grãos" });
  expect(result.attributes).not.toContainEqual({ attr_key: "Tipo", attr_value: "Ração seca" });
});

it("reconhece o título completo da Premier Nutrição Clínica", () => {
  const result = suggestProductDetails(
    { title: "Ração Premier Nutrição Clínica Renal para Cães Adultos de Porte Médio e Grande 10.1 Kg" },
    categories,
    [{ id: "premier", name: "Premier" }],
    [
      { attr_key: "Tipo", attr_value: "Ração seca" },
      { attr_key: "Tipo", attr_value: "Prescrita" },
      { attr_key: "Idade", attr_value: "Adulto" },
      { attr_key: "Porte de Raça", attr_value: "Médio" },
      { attr_key: "Porte de Raça", attr_value: "Grande" },
    ],
  );

  expect(result.categoryIds).toEqual(["dogs", "dog-food", "dog-prescription"]);
  expect(result.brandId).toBe("premier");
  expect(result.attributes).toEqual(expect.arrayContaining([
    { attr_key: "Tipo", attr_value: "Prescrita" },
    { attr_key: "Idade", attr_value: "Adulto" },
    { attr_key: "Porte de Raça", attr_value: "Médio" },
    { attr_key: "Porte de Raça", attr_value: "Grande" },
  ]));
  expect(result.attributes).not.toContainEqual({ attr_key: "Tipo", attr_value: "Ração seca" });
});

it("reconhece o título completo da Premier Nattu", () => {
  const result = suggestProductDetails(
    { title: "Ração Premier Nattu para Cães Adultos de Raças Pequenas Sabor Mandioca 1 Kg" },
    categories,
    [{ id: "premier", name: "Premier" }],
    [
      { attr_key: "Tipo", attr_value: "Ração seca" },
      { attr_key: "Tipo", attr_value: "Natural" },
      { attr_key: "Idade", attr_value: "Adulto" },
      { attr_key: "Porte de Raça", attr_value: "Pequeno" },
      { attr_key: "Sabor", attr_value: "Mandioca" },
    ],
  );

  expect(result.categoryIds).toEqual(["dogs", "dog-food", "dog-natural"]);
  expect(result.brandId).toBe("premier");
  expect(result.attributes).toEqual(expect.arrayContaining([
    { attr_key: "Tipo", attr_value: "Natural" },
    { attr_key: "Idade", attr_value: "Adulto" },
    { attr_key: "Porte de Raça", attr_value: "Pequeno" },
    { attr_key: "Sabor", attr_value: "Mandioca" },
  ]));
  expect(result.attributes).not.toContainEqual({ attr_key: "Tipo", attr_value: "Ração seca" });
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

it("entende abreviacoes dos Cookies Premier sem confundir RC com racao", () => {
  const result = suggestProductDetails(
    { title: "PREMIER COOKIE AD. RC PEQ FRUT VERM 250GR" },
    categories,
    [{ id: "premier", name: "Premier" }],
    [
      { attr_key: "Pet", attr_value: "Cachorros" },
      { attr_key: "Idade", attr_value: "Adulto" },
      { attr_key: "Idade", attr_value: "Filhote" },
      { attr_key: "Porte de Raça", attr_value: "Pequeno" },
      { attr_key: "Formato Do Alimento", attr_value: "Grãos" },
      { attr_key: "Formato Do Alimento", attr_value: "Biscoito" },
    ],
  );

  expect(result.categoryIds).toEqual(["dogs", "dog-treats"]);
  expect(result.attributes).toEqual(expect.arrayContaining([
    { attr_key: "Pet", attr_value: "Cachorros" },
    { attr_key: "Idade", attr_value: "Adulto" },
    { attr_key: "Porte de Raça", attr_value: "Pequeno" },
    { attr_key: "Formato Do Alimento", attr_value: "Biscoito" },
  ]));
  expect(result.attributes).not.toContainEqual({ attr_key: "Idade", attr_value: "Filhote" });
  expect(result.attributes).not.toContainEqual({ attr_key: "Formato Do Alimento", attr_value: "Grãos" });
});

it("entende FILH e preenche o Cookie para filhote", () => {
  const result = suggestProductDetails(
    { title: "PREMIER COOKIE FILH COCO E AVEIA 250GR" },
    categories,
    [],
    [
      { attr_key: "Idade", attr_value: "Adulto" },
      { attr_key: "Idade", attr_value: "Filhote" },
    ],
  );

  expect(result.attributes).toContainEqual({ attr_key: "Idade", attr_value: "Filhote" });
  expect(result.attributes).not.toContainEqual({ attr_key: "Idade", attr_value: "Adulto" });
});

it("preenche as duas especies e categorias de um suplemento para caes e gatos", () => {
  const result = suggestProductDetails(
    { title: "Probiótico Franpet Bio Pasta Intestinal Cães Gatos 14g" },
    categories,
    [{ id: "franpet", name: "Franpet" }],
    [
      { attr_key: "Pet", attr_value: "Cachorros" },
      { attr_key: "Pet", attr_value: "Gatos" },
      { attr_key: "Aplicação", attr_value: "Pasta" },
    ],
  );

  expect(result.rootCategoryId).toBeNull();
  expect(result.categoryIds).toEqual([
    "dogs", "dog-pharmacy", "dog-supplements",
    "cats", "cat-pharmacy", "cat-supplements",
  ]);
  expect(result.attributes).toEqual(expect.arrayContaining([
    { attr_key: "Pet", attr_value: "Cachorros" },
    { attr_key: "Pet", attr_value: "Gatos" },
    { attr_key: "Aplicação", attr_value: "Pasta" },
  ]));
});
