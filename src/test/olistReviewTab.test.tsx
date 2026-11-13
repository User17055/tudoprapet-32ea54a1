import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OlistReviewTab from "@/pages/admin/OlistReviewTab";

const health = {
  without_invoice: 2,
  unsettled_paid: 1,
  without_receivable: 0,
  items: [
    {
      id: "s1", created_at: "2026-11-10T12:00:00Z", customer_type: "franchise", total: 1418.8, currency: "BRL",
      olist_order_number: "615", customer_name: "Petshopping", issue: "invoice", origin: "site",
      invoice_status: "rejected", reason: "CFOP inválido",
    },
    {
      id: "s2", created_at: "2026-11-11T12:00:00Z", customer_type: "subscriber", total: 27.2, currency: "BRL",
      olist_order_number: null, customer_name: "Monica", issue: "invoice", origin: "site",
      invoice_status: null, reason: "Total do pedido Olist diverge da Shopify",
    },
    {
      id: "s2", created_at: "2026-11-11T12:00:00Z", customer_type: "subscriber", total: 27.2, currency: "BRL",
      olist_order_number: null, customer_name: "Monica", issue: "settlement", origin: "site",
      invoice_status: null, reason: "Baixa ainda não confirmada na Olist",
    },
  ],
};

const status = {
  now: "2026-11-13T12:00:00Z",
  reconcile: { last_run: "2026-11-13T11:55:00Z", details: { invoices: { issued: 1 } } },
  sales_sync: {
    last_run: "2026-11-13T11:55:00Z", last_scan: "2026-11-13T11:30:00Z", details: null,
    orders: 266, queue: 0, waiting: 3, with_errors: 0, franchise: 4, automated: 14, automated_issued: 14,
  },
  webhooks: { total: 0, last_received: null, pending: 0, failed: 0 },
  olist_api: { calls_today: 120, blocks_today: 0, throttled_today: 2, last_blocked_at: null, blocked_until: null },
  price_reviews: { open: 1, requested: 1 },
};

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string) =>
      Promise.resolve({ data: name === "admin_sales_fiscal_health" ? health : status, error: null }),
    functions: {
      invoke: () => Promise.resolve({ data: { reviews: [], canDecide: false }, error: null }),
    },
  },
}));

describe("aba Revisão Olist", () => {
  it("mostra o resumo, os indicadores e a lista de pendências", async () => {
    render(<OlistReviewTab />);
    expect(await screen.findByText("4 pendências precisam de atenção.")).toBeTruthy();
    expect(screen.getByText("Vendas sem nota")).toBeTruthy();
    expect(screen.getByText("Petshopping")).toBeTruthy();
    expect(screen.getByText("CFOP inválido")).toBeTruthy();
    expect(screen.getAllByText("Monica")).toHaveLength(2);
  });

  it("indicador filtra a lista pelo tipo de pendência", async () => {
    render(<OlistReviewTab />);
    await screen.findByText("Petshopping");
    fireEvent.click(screen.getByText("Pagas sem baixa"));
    await waitFor(() => expect(screen.queryByText("Petshopping")).toBeNull());
    expect(screen.getByText("Baixa ainda não confirmada na Olist")).toBeTruthy();
  });

  it("busca por cliente e mostra automações na seção própria", async () => {
    render(<OlistReviewTab />);
    await screen.findByText("Petshopping");
    fireEvent.change(screen.getByLabelText("Buscar pendência"), { target: { value: "petsh" } });
    expect(screen.queryAllByText("Monica")).toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: /Automações/ }));
    expect(await screen.findByText("Automações da Olist")).toBeTruthy();
    expect(screen.getByText(/266 pedidos espelhados/)).toBeTruthy();
  });
});
