import { describe, expect, it } from "vitest";
import { isMissingValue, isSaleAtOrBelowCost, isSubscriberPriceNotVisible, matchesMissingValueFilter } from "@/lib/valueCompleteness";

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

  it("identifica preço de assinante que não aparece por não ser menor que a venda", () => {
    expect(isSubscriberPriceNotVisible(21, 20)).toBe(true);
    expect(isSubscriberPriceNotVisible(20, 20)).toBe(true);
    expect(isSubscriberPriceNotVisible(19, 20)).toBe(false);
    expect(isSubscriberPriceNotVisible(null, 20)).toBe(false);
    expect(matchesMissingValueFilter({ ...complete, subscriber: 21 }, "subscriber_not_visible")).toBe(true);
    expect(matchesMissingValueFilter(complete, "subscriber_not_visible")).toBe(false);
  });

  it("bloqueia venda normal sem margem e permite filtrar os casos", () => {
    expect(isSaleAtOrBelowCost(283.39, 283.39)).toBe(true);
    expect(isSaleAtOrBelowCost(280, 283.39)).toBe(true);
    expect(isSaleAtOrBelowCost(300, 283.39)).toBe(false);
    expect(isSaleAtOrBelowCost(300, null)).toBe(false);
    expect(matchesMissingValueFilter({ ...complete, shopify: 10 }, "sale_at_cost")).toBe(true);
  });
});
