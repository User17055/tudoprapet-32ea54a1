import { describe, expect, it } from "vitest";
import { findPossibleDuplicates, type DuplicateCandidate } from "@/lib/productDuplicates";

const product = (id: string, title: string, sku?: string): DuplicateCandidate => ({ id, title, handle: id, sku });

describe("possíveis produtos duplicados", () => {
  it("identifica nomes iguais com grafia, ordem e unidade de peso diferentes", () => {
    const result = findPossibleDuplicates([
      product("1", "Ração Premier Adultos Frango 1 kg"),
      product("2", "Premier Racao Frango Adultos 1000 g"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe("same_name");
  });

  it("aceita um erro pequeno de escrita na marca mantendo a apresentação", () => {
    expect(findPossibleDuplicates([
      product("1", "Bravecto Cães 10 a 20 kg"),
      product("2", "Braveto para Cães 10-20kg"),
    ])).toHaveLength(1);
  });

  it("não mistura pesos ou dosagens diferentes", () => {
    expect(findPossibleDuplicates([
      product("1", "Ração Premier Adultos Frango 1 kg"),
      product("2", "Ração Premier Adultos Frango 10 kg"),
      product("3", "Bravecto Cães 10 a 20 kg"),
      product("4", "Bravecto Cães 20 a 40 kg"),
    ])).toHaveLength(0);
  });

  it("não confunde linhas, sabores ou públicos distintos", () => {
    expect(findPossibleDuplicates([
      product("1", "Ração Premier Adultos Frango 1 kg"),
      product("2", "Ração Premier Filhotes Carne 1 kg"),
    ])).toHaveLength(0);
  });

  it("destaca SKU igual apenas quando o produto também parece equivalente", () => {
    const result = findPossibleDuplicates([
      product("1", "Ração Premier Adultos Frango 1 kg", "123"),
      product("2", "Ração Premier Adultos Frango 1000 g", "123"),
    ]);
    expect(result[0].reason).toBe("sku");
  });
});
