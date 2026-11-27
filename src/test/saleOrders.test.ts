import { describe, expect, it } from "vitest";
import { invoiceState, paymentState, situationState } from "@/lib/saleOrders";

describe("invoiceState", () => {
  it("mostra o número da nota emitida", () => {
    expect(invoiceState({ status: "issued", number: "123", url: "https://x" })).toEqual({
      label: "NF-e 123",
      tone: "success",
    });
  });

  it("nunca deixa a nota em branco enquanto ela não sai", () => {
    expect(invoiceState(null).label).toBe("Nota em emissão");
    expect(invoiceState({ status: "pending", number: null, url: null }).label).toBe("Nota em autorização");
    expect(invoiceState({ status: "generating", number: null, url: null }).label).toBe("Nota em emissão");
  });

  it("rejeição aparece como revisão, sem expor o erro fiscal ao cliente", () => {
    expect(invoiceState({ status: "rejected", number: "9", url: "https://x" })).toEqual({
      label: "Nota em revisão pela nossa equipe",
      tone: "warning",
    });
  });
});

describe("paymentState e situationState", () => {
  it("traduz o pagamento", () => {
    expect(paymentState("received")?.label).toBe("Pago");
    expect(paymentState("overdue")?.tone).toBe("danger");
    expect(paymentState(null)).toBeNull();
  });

  it("traduz a situação do pedido de venda", () => {
    expect(situationState("preparando_envio").label).toBe("Preparando envio");
    expect(situationState("Cancelado").tone).toBe("muted");
    expect(situationState("Atendido").label).toBe("Entregue");
    expect(situationState("").label).toBe("Em andamento");
  });
});
