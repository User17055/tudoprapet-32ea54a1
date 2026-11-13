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
}

export interface SalesFiscalHealth {
  without_invoice: number;
  unsettled_paid: number;
  without_receivable?: number;
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

export function formatAge(iso: string, now = Date.now()): string {
  const hours = Math.floor((now - Date.parse(iso)) / 3_600_000);
  if (hours < 1) return "há menos de 1 h";
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} dias`;
}
