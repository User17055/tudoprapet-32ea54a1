// Tipos e textos da aba "Revisão Olist" do admin (pendências fiscais,
// revisão de preço de franquia e automações).

export interface SalesFiscalIssue {
  id: string;
  created_at: string;
  customer_type: "common" | "subscriber" | "franchise" | "unknown" | string;
  total: number | null;
  currency: string | null;
  olist_order_number: string | null;
  customer_name: string;
  issue: "invoice" | "settlement" | "receivable";
  origin?: "site" | "olist";
  invoice_status: string | null;
  reason: string;
  /** Só se resolve com correção na Olist (tentado uma vez por dia). */
  needs_action?: boolean;
  next_retry_at?: string | null;
}

export interface SalesFiscalHealth {
  without_invoice: number;
  unsettled_paid: number;
  without_receivable?: number;
  needs_action?: number;
  waiting?: number;
  items: SalesFiscalIssue[];
}

export const ISSUE_LABELS: Record<SalesFiscalIssue["issue"], string> = {
  invoice: "Sem nota fiscal",
  settlement: "Paga sem baixa",
  receivable: "Franquia sem boleto",
};

export const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  common: "Cliente",
  subscriber: "Assinante",
  franchise: "Franquia",
  unknown: "Cliente não identificado",
};

export const formatMoney = (value: number | null | undefined, currency?: string | null) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(Number(value) || 0);

/** "em 3 h", "em 20 min" — quando o sistema tenta de novo. */
export function formatNextRetry(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (minutes <= 10) return "na próxima rodada (até 10 min)";
  if (minutes < 60) return `em ${minutes} min`;
  return `em ${Math.round(minutes / 60)} h`;
}

export function formatAge(iso: string, now = Date.now()): string {
  const hours = Math.floor((now - Date.parse(iso)) / 3_600_000);
  if (hours < 1) return "há menos de 1 h";
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} dias`;
}
