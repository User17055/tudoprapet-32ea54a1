import { describe, expect, it } from "vitest";
import { isMissingValue, matchesMissingValueFilter } from "@/lib/valueCompleteness";

const complete = { cost: 10, shopify: 20, subscriber: 18, franchise: 15 };

describe("pendências de valores", () => {
  it("considera ausente, inválido ou zerado como pendência", () => {
    expect(isMissingValue(undefined)).toBe(true);
    expect(isMissingValue(null)).toBe(true);
    expect(isMissingValue(Number.NaN)).toBe(true);
    expect(isMissingValue(0)).toBe(true);
    expect(isMissingValue(10)).toBe(false);
  });

  it("filtra cada origem de valor separadamente", () => {
    expect(matchesMissingValueFilter({ ...complete, cost: null }, "missing_cost")).toBe(true);
    expect(matchesMissingValueFilter({ ...complete, shopify: 0 }, "missing_shopify")).toBe(true);
    expect(matchesMissingValueFilter({ ...complete, subscriber: undefined }, "missing_subscriber")).toBe(true);
    expect(matchesMissingValueFilter({ ...complete, franchise: null }, "missing_franchise")).toBe(true);
  });

  it("identifica qualquer pendência sem incluir variantes completas", () => {
    expect(matchesMissingValueFilter({ ...complete, subscriber: null }, "missing_any")).toBe(true);
    expect(matchesMissingValueFilter(complete, "missing_any")).toBe(false);
    expect(matchesMissingValueFilter(complete, "all")).toBe(true);
  });
});
