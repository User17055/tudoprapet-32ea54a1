import { describe, expect, it } from "vitest";
import {
  fuzzyMatchScore,
  fuzzyScoreFields,
  fuzzySearch,
  normalizeText,
} from "@/lib/fuzzySearch";

describe("normalizeText", () => {
  it("strips accents, lowercases and trims", () => {
    expect(normalizeText("  Ração Premium  ")).toBe("racao premium");
    expect(normalizeText("Indicação Veterinária")).toBe("indicacao veterinaria");
  });
});

describe("fuzzyMatchScore", () => {
  it("scores a literal substring as a perfect match", () => {
    expect(fuzzyMatchScore("racao", "Ração Premium para Cães")).toBe(1);
  });

  it("ignores accents on both sides", () => {
    expect(fuzzyMatchScore("ração", "Racao Premium")).toBe(1);
    expect(fuzzyMatchScore("caes", "Ração para Cães")).toBe(1);
  });

  it("tolerates a typo in the middle of a word", () => {
    // "pemium" está a uma edição de "premium"
    expect(fuzzyMatchScore("raçao pemium", "Ração Premium")).toBeGreaterThan(0.5);
  });

  it("rejects gibberish", () => {
    expect(fuzzyMatchScore("jdkamkeasld", "Ração Premium para Cães")).toBe(0);
  });

  it("does not penalise stop words that fail to match", () => {
    // "para" não existe no texto, mas é stop word: não deve derrubar o score
    expect(fuzzyMatchScore("racao para cachorro", "Ração Cachorro")).toBeGreaterThan(0.5);
  });

  it("returns 0 for queries with no usable term", () => {
    expect(fuzzyMatchScore("", "Ração Premium")).toBe(0);
    expect(fuzzyMatchScore("a", "Ração Premium")).toBe(0);
  });

  it("returns 0 when the text has no words", () => {
    expect(fuzzyMatchScore("racao", "")).toBe(0);
  });

  it("never exceeds 1", () => {
    expect(fuzzyMatchScore("racao premium", "Ração Premium")).toBeLessThanOrEqual(1);
  });
});

describe("fuzzyScoreFields", () => {
  it("keeps the best scoring field", () => {
    const score = fuzzyScoreFields("bravecto", [
      { value: "Antipulgas para cães" },
      { value: "Bravecto" },
    ]);
    expect(score).toBe(1);
  });

  it("applies the field weight", () => {
    const weighted = fuzzyScoreFields("bravecto", [{ value: "Bravecto", weight: 0.5 }]);
    expect(weighted).toBe(0.5);
  });

  it("skips empty fields", () => {
    expect(fuzzyScoreFields("bravecto", [{ value: null }, { value: undefined }])).toBe(0);
  });
});

describe("fuzzySearch", () => {
  const products = [
    { title: "Ração Premium para Cães", brand: "Golden" },
    { title: "Antipulgas Bravecto", brand: "MSD" },
    { title: "Brinquedo de Corda", brand: "Chalesco" },
  ];
  const fields = (p: (typeof products)[number]) => [
    { value: p.title },
    { value: p.brand, weight: 0.8 },
  ];

  it("returns every item untouched when the query is blank", () => {
    expect(fuzzySearch("   ", products, fields)).toBe(products);
  });

  it("keeps only the items that match", () => {
    const found = fuzzySearch("bravecto", products, fields);
    expect(found).toHaveLength(1);
    expect(found[0].title).toBe("Antipulgas Bravecto");
  });

  it("matches on a secondary field too", () => {
    const found = fuzzySearch("golden", products, fields);
    expect(found).toHaveLength(1);
    expect(found[0].brand).toBe("Golden");
  });

  it("orders results by relevance", () => {
    const found = fuzzySearch("racao", products, fields);
    expect(found[0].title).toBe("Ração Premium para Cães");
  });

  it("returns nothing when no item is relevant", () => {
    expect(fuzzySearch("jdkamkeasld", products, fields)).toHaveLength(0);
  });
});

describe("fuzzyMatchScore — falsos positivos por palavra curta", () => {
  // Regressão: `term.includes(word)` pontuava 0.75 quando a palavra do TEXTO era
  // substring do termo buscado. Como "golden" contém "de", qualquer título com "de"
  // casava com a busca "golden". Stop words eram filtradas só do lado da query.

  it("does not match on a short stop word contained in the query", () => {
    expect(fuzzyMatchScore("golden", "Brinquedo de Corda")).toBe(0);
    expect(fuzzyMatchScore("golden", "de")).toBe(0);
  });

  it("does not match a meaningful word against a stop word of the text", () => {
    // "parasita" contém "para", que é stop word
    expect(fuzzyMatchScore("parasita", "Ração para Cães")).toBe(0);
  });

  it("still matches the stop word when it is searched exactly", () => {
    expect(fuzzyMatchScore("para", "Ração para Cães")).toBe(1);
  });

  it("keeps loose matching for words long enough to be meaningful", () => {
    // prefixo continua valendo
    expect(fuzzyMatchScore("brinq", "Brinquedo de Corda")).toBeGreaterThan(0.35);
    // substring continua valendo
    expect(fuzzyMatchScore("pulgas", "Antipulgas Bravecto")).toBeGreaterThan(0.35);
  });
});
