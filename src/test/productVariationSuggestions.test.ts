import { describe, expect, it } from "vitest";
import {
  productVariationSimilarity,
  variationBaseName,
} from "@/lib/productVariationSuggestions";

describe("sugestões de variações", () => {
  it("remove peso e volume do nome usado na comparação", () => {
    expect(variationBaseName("Ração Golden Special 15 kg")).toBe("racao golden special");
    expect(variationBaseName("Shampoo Pet Clean 500ml")).toBe("shampoo pet clean");
  });

  it("considera tamanhos diferentes do mesmo produto muito parecidos", () => {
    expect(productVariationSimilarity(
      "Ração Golden Special Cães Adultos 1 kg",
      "Ração Golden Special Cães Adultos 15kg",
    )).toBe(1);
  });

  it("não mistura produtos diferentes que compartilham palavras genéricas", () => {
    expect(productVariationSimilarity(
      "Ração Golden Special Cães Adultos 1 kg",
      "Ração Premier Gatos Castrados 1 kg",
    )).toBe(0);
  });

  it("aceita uma pequena diferença no complemento do título", () => {
    expect(productVariationSimilarity(
      "Petisco Natural Frango Crocante 100 g",
      "Petisco Natural Frango 300 g",
    )).toBeGreaterThan(0.6);
  });
});
