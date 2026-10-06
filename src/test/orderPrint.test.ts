import { describe, expect, it } from "vitest";
import { orderToA4Html, orderToZpl, type PrintableOrder } from "@/lib/orderPrint";

const order: PrintableOrder = {
  id: 123,
  name: "#1042",
  created_at: "2026-08-10T12:00:00Z",
  total_price: 59.9,
  currency: "BRL",
  financial_status: "paid",
  fulfillment_status: null,
  delivery_label: "RETIRADA",
  shipping_method: "Retirada na loja",
  customer_name: "João ^ Silva",
  address: "Rua São José, 10",
  line_items: [{ title: "Ração Premium", variant_title: "2 kg", quantity: 2, price: 29.95 }],
};

describe("impressão de pedido", () => {
  it("gera ZPL completo e remove caracteres de comando dos dados", () => {
    const zpl = orderToZpl(order);
    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl.endsWith("^XZ")).toBe(true);
    expect(zpl).toContain("TPP-ZPL-V3");
    expect(zpl).toContain("^GFA");
    expect(zpl).toContain("Joao   Silva");
    expect(zpl).toContain("2x Racao Premium - 2 kg");
    expect(zpl).toContain("^FDRETIRADA^FS");
    expect(zpl).toContain("RETIRAR NA LOJA TUDOPRAPET");
    expect(zpl).toContain("^LL1200");
    expect(zpl).not.toContain("Separacao:");
  });

  it("divide pedidos grandes em etiquetas sem cortar nenhum item", () => {
    const largeOrder: PrintableOrder = {
      ...order,
      line_items: Array.from({ length: 12 }, (_, index) => ({
        title: `Produto ${index + 1}`,
        quantity: 1,
        price: index + 1,
      })),
    };
    const zpl = orderToZpl(largeOrder);

    expect(zpl.match(/\^XA/g)).toHaveLength(3);
    expect(zpl.match(/\^XZ/g)).toHaveLength(3);
    expect(zpl.match(/\^LL1200/g)).toHaveLength(3);
    expect(zpl).toContain("ITENS 1-5 DE 12 - FOLHA 1/3");
    expect(zpl).toContain("ITENS 11-12 DE 12 - FOLHA 3/3");
    for (let index = 1; index <= 12; index += 1) {
      expect(zpl).toContain(`1x Produto ${index}`);
    }
  });

  it("gera documento A4 com os dados do pedido", () => {
    const html = orderToA4Html(order);
    expect(html).toContain("Pedido #1042");
    expect(html).toContain("Ração Premium");
    expect(html).toContain("window.print()");
  });
});
