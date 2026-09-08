import { describe, expect, it } from "vitest";
import {
  describeDraftFailure,
  hasFieldError,
  isRetryableShopifyFailure,
  normalizeShopifyUserErrors,
} from "../../supabase/functions/_shared/checkout-failure.ts";
import { validBrazilPhone } from "../../supabase/functions/_shared/checkout-input.ts";
import { describeCheckoutFailure } from "@/lib/checkoutFailure";

describe("recusas da Shopify no preparo do pedido", () => {
  it("normaliza o campo recusado vindo como lista", () => {
    expect(normalizeShopifyUserErrors([{ field: ["phone"], message: "Phone is invalid" }]))
      .toEqual([{ field: "phone", message: "Phone is invalid" }]);
  });

  it("descreve o motivo em português sem expor documento", () => {
    const errors = normalizeShopifyUserErrors([{ field: ["localizedFields"], message: "52998224725 inválido" }]);
    const message = describeDraftFailure(errors, "falhou");
    expect(message).toContain("CPF/CNPJ");
    expect(message).not.toContain("52998224725");
  });

  it("só repete tentativa em falha passageira", () => {
    const throttled = normalizeShopifyUserErrors([{ message: "Throttled" }]);
    const phone = normalizeShopifyUserErrors([{ field: ["phone"], message: "Phone is invalid" }]);
    expect(isRetryableShopifyFailure(200, throttled)).toBe(true);
    expect(isRetryableShopifyFailure(503, [])).toBe(true);
    expect(isRetryableShopifyFailure(200, phone)).toBe(false);
    expect(hasFieldError(phone, /phone/i)).toBe(true);
  });

  it("valida telefone brasileiro antes de chamar a Shopify", () => {
    expect(validBrazilPhone("(11) 99999-9999")).toBe(true);
    expect(validBrazilPhone("5518999998888")).toBe(true);
    expect(validBrazilPhone("(18) 3222-1111")).toBe(true);
    expect(validBrazilPhone("(01) 99999-9999")).toBe(false);
    expect(validBrazilPhone("11899999999")).toBe(false);
    expect(validBrazilPhone("999999999")).toBe(false);
  });

  it("explica a falha no administrativo com o campo recusado", () => {
    const explanation = describeCheckoutFailure({
      error_message: "A Shopify recusou o telefone informado (phone: Phone is invalid)",
      metadata: { rejectedFields: ["phone"] },
    });
    expect(explanation?.reason).toContain("Telefone");
    expect(explanation?.fields).toEqual(["phone"]);
    expect(describeCheckoutFailure({ error_message: null })).toBeNull();
  });
});
