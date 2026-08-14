import { describe, expect, it } from "vitest";
import {
  mapAsaasPaymentStatus,
  isPaidPaymentStatus,
  parseAsaasEvent,
  retryDelaySeconds,
  shouldApplyPaymentStatus,
} from "../../supabase/functions/_shared/payment-events.ts";

describe("eventos financeiros Asaas", () => {
  it("extrai os identificadores usados na idempotência e conciliação", () => {
    expect(parseAsaasEvent({
      id: "evt_1",
      event: "PAYMENT_RECEIVED",
      payment: { id: "pay_1", externalReference: "payment-uuid", status: "RECEIVED" },
      campoFuturo: true,
    })).toMatchObject({
      eventId: "evt_1",
      eventType: "PAYMENT_RECEIVED",
      providerPaymentId: "pay_1",
      externalReference: "payment-uuid",
      providerStatus: "RECEIVED",
    });
  });

  it("rejeita payload sem id estável ou tipo", () => {
    expect(parseAsaasEvent({ event: "PAYMENT_RECEIVED" })).toBeNull();
    expect(parseAsaasEvent({ id: "evt" })).toBeNull();
  });

  it("mapeia estados conclusivos", () => {
    expect(mapAsaasPaymentStatus("PAYMENT_CONFIRMED", "CONFIRMED")).toBe("confirmed");
    expect(mapAsaasPaymentStatus("PAYMENT_RECEIVED", "RECEIVED")).toBe("received");
    expect(mapAsaasPaymentStatus("PAYMENT_REFUNDED", "REFUNDED")).toBe("refunded");
    expect(mapAsaasPaymentStatus("PAYMENT_CHARGEBACK_REQUESTED", null)).toBe("chargeback");
  });

  it("trata confirmação e recebimento como pagamento efetuado", () => {
    expect(isPaidPaymentStatus("confirmed")).toBe(true);
    expect(isPaidPaymentStatus("received")).toBe(true);
    expect(isPaidPaymentStatus("pending")).toBe(false);
    expect(isPaidPaymentStatus("cancelled")).toBe(false);
  });

  it("não deixa evento atrasado rebaixar pagamento recebido", () => {
    expect(shouldApplyPaymentStatus("received", "pending")).toBe(false);
    expect(shouldApplyPaymentStatus("received", "overdue")).toBe(false);
    expect(shouldApplyPaymentStatus("cancelled", "received")).toBe(true);
    expect(shouldApplyPaymentStatus("received", "refunded")).toBe(true);
  });

  it("limita o backoff a uma hora", () => {
    expect(retryDelaySeconds(1)).toBe(30);
    expect(retryDelaySeconds(2)).toBe(60);
    expect(retryDelaySeconds(99)).toBe(3600);
  });
});
