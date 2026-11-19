import { describe, expect, it } from "vitest";
import { describeCheckoutFailure } from "@/lib/checkoutFailure";
import { pendingPaymentLabel } from "@/lib/franchisePayments";
import { ISSUE_LABELS } from "@/lib/olistReview";

describe("franquia com pedido criado e sem boleto", () => {
  it("o log do admin aponta a cobrança, não a nota, quando a Olist recusa lançar contas", () => {
    const failure = describeCheckoutFailure({
      error_message: "Não é possível lançar contas pois existe nota fiscal gerada para o pedido.",
    });
    expect(failure?.reason).toBe("A Olist não conseguiu gerar a conta a receber (boleto)");
  });

  it("rejeição da SEFAZ continua como falha da nota", () => {
    const failure = describeCheckoutFailure({
      error_message: "Alerta NF-e (pedido seguiu para a Shopify): O CFOP informado em um dos itens está inválido",
    });
    expect(failure?.reason).toBe("A Olist não conseguiu autorizar a nota fiscal");
  });

  it("limite de chamadas da Olist não vira mensagem genérica", () => {
    const failure = describeCheckoutFailure({
      error_message: "Limite de chamadas à API da Olist atingido; nova tentativa em 51 s",
    });
    expect(failure?.reason).toContain("limite de chamadas");
  });

  it("Pagamentos troca o 'Link sendo gerado' eterno por boleto em geração e depois financeiro", () => {
    const createdAt = "2026-11-18T17:53:00.000Z";
    const created = Date.parse(createdAt);
    expect(pendingPaymentLabel({ receivablePending: true, createdAt }, created + 5 * 60_000))
      .toBe("Boleto em geração");
    expect(pendingPaymentLabel({ receivablePending: true, createdAt }, created + 2 * 60 * 60_000))
      .toBe("Boleto em análise pelo financeiro");
    expect(pendingPaymentLabel({ receivablePending: false, createdAt }, created)).toBe("Link sendo gerado");
  });

  it("Revisão Olist tem rótulo para pedido duplicado", () => {
    expect(ISSUE_LABELS.duplicate).toBe("Pedido duplicado");
  });
});
