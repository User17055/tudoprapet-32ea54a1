// Funções puras do domínio financeiro. Não dependem de Deno/fetch para que os
// mesmos casos sejam exercitados pelo Vitest do frontend.

export type LocalPaymentStatus =
  | "pending"
  | "processing"
  | "cancellation_requested"
  | "confirmed"
  | "received"
  | "overdue"
  | "refunded"
  | "chargeback"
  | "cancelled"
  | "failed";

export interface ParsedAsaasEvent {
  eventId: string;
  eventType: string;
  providerPaymentId: string | null;
  externalReference: string | null;
  providerStatus: string | null;
  payload: Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function parseAsaasEvent(raw: unknown): ParsedAsaasEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const payload = raw as Record<string, unknown>;
  const eventId = nonEmptyString(payload.id);
  const eventType = nonEmptyString(payload.event);
  if (!eventId || !eventType) return null;

  const payment = payload.payment && typeof payload.payment === "object" && !Array.isArray(payload.payment)
    ? payload.payment as Record<string, unknown>
    : {};

  return {
    eventId,
    eventType,
    providerPaymentId: nonEmptyString(payment.id),
    externalReference: nonEmptyString(payment.externalReference),
    providerStatus: nonEmptyString(payment.status),
    payload,
  };
}

export function mapAsaasPaymentStatus(
  eventType: string,
  providerStatus?: string | null,
): LocalPaymentStatus | null {
  const value = (providerStatus || eventType.replace(/^PAYMENT_/, "")).toUpperCase();
  const map: Record<string, LocalPaymentStatus> = {
    PENDING: "pending",
    CREATED: "pending",
    UPDATED: "pending",
    AWAITING_RISK_ANALYSIS: "processing",
    APPROVED_BY_RISK_ANALYSIS: "processing",
    CONFIRMED: "confirmed",
    RECEIVED: "received",
    RECEIVED_IN_CASH: "received",
    OVERDUE: "overdue",
    REFUNDED: "refunded",
    REFUND_IN_PROGRESS: "processing",
    CHARGEBACK_REQUESTED: "chargeback",
    CHARGEBACK_DISPUTE: "chargeback",
    AWAITING_CHARGEBACK_REVERSAL: "chargeback",
    DUNNING_RECEIVED: "received",
    DUNNING_REQUESTED: "processing",
    DELETED: "cancelled",
    BANK_SLIP_CANCELLED: "cancelled",
    REPROVED_BY_RISK_ANALYSIS: "failed",
  };
  return map[value] ?? null;
}

const STATUS_RANK: Record<LocalPaymentStatus, number> = {
  pending: 10,
  processing: 20,
  cancellation_requested: 25,
  overdue: 30,
  cancelled: 35,
  failed: 35,
  confirmed: 50,
  received: 60,
  refunded: 70,
  chargeback: 80,
};

/**
 * Eventos financeiros conclusivos vencem cancelamento/inatividade. Para os
 * demais, um webhook atrasado não pode rebaixar o estado já observado.
 */
export function shouldApplyPaymentStatus(
  current: LocalPaymentStatus,
  next: LocalPaymentStatus,
): boolean {
  if (current === next) return true;
  if (next === "received" || next === "refunded" || next === "chargeback") return true;
  return STATUS_RANK[next] >= STATUS_RANK[current];
}

export function retryDelaySeconds(attempt: number): number {
  return Math.min(3600, Math.max(30, 30 * (2 ** Math.max(0, attempt - 1))));
}

