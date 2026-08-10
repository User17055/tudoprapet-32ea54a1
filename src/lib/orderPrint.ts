// Impressão de pedido: monta o HTML do comprovante e abre a caixa de impressão.
//
// Fica separado do componente para poder ser testado e reutilizado pelo agente
// de impressão remoto (que consome o mesmo formato de pedido de `admin-orders`).

export interface PrintLineItem {
  title: string;
  variant_title?: string | null;
  sku?: string | null;
  quantity: number;
  price: number;
}

export interface PrintOrder {
  name?: string;
  order_number?: number | string;
  created_at?: string;
  customer_name?: string;
  customer_email?: string | null;
  customer_phone?: string | null;
  financial_status?: string | null;
  fulfillment_status?: string | null;
  cancelled_at?: string | null;
  total_price: number;
  currency?: string;
  note?: string | null;
  pickup_code?: string | null;
  picked_up_at?: string | null;
  line_items: PrintLineItem[];
}

export const STORE_NAME = "TudoPraPet";

export const formatMoney = (value: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(Number(value) || 0);

export const formatDateTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

const STATUS_LABELS: Record<string, string> = {
  paid: "Pago",
  pending: "Pendente",
  refunded: "Reembolsado",
  partially_refunded: "Parcialmente reembolsado",
  voided: "Cancelado",
  authorized: "Autorizado",
  fulfilled: "Enviado/Retirado",
  partial: "Parcial",
  restocked: "Reestocado",
  unfulfilled: "Não processado",
};

export const statusLabel = (status?: string | null) =>
  status ? STATUS_LABELS[status] ?? status : "Não processado";

export function orderStatusSummary(order: PrintOrder): string {
  if (order.cancelled_at) return "Cancelado";
  return `${statusLabel(order.financial_status)} · ${statusLabel(order.fulfillment_status)}`;
}

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** HTML do comprovante — largura de bobina 80mm, também legível em A4. */
export function buildOrderPrintHtml(order: PrintOrder): string {
  const currency = order.currency || "BRL";
  const itemsTotal = order.line_items.reduce((sum, li) => sum + li.price * li.quantity, 0);

  const rows = order.line_items
    .map(
      (li) => `
      <tr>
        <td class="qty">${escapeHtml(li.quantity)}x</td>
        <td>
          <div class="title">${escapeHtml(li.title)}</div>
          ${li.variant_title ? `<div class="muted">${escapeHtml(li.variant_title)}</div>` : ""}
          ${li.sku ? `<div class="muted">SKU ${escapeHtml(li.sku)}</div>` : ""}
        </td>
        <td class="right">${escapeHtml(formatMoney(li.price * li.quantity, currency))}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Pedido ${escapeHtml(order.name || order.order_number || "")} — ${STORE_NAME}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { font-family: "Nunito", Arial, sans-serif; color: #10182b; margin: 0; font-size: 12px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  .header { text-align: center; border-bottom: 1px dashed #94a3b8; padding-bottom: 8px; margin-bottom: 8px; }
  .muted { color: #64748b; font-size: 10px; }
  .block { margin-bottom: 8px; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; vertical-align: top; }
  .qty { width: 26px; font-weight: 700; }
  .right { text-align: right; white-space: nowrap; }
  .title { font-weight: 600; }
  .total { border-top: 1px dashed #94a3b8; margin-top: 8px; padding-top: 6px; font-size: 14px; font-weight: 800; }
  .code { text-align: center; border: 1px solid #10182b; border-radius: 6px; padding: 6px; margin-top: 8px; font-size: 15px; font-weight: 800; letter-spacing: 1px; }
  .foot { text-align: center; margin-top: 10px; }
</style>
</head>
<body>
  <div class="header">
    <h1>${STORE_NAME}</h1>
    <div class="muted">Pedido ${escapeHtml(order.name || `#${order.order_number ?? ""}`)}</div>
    <div class="muted">${escapeHtml(formatDateTime(order.created_at))}</div>
  </div>

  <div class="block">
    <div><strong>${escapeHtml(order.customer_name || "Cliente")}</strong></div>
    ${order.customer_phone ? `<div class="muted">${escapeHtml(order.customer_phone)}</div>` : ""}
    ${order.customer_email ? `<div class="muted">${escapeHtml(order.customer_email)}</div>` : ""}
    <div class="muted">Status: ${escapeHtml(orderStatusSummary(order))}</div>
  </div>

  <table>${rows}</table>

  <div class="row total">
    <span>Total</span>
    <span>${escapeHtml(formatMoney(order.total_price || itemsTotal, currency))}</span>
  </div>

  ${order.pickup_code ? `<div class="code">Retirada: ${escapeHtml(order.pickup_code)}</div>` : ""}
  ${order.picked_up_at ? `<div class="muted foot">Retirado em ${escapeHtml(order.picked_up_at)}</div>` : ""}
  ${order.note ? `<div class="block muted">Obs.: ${escapeHtml(order.note)}</div>` : ""}

  <div class="foot muted">Obrigado pela preferência!</div>
</body>
</html>`;
}

/** Abre a janela de impressão do navegador com o comprovante do pedido. */
export function printOrder(order: PrintOrder): boolean {
  const html = buildOrderPrintHtml(order);
  const win = window.open("", "_blank", "width=420,height=640");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
  return true;
}
