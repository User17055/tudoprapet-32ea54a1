import { describe, expect, it } from "vitest";
import * as client from "../lib/installments";
import * as server from "../../supabase/functions/_shared/pricing.ts";

const TOTALS = [12, 43.9, 99.9, 250, 1000.55];

describe("parcelamento no cartão", () => {
  it("mantém frontend e backend com o mesmo cálculo", () => {
    for (const total of TOTALS) {
      for (let n = 1; n <= 12; n += 1) {
        expect(client.installmentPlan(total, n)).toEqual(server.installmentPlan(total, n));
      }
      expect(client.maxInstallmentsFor(total)).toBe(server.maxInstallmentsFor(total));
    }
  });

  it("também repassa a taxa no à vista", () => {
    const plan = client.installmentPlan(43.9, 1);
    expect(plan.installments).toBe(1);
    expect(plan.installmentValue).toBe(plan.chargedTotal);
    expect(plan.chargedTotal).toBeGreaterThan(43.9);
    const net = plan.chargedTotal * (1 - 2.99 / 100) - client.CARD_OPERATION_FEE;
    expect(net).toBeGreaterThanOrEqual(43.9);
  });

  it("repassa a taxa da Asaas ao cliente no parcelado", () => {
    const plan = client.installmentPlan(1000, 12);
    expect(plan.installments).toBe(12);
    expect(plan.chargedTotal).toBeGreaterThan(1000);
    // líquido recebido continua >= total do pedido
    const net = plan.chargedTotal * (1 - 3.99 / 100) - client.CARD_OPERATION_FEE;
    expect(net).toBeGreaterThanOrEqual(1000);
  });

  it("respeita a parcela mínima de R$ 5,00", () => {
    expect(client.maxInstallmentsFor(43.9)).toBe(8);
    expect(client.maxInstallmentsFor(12)).toBe(2);
    expect(client.maxInstallmentsFor(4)).toBe(1);
  });
});
