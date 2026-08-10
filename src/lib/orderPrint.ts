export interface PrintableOrderItem {
  title: string;
  variant_title?: string | null;
  sku?: string | null;
  quantity: number;
  price: number;
}

export interface PrintableOrder {
  id: number | string;
  name: string;
  created_at: string;
  total_price: number;
  subtotal_price?: number;
  total_discounts?: number;
  shipping_price?: number;
  shipping_method?: string | null;
  delivery_label?: string | null;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  customer_name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  note?: string | null;
  line_items: PrintableOrderItem[];
}

const money = (value: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value || 0);

const zplText = (value: unknown, max = 42) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\^~]/g, " ")
    .replace(/[^\x20-\x7E]/g, " ")
    .slice(0, max);

export function orderToZpl(order: PrintableOrder): string {
  let y = 315;
  const renderedItems = order.line_items.map((item, index) => {
    if (index > 0) y += 55;
    const name = `${item.quantity}x ${item.title}${item.variant_title ? ` - ${item.variant_title}` : ""}`;
    return `^FO25,${y}^A0N,25,25^FB460,2,2,L^FD${zplText(name, 80)}^FS\n^FO500,${y}^A0N,25,25^FB175,1,0,R^FD${zplText(money(item.price * item.quantity, order.currency), 20)}^FS`;
  }).join("\n");
  const totalY = y + 75;
  const height = Math.max(650, totalY + 180);

  return `^XA
^CI28
^PW700
^LL${height}
^FO25,25^A0N,40,40^FDTUDOPRAPET^FS
^FO25,75^A0N,34,34^FDPEDIDO ${zplText(order.name, 24)}^FS
^FO25,120^A0N,22,22^FDData: ${zplText(new Date(order.created_at).toLocaleString("pt-BR"), 34)}^FS
^FO25,150^A0N,22,22^FDCliente: ${zplText(order.customer_name, 48)}^FS
^FO25,180^A0N,22,22^FDTelefone: ${zplText(order.phone || "Nao informado", 32)}^FS
^FO25,210^A0N,22,22^FB650,2,2,L^FDEntrega: ${zplText(order.address || "Nao informado", 90)}^FS
^FO25,275^GB650,2,2^FS
${renderedItems}
^FO25,${totalY}^GB650,2,2^FS
^FO25,${totalY + 25}^A0N,32,32^FDTotal^FS
^FO430,${totalY + 25}^A0N,32,32^FB245,1,0,R^FD${zplText(money(order.total_price, order.currency), 22)}^FS
^FO25,${totalY + 75}^A0N,20,20^FDPagamento: ${zplText(order.financial_status, 25)}^FS
^FO25,${totalY + 105}^A0N,20,20^FDSeparacao: ${zplText(order.fulfillment_status || "nao separado", 25)}^FS
^XZ`;
}

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[char] || char));

export function orderToA4Html(order: PrintableOrder): string {
  const rows = order.line_items.map((item) => `<tr><td>${escapeHtml(item.title)}${item.variant_title ? `<small>${escapeHtml(item.variant_title)}</small>` : ""}</td><td>${item.quantity}</td><td>${money(item.price, order.currency)}</td><td>${money(item.price * item.quantity, order.currency)}</td></tr>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Pedido ${escapeHtml(order.name)}</title><style>
  @page{size:A4;margin:16mm}body{font:14px Arial;color:#172033}header{display:flex;justify-content:space-between;border-bottom:3px solid #112f5f;padding-bottom:14px}h1{margin:0;color:#112f5f}.meta{line-height:1.7;margin:20px 0}.box{border:1px solid #ccd3df;border-radius:8px;padding:14px;margin-bottom:18px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd}th{background:#f3f5f8}td:nth-child(n+2),th:nth-child(n+2){text-align:right}small{display:block;color:#667}.total{text-align:right;font-size:20px;font-weight:bold;margin-top:18px}.no-print{margin-top:25px;text-align:center}@media print{.no-print{display:none}}</style></head><body>
  <header><div><h1>TudoPraPet</h1><div>Pedido ${escapeHtml(order.name)}</div></div><div>${new Date(order.created_at).toLocaleString("pt-BR")}</div></header>
  <section class="meta"><div><b>Cliente:</b> ${escapeHtml(order.customer_name)}</div><div><b>Telefone:</b> ${escapeHtml(order.phone || "Não informado")}</div><div><b>E-mail:</b> ${escapeHtml(order.email || "Não informado")}</div></section>
  <section class="box"><b>Entrega:</b> ${escapeHtml(order.address || "Não informado")}${order.note ? `<p><b>Observação:</b> ${escapeHtml(order.note)}</p>` : ""}</section>
  <table><thead><tr><th>Produto</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="total">Total: ${money(order.total_price, order.currency)}</div><p>Pagamento: ${escapeHtml(order.financial_status)} · Separação: ${escapeHtml(order.fulfillment_status || "não separado")}</p>
  <div class="no-print"><button onclick="window.print()">Imprimir</button></div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250))</script></body></html>`;
}
