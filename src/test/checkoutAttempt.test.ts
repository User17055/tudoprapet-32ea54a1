import { describe, expect, it } from "vitest";
import { attemptStatusLabel } from "../lib/checkoutAttempt";

// Por que este teste existe: em 31/08/2026 uma cliente tentou pagar R$ 228,38
// duas vezes, o app do banco recusou o QR nas duas, e o painel do admin exibiu
// "Sucesso" nas duas. O time só descobriu pela foto do celular dela. Na etapa
// de pagamento, sucesso quer dizer que o Asaas criou a cobrança -- não que o
// dinheiro entrou.

describe("attemptStatusLabel", () => {
  it("não chama de sucesso uma cobrança que só foi criada", () => {
    const status = attemptStatusLabel("payment", true);
    expect(status.label).toBe("Cobrança criada");
    expect(status.label).not.toBe("Sucesso");
    expect(status.tone).toBe("pending");
  });

  it("mantém sucesso onde ele significa o que diz", () => {
    expect(attemptStatusLabel("prepare", true)).toEqual({ label: "Sucesso", tone: "ok" });
    expect(attemptStatusLabel("shopify_completion", true)).toEqual({ label: "Sucesso", tone: "ok" });
  });

  it("marca falha em qualquer etapa", () => {
    for (const stage of ["prepare", "payment", "shopify_completion"] as const) {
      expect(attemptStatusLabel(stage, false)).toEqual({ label: "Falhou", tone: "error" });
    }
  });
});
