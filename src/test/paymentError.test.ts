import { describe, expect, it } from "vitest";
import { customerPaymentError } from "@/lib/paymentError";

describe("mensagens de pagamento para o cliente", () => {
  it("traduz a recusa de cartão sem expor a resposta interna", () => {
    const message = customerPaymentError(
      'Asaas 400: [{"code":"invalid_creditCard","description":"Transação não autorizada"}]',
    );
    expect(message).toContain("banco não autorizou");
    expect(message).not.toContain("Asaas 400");
    expect(message).not.toContain("invalid_creditCard");
  });

  it("preserva mensagens já amigáveis", () => {
    expect(customerPaymentError("Confira os dados do cartão."))
      .toBe("Confira os dados do cartão.");
  });
});
