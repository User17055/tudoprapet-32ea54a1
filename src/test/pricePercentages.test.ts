import { describe, expect, it } from "vitest";
import { formatPercentage, percentageBelowSale, percentageOverCost } from "@/lib/pricePercentages";

describe("comparacao percentual de precos", () => {
  it("calcula o acrescimo do cliente sobre o custo", () => {
    expect(percentageOverCost(75.75, 67.63)).toBeCloseTo(12, 1);
    expect(formatPercentage(percentageOverCost(75.75, 67.63)!)).toBe("12,0%");
  });

  it("calcula quanto o assinante esta abaixo da venda", () => {
    expect(percentageBelowSale(72, 80)).toBeCloseTo(10, 10);
  });

  it("nao calcula sem uma base valida", () => {
    expect(percentageOverCost(10, 0)).toBeNull();
    expect(percentageBelowSale(undefined, 10)).toBeNull();
  });
});
