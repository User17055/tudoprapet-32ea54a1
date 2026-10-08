import { describe, expect, it } from "vitest";
import {
  feedMarginForWeight,
  isProductInFeedCategory,
  priceFromCostAndMargin,
  subscriberMarginForProduct,
  subscriberMarginWithFeedRule,
} from "../../supabase/functions/_shared/subscriber-category.ts";
import { parsePackageWeightKg } from "../lib/packageWeight";

const categories = [
  { id: "dogs", parent_id: null },
  { id: "medicine", parent_id: "dogs" },
  { id: "flea", parent_id: "medicine" },
];
const links = [{ shopify_product_id: "product-1", category_id: "flea" }];

describe("margem de assinante por categoria", () => {
  it("usa a regra mais especifica da hierarquia", () => {
    expect(subscriberMarginForProduct("product-1", categories, links, [
      { category_id: "dogs", percent: 5 },
      { category_id: "medicine", percent: 8 },
      { category_id: "flea", percent: 12 },
    ])).toBe(12);
  });

  it("herda a regra do grupo pai", () => {
    expect(subscriberMarginForProduct("product-1", categories, links, [
      { category_id: "dogs", percent: 5 },
      { category_id: "medicine", percent: 8 },
    ])).toBe(8);
  });

  it("usa 5% quando nenhuma categoria possui regra", () => {
    expect(subscriberMarginForProduct("product-1", categories, links, [])).toBe(5);
    expect(priceFromCostAndMargin(100, 5)).toBe(105);
  });
});

describe("regra automatica de racao", () => {
  const feedCategories = [
    { id: "feed", name: "Ração", parent_id: null },
    { id: "dog-feed", name: "Cães adultos", parent_id: "feed" },
  ];
  const feedLinks = [{ shopify_product_id: "feed-product", category_id: "dog-feed" }];

  it("reconhece Racao tambem como grupo pai", () => {
    expect(isProductInFeedCategory("feed-product", feedCategories, feedLinks)).toBe(true);
  });

  it("aplica sempre 5% em racao, qualquer peso, acima da regra da categoria", () => {
    expect(feedMarginForWeight(7.5)).toBe(5);
    expect(feedMarginForWeight(15)).toBe(5);
    for (const weight of [null, 1, 7.5, 15]) {
      expect(subscriberMarginWithFeedRule("feed-product", weight, feedCategories, feedLinks, [
        { category_id: "feed", percent: 10 },
      ])).toBe(5);
    }
    expect(priceFromCostAndMargin(100, 5)).toBe(105);
  });

  it("extrai peso em kg ou gramas da variacao", () => {
    expect(parsePackageWeightKg("15 kg")).toBe(15);
    expect(parsePackageWeightKg("Pacote 750 g")).toBe(0.75);
    expect(parsePackageWeightKg("Adulto", "7,5kg")).toBe(7.5);
  });
});
