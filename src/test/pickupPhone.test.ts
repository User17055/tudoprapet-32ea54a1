import { describe, expect, it } from "vitest";
import { normalizePhone } from "../../supabase/functions/_shared/pickup.ts";

describe("normalizePhone", () => {
  it("strips formatting and keeps only digits", () => {
    expect(normalizePhone("(18) 99999-1234")).toBe("5518999991234");
  });

  it("does not duplicate the country code when it is already there", () => {
    expect(normalizePhone("5518999991234")).toBe("5518999991234");
    expect(normalizePhone("+55 (18) 99999-1234")).toBe("5518999991234");
  });

  it("returns null for empty or digitless input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("sem telefone")).toBeNull();
  });
});
