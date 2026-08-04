import { describe, expect, it } from "vitest";
import { isAudienceVisibleTo } from "@/hooks/useProductAudience";

describe("product audience visibility", () => {
  it("hides unconfigured products from customers and franchisees", () => {
    expect(isAudienceVisibleTo(null, false)).toBe(false);
    expect(isAudienceVisibleTo(null, true)).toBe(false);
  });

  it("shows products configured for both audiences", () => {
    expect(isAudienceVisibleTo("ambos", false)).toBe(true);
    expect(isAudienceVisibleTo("ambos", true)).toBe(true);
  });

  it("respects explicit customer and franchise restrictions", () => {
    expect(isAudienceVisibleTo("cliente", false)).toBe(true);
    expect(isAudienceVisibleTo("cliente", true)).toBe(false);
    expect(isAudienceVisibleTo("franquia", false)).toBe(false);
    expect(isAudienceVisibleTo("franquia", true)).toBe(true);
  });

  it("never exposes the total catalog before applying the profile", () => {
    const audiences = [
      ...Array<"cliente">(28).fill("cliente"),
      "franquia" as const,
      null,
      null,
      null,
    ];

    expect(audiences.filter((audience) => isAudienceVisibleTo(audience, false))).toHaveLength(28);
    expect(audiences.filter((audience) => isAudienceVisibleTo(audience, true))).toHaveLength(1);
  });
});
