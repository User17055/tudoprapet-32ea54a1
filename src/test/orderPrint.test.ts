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
  customer_name: "João ^ Silva",
  address: "Rua São José, 10",
  line_items: [{ title: "Ração Premium", variant_title: "2 kg", quantity: 2, price: 29.95 }],
};

describe("impressão de pedido", () => {
  it("gera ZPL completo e remove caracteres de comando dos dados", () => {
    const zpl = orderToZpl(order);
    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl.endsWith("^XZ")).toBe(true);
    expect(zpl).toContain("Joao   Silva");
    expect(zpl).toContain("2x Racao Premium - 2 kg");
  });

  it("gera documento A4 com os dados do pedido", () => {
    const html = orderToA4Html(order);
    expect(html).toContain("Pedido #1042");
    expect(html).toContain("Ração Premium");
    expect(html).toContain("window.print()");
  });
});
