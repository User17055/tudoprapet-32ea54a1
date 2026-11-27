// Vendas do usuário (site + pedido de venda lançado na Olist), como devolvidas
// pela function `sales-orders`.

export type InvoiceStatus = "issued" | "pending" | "rejected" | "generating" | null;

export interface SaleInvoice {
  status: InvoiceStatus;
  number: string | null;
  url: string | null;
}

export interface SaleOrder {
  id: string;
  origin: "site" | "olist";
  createdAt: string;
  saleOrderNumber: string | null;
  total: number;
  currency: string;
  situation: string;
  items: Array<{ title: string; quantity: number; unitPrice: number; imageUrl: string | null }>;
  trackingCode: string | null;
  invoice: SaleInvoice;
  payment: {
    provider: "asaas" | "olist" | null;
    status: string | null;
    dueDate: string | null;
    boletoUrl: string | null;
  };
}

export type Tone = "success" | "warning" | "danger" | "info" | "muted";

export const TONE_CLASSES: Record<Tone, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-700",
  info: "border-blue-200 bg-blue-50 text-blue-700",
  muted: "border-slate-200 bg-slate-100 text-slate-600",
};

/**
 * Toda venda tem nota: enquanto ela não sai, o texto diz em que ponto está,
 * nunca deixa o campo em branco.
 */
export function invoiceState(invoice: SaleInvoice | null | undefined): { label: string; tone: Tone } {
  if (invoice?.status === "issued" || (invoice?.url && invoice.status !== "rejected")) {
    return { label: invoice?.number ? `NF-e ${invoice.number}` : "NF-e emitida", tone: "success" };
  }
  if (invoice?.status === "rejected") {
    return { label: "Nota em revisão pela nossa equipe", tone: "warning" };
  }
  if (invoice?.status === "pending") return { label: "Nota em autorização", tone: "info" };
  return { label: "Nota em emissão", tone: "info" };
}

const PAYMENT_STATES: Record<string, { label: string; tone: Tone }> = {
  received: { label: "Pago", tone: "success" },
  confirmed: { label: "Pago", tone: "success" },
  paid: { label: "Pago", tone: "success" },
  pending: { label: "Em aberto", tone: "warning" },
  processing: { label: "Em processamento", tone: "info" },
  overdue: { label: "Vencido", tone: "danger" },
  cancelled: { label: "Cancelado", tone: "muted" },
};

export function paymentState(status: string | null | undefined): { label: string; tone: Tone } | null {
  if (!status) return null;
  return PAYMENT_STATES[status] || { label: status, tone: "muted" };
}

/** Situação do pedido de venda na Olist ("Aprovado", "preparando_envio"...). */
export function situationState(situation: string): { label: string; tone: Tone } {
  const value = situation.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/_/g, " ")
    .trim().toLowerCase();
  if (value.includes("cancel")) return { label: "Cancelado", tone: "muted" };
  if (value === "entregue" || value === "atendido") return { label: "Entregue", tone: "success" };
  if (value === "enviado") return { label: "Enviado", tone: "info" };
  if (value === "em aberto" || value === "aberto") return { label: "Em aberto", tone: "warning" };
  if (!value) return { label: "Em andamento", tone: "info" };
  const label = value.charAt(0).toUpperCase() + value.slice(1);
  return { label, tone: "info" };
}

export const formatMoney = (value: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value || 0);

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

/** due_date chega como "yyyy-mm-dd". */
export const formatDueDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${value.slice(0, 10)}T12:00:00-03:00`)) : null;
