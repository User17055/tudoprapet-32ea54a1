import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Tela Valores com o retrato da Olist (26/11/2026): a tela não pode quebrar
// antes da publicação da migration (tabelas novas ausentes), e com o retrato
// mostra a Olist ao lado do site e simula antes de gravar.

const state = vi.hoisted(() => ({
  olistMissing: false,
  invokes: [] as Array<{ name: string; body: Record<string, unknown> }>,
}));

const V1 = "gid://shopify/ProductVariant/1";
const V2 = "gid://shopify/ProductVariant/2";

const tables: Record<string, Array<Record<string, unknown>>> = {
  product_costs: [
    { shopify_variant_id: V1, cost: "41.35", previous_cost: null, cost_changed_at: null, synced_at: "2026-11-25T18:00:00Z", created_at: "2026-10-01T12:00:00Z" },
  ],
  franchise_prices: [
    { shopify_product_id: "gid://shopify/Product/1", shopify_variant_id: V1, price: "41.35", price_changed_at: "2026-11-25T18:00:00Z", created_at: "2026-10-01T12:00:00Z" },
  ],
  subscriber_prices: [
    { shopify_variant_id: V1, subscriber_price: "43.42", price_changed_at: null, created_at: "2026-10-01T12:00:00Z" },
  ],
  customer_prices: [],
  olist_product_snapshot: [
    { olist_product_id: "500", sku: "75831", sku_key: "75831", name: "Ração Premier 7,5 kg", price: "241.20", promo_price: null, cost: "172.28", status: "A", fetched_at: "2026-11-26T14:00:00Z" },
  ],
  olist_price_lists: [{ olist_price_list_id: "1872", name: "Franqueados", adjustment_percent: "0" }],
  olist_price_list_exceptions: [{ olist_price_list_id: "1872", olist_product_id: "500", price: "241.20", promo_price: "120.00" }],
  olist_catalog_runs: [{
    id: "run-1", kind: "catalog", status: "done", started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    products: 1, price_lists: 1, exceptions: 1, applied: 0, changed: 0, not_found: 0, failed: 0, error: null,
  }],
};
const NEW_TABLES = new Set(["olist_product_snapshot", "olist_price_lists", "olist_price_list_exceptions", "olist_catalog_runs"]);

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

vi.mock("@/integrations/supabase/client", () => {
  const query = (table: string) => {
    const result = () => {
      if (state.olistMissing && NEW_TABLES.has(table)) {
        return { data: null, error: { message: `relation "public.${table}" does not exist` } };
      }
      return { data: tables[table] ?? [], error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      order: () => builder,
      limit: () => Promise.resolve(result()),
      range: (from: number) => Promise.resolve(from === 0 ? result() : { data: [], error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return builder;
  };
  const channel: Record<string, unknown> = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: query,
      channel: () => channel,
      removeChannel: () => undefined,
      functions: {
        invoke: (name: string, { body }: { body: Record<string, unknown> }) => {
          state.invokes.push({ name, body });
          const items = (body.items as Array<{ variantId: string; sku: string }>) ?? [];
          return Promise.resolve({
            data: {
              ok: true,
              runId: "apply-1",
              results: items.map((item) => ({
                variantId: item.variantId,
                sku: item.sku,
                status: "ok",
                olistName: "Ração Premier 7,5 kg",
                cost: { before: 41.35, after: 172.28 },
                franchise: { before: 41.35, after: 172.28 },
                subscriber: { before: 43.42, after: 180.89 },
                changed: true,
              })),
            },
            error: null,
          });
        },
      },
    },
  };
});

vi.mock("@/lib/shopify", () => ({
  fetchAllShopifyProducts: () => Promise.resolve([1, 2].map((n) => ({
    node: {
      id: `gid://shopify/Product/${n}`,
      title: n === 1 ? "Ração Premier Ambientes Internos 7,5 kg" : "Brinquedo sem SKU",
      description: "",
      handle: `p${n}`,
      vendor: n === 1 ? "Premier" : "Outra",
      tags: [],
      productType: "",
      priceRange: { minVariantPrice: { amount: "241.20", currencyCode: "BRL" } },
      images: { edges: [] },
      variants: {
        edges: [{
          node: {
            id: `gid://shopify/ProductVariant/${n}`,
            title: "Default Title",
            sku: n === 1 ? "75831" : "",
            price: { amount: n === 1 ? "241.20" : "30.00", currencyCode: "BRL" },
            availableForSale: true,
            selectedOptions: [],
          },
        }],
      },
    },
  }))),
}));

vi.mock("@/lib/catalogData", () => ({
  fetchStoreCategories: () => Promise.resolve([{ id: "c1", name: "Ração", slug: "racao", parent_id: null, sort_order: 0 }]),
  fetchProductCategoryRows: () => Promise.resolve([{ shopify_product_id: "gid://shopify/Product/1", category_id: "c1" }]),
  fetchStoreBrands: () => Promise.resolve([]),
  fetchProductBrandRows: () => Promise.resolve([]),
}));

vi.mock("@/components/admin/SubscriberCategoryMarginsCard", () => ({ SubscriberCategoryMarginsCard: () => null }));

const { default: ValuesTab } = await import("@/pages/admin/ValuesTab");

beforeEach(() => {
  state.olistMissing = false;
  state.invokes = [];
});

describe("tela Valores com o catálogo da Olist", () => {
  it("antes da publicação (tabelas novas ausentes) a tela abre e mantém o botão antigo", async () => {
    state.olistMissing = true;
    render(<ValuesTab />);
    expect(await screen.findByText("Ração Premier Ambientes Internos 7,5 kg")).toBeInTheDocument();
    expect(await screen.findByText(/Aguardando a publicação das tabelas novas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Atualizar todos pela Olist \(1\)/ })).toBeInTheDocument();
  });

  it("mostra a Olist ao lado do site, as datas e a lista Franqueados diferente", async () => {
    render(<ValuesTab />);
    expect(await screen.findByText(/Lido em/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Atualizar todos pela Olist/ })).not.toBeInTheDocument();
    expect(await screen.findByText(/Olist: R\$\s?172,28 · diferente/)).toBeInTheDocument();
    expect(screen.getByText(/Lista Franqueados: R\$\s?120,00 · diferente/)).toBeInTheDocument();
    expect(screen.getByText(/conferido 25\/11/)).toBeInTheDocument();
    // Produto sem SKU não é acusado como "fora do catálogo".
    expect(screen.queryByText(/Fora do catálogo da Olist/)).not.toBeInTheDocument();
  });

  it("seleciona, simula sem gravar e só grava ao confirmar", async () => {
    render(<ValuesTab />);
    await screen.findByText(/Lido em/);
    fireEvent.click(screen.getByRole("checkbox", { name: /Selecionar Ração Premier/ }));
    fireEvent.click(screen.getByRole("button", { name: /Simular e atualizar pela Olist \(1\)/ }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Aplicar no site \(1\)/ })).toBeEnabled());
    expect(state.invokes.map((call) => call.body.action)).toEqual(["apply"]);
    expect(state.invokes[0].body.dryRun).toBe(true);
    expect(within(dialog).getByText(/1 custos · 1 franquias · 1 assinantes/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /Aplicar no site \(1\)/ }));
    await waitFor(() => expect(state.invokes.some((call) => call.body.action === "finish")).toBe(true));
    const write = state.invokes.find((call) => call.body.action === "apply" && call.body.dryRun !== true);
    expect(write?.body.items).toEqual([{ productId: "gid://shopify/Product/1", variantId: V1, sku: "75831", weightKg: 7.5 }]);
  });
});
