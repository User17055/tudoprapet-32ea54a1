import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DetailsTab from "@/pages/admin/DetailsTab";

const { fetchAllRows, fetchAllRowsResult, insertResult } = vi.hoisted(() => ({
  fetchAllRows: vi.fn(),
  fetchAllRowsResult: vi.fn(),
  insertResult: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/fetchAllRows", () => ({ fetchAllRows, fetchAllRowsResult, ROW_PAGE_SIZE: 1000 }));
vi.mock("@/lib/shopify", () => ({
  fetchAllShopifyProducts: async () => [{
    node: {
      id: "p1",
      title: "Produto",
      vendor: "",
      productType: "",
      tags: [],
      images: { edges: [] },
      priceRange: { minVariantPrice: { amount: "10.00", currencyCode: "BRL" } },
      variants: { edges: [] },
    },
  }],
}));
vi.mock("@/components/admin/ProductPicker", () => ({
  ProductPicker: ({ onChange }: { onChange: (id: string) => void }) => (
    <button type="button" onClick={() => onChange("p1")}>abrir produto</button>
  ),
}));
vi.mock("@/integrations/supabase/client", () => {
  const empty = { data: [], error: null };
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve(empty),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (done: (value: typeof empty) => unknown) => Promise.resolve(empty).then(done),
    insert: (payload: unknown) => insertResult(payload),
  };
  return { supabase: { from: () => chain } };
});

const valuesByTable: Record<string, unknown[]> = {
  attribute_values: [
    { id: "v1", attr_key: "Idade", attr_value: "Adulto", sort_order: 0 },
    { id: "v2", attr_key: "Idade", attr_value: "Filhote", sort_order: 1 },
  ],
  attribute_keys: [{ id: "k1", name: "Idade" }],
};

describe("cadastro de atributos na tela de detalhes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchAllRows.mockResolvedValue([]);
    fetchAllRowsResult.mockImplementation(async (table: string) => ({ data: valuesByTable[table] ?? [], error: null }));
  });

  it("marca atributos em sequencia sem esperar o banco e sem recarregar as tabelas", async () => {
    let finishWrite!: (value: { error: null }) => void;
    insertResult.mockReturnValueOnce(new Promise((done) => { finishWrite = done; }));
    insertResult.mockResolvedValue({ error: null });

    render(<DetailsTab />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Atribuir a produtos/ }), { button: 0 });
    fireEvent.click(await screen.findByRole("button", { name: "abrir produto" }));

    const adulto = await screen.findByRole("button", { name: "Adulto" });
    const filhote = screen.getByRole("button", { name: "Filhote" });
    await waitFor(() => expect(fetchAllRows).toHaveBeenCalled());
    fetchAllRows.mockClear();

    fireEvent.click(adulto);
    expect(adulto.getAttribute("aria-pressed")).toBe("true");
    expect(adulto.getAttribute("aria-busy")).toBe("true");
    expect(filhote.hasAttribute("disabled")).toBe(false);

    fireEvent.click(filhote);
    expect(filhote.getAttribute("aria-pressed")).toBe("true");
    expect(insertResult).toHaveBeenCalledTimes(2);

    finishWrite({ error: null });
    await waitFor(() => expect(adulto.getAttribute("aria-busy")).toBe("false"));
    await waitFor(() => expect(filhote.getAttribute("aria-busy")).toBe("false"));
    expect(adulto.getAttribute("aria-pressed")).toBe("true");
    expect(fetchAllRows).not.toHaveBeenCalled();
  });
});
