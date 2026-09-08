import { describe, expect, it } from "vitest";
import {
  formatCardExpiry,
  formatCardNumber,
  isValidCardNumber,
  parseCardExpiry,
  validateCard,
} from "@/lib/cardValidation";

const valid = {
  holderName: "Maria da Silva",
  number: "4111 1111 1111 1111",
  expiryMonth: "12",
  expiryYear: "30",
  ccv: "123",
};

describe("card validation", () => {
  it("validates the card number with the Luhn algorithm", () => {
    expect(isValidCardNumber(valid.number)).toBe(true);
    expect(isValidCardNumber("4111 1111 1111 1112")).toBe(false);
    expect(isValidCardNumber("1111 1111 1111 1111")).toBe(false);
  });

  it("formats only the supported number of digits", () => {
    expect(formatCardNumber("4111-1111 1111.1111abc")).toBe("4111 1111 1111 1111");
  });

  it("formats and separates the card expiry date", () => {
    expect(parseCardExpiry("09/30")).toEqual({ expiryMonth: "09", expiryYear: "30" });
    expect(parseCardExpiry("09/2030")).toEqual({ expiryMonth: "09", expiryYear: "2030" });
    expect(formatCardExpiry("09", "30")).toBe("09/30");
  });

  it("reports each invalid field", () => {
    const errors = validateCard({
      holderName: "1",
      number: "4111111111111112",
      expiryMonth: "13",
      expiryYear: "20",
      ccv: "12",
    }, new Date(2026, 7, 1));
    expect(Object.keys(errors).sort()).toEqual([
      "ccv", "expiryMonth", "expiryYear", "holderName", "number",
    ]);
  });

  it("requires four CVV digits for Amex", () => {
    const errors = validateCard({ ...valid, number: "378282246310005", ccv: "123" });
    expect(errors.ccv).toContain("4 dígitos");
  });
});
