import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProductAttributeToggle, type ProductAttributeRow } from "@/hooks/useProductAttributeToggle";

type DbResult = { data?: unknown; error: { code?: string; message?: string } | null };

const { from, insertResult, deleteResult, selectResult, toastError } = vi.hoisted(() => ({
  from: vi.fn(),
  insertResult: vi.fn(),
  deleteResult: vi.fn(),
  selectResult: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

const row = (id: string, key = "Idade", value = "Adulto", productId = "p1"): ProductAttributeRow => ({
  id,
  shopify_product_id: productId,
  attr_key: key,
  attr_value: value,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

function setup(initial: ProductAttributeRow[] = [], summary: ProductAttributeRow[] = initial) {
  return renderHook(
    ({ productId }) => {
      const [attrs, setAttrs] = useState(initial);
      const [allProductAttrs, setAllProductAttrs] = useState(summary);
      const toggle = useProductAttributeToggle({ productId, attrs, setAttrs, setAllProductAttrs });
      return { attrs, allProductAttrs, setAttrs, ...toggle };
    },
    { initialProps: { productId: "p1" } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  insertResult.mockResolvedValue({ error: null });
  deleteResult.mockResolvedValue({ error: null });
  from.mockImplementation(() => ({
    insert: (payload: unknown) => insertResult(payload),
    delete: () => ({ eq: () => deleteResult() }),
    select: () => {
      const chain = { eq: () => chain, maybeSingle: () => selectResult() };
      return chain;
    },
  }));
});

describe("useProductAttributeToggle", () => {
  it("marca na hora, antes de o banco responder, e nao rele nada depois", async () => {
    const write = deferred<DbResult>();
    insertResult.mockReturnValue(write.promise);
    const { result } = setup([], [row("outro", "Pet", "Gato", "p2")]);

    let toggling!: Promise<void>;
    act(() => { toggling = result.current.toggleAttribute("Idade", "Adulto"); });

    expect(result.current.attrs).toHaveLength(1);
    expect(result.current.attrs[0]).toMatchObject({ attr_key: "Idade", attr_value: "Adulto", shopify_product_id: "p1" });
    expect(result.current.allProductAttrs).toHaveLength(2);
    expect(result.current.isAttributePending("Idade", "Adulto")).toBe(true);
    expect(result.current.isAttributePending("Idade", "Filhote")).toBe(false);
    expect(result.current.hasPendingAttributeWrites).toBe(true);

    await act(async () => { write.resolve({ error: null }); await toggling; });

    expect(result.current.hasPendingAttributeWrites).toBe(false);
    expect(from).toHaveBeenCalledTimes(1);
    expect(selectResult).not.toHaveBeenCalled();
  });

  it("grava com o mesmo id mostrado na tela", async () => {
    const { result } = setup();
    await act(async () => { await result.current.toggleAttribute("Idade", "Adulto"); });

    const sent = insertResult.mock.calls[0][0] as ProductAttributeRow & { sort_order: number };
    expect(sent.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.current.attrs[0].id).toBe(sent.id);
    expect(sent.sort_order).toBe(0);
  });

  it("nao trava os outros atributos, mas ignora novo clique no que esta gravando", async () => {
    const write = deferred<DbResult>();
    insertResult.mockReturnValueOnce(write.promise).mockResolvedValue({ error: null });
    const { result } = setup();

    let first!: Promise<void>;
    act(() => { first = result.current.toggleAttribute("Idade", "Adulto"); });
    await act(async () => {
      await result.current.toggleAttribute("Idade", "Adulto");
      await result.current.toggleAttribute("Idade", "Filhote");
    });

    expect(insertResult).toHaveBeenCalledTimes(2);
    expect(result.current.attrs.map((item) => item.attr_value)).toEqual(["Adulto", "Filhote"]);

    await act(async () => { write.resolve({ error: null }); await first; });
    expect(result.current.attrs).toHaveLength(2);
  });

  it("desfaz a marcacao e avisa quando a gravacao falha", async () => {
    insertResult.mockResolvedValue({ error: { message: "sem permissao" } });
    const { result } = setup();
    await act(async () => { await result.current.toggleAttribute("Idade", "Adulto"); });

    expect(result.current.attrs).toEqual([]);
    expect(result.current.allProductAttrs).toEqual([]);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(result.current.hasPendingAttributeWrites).toBe(false);
  });

  it("desmarca na hora e devolve o atributo se a remocao falhar", async () => {
    const write = deferred<DbResult>();
    deleteResult.mockReturnValue(write.promise);
    const existing = row("existente");
    const { result } = setup([existing]);

    let toggling!: Promise<void>;
    act(() => { toggling = result.current.toggleAttribute("Idade", "Adulto"); });
    expect(result.current.attrs).toEqual([]);

    await act(async () => { write.resolve({ error: { message: "falhou" } }); await toggling; });
    expect(result.current.attrs).toEqual([existing]);
    expect(result.current.allProductAttrs).toEqual([existing]);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("nao poe atributo no produto novo quando a gravacao termina depois da troca", async () => {
    const write = deferred<DbResult>();
    insertResult.mockReturnValue(write.promise);
    const { result, rerender } = setup();

    let toggling!: Promise<void>;
    act(() => { toggling = result.current.toggleAttribute("Idade", "Adulto"); });
    act(() => { result.current.setAttrs([row("do-p2", "Pet", "Gato", "p2")]); });
    rerender({ productId: "p2" });

    await act(async () => { write.resolve({ error: null }); await toggling; });

    expect(result.current.attrs.map((item) => item.id)).toEqual(["do-p2"]);
    expect(result.current.allProductAttrs.some((item) => item.shopify_product_id === "p1")).toBe(true);
  });

  it("recoloca a marcacao se uma leitura do produto a apagou durante a gravacao", async () => {
    const write = deferred<DbResult>();
    insertResult.mockReturnValue(write.promise);
    const { result } = setup();

    let toggling!: Promise<void>;
    act(() => { toggling = result.current.toggleAttribute("Idade", "Adulto"); });
    act(() => { result.current.setAttrs([]); });
    await act(async () => { write.resolve({ error: null }); await toggling; });

    expect(result.current.attrs).toHaveLength(1);
  });

  it("adota a linha do banco quando outra aba ja marcou o mesmo atributo", async () => {
    const fromDb = row("id-do-banco");
    insertResult.mockResolvedValue({ error: { code: "23505" } });
    selectResult.mockResolvedValue({ data: fromDb, error: null });
    const { result } = setup();

    await act(async () => { await result.current.toggleAttribute("Idade", "Adulto"); });

    expect(result.current.attrs).toEqual([fromDb]);
    expect(result.current.allProductAttrs).toEqual([fromDb]);
    expect(toastError).not.toHaveBeenCalled();
  });
});

// Trava contra a volta da lentidao: recarregar tudo ou desabilitar todos os botoes a cada clique.
describe("DetailsTab", () => {
  const source = readFileSync(join(process.cwd(), "src/pages/admin/DetailsTab.tsx"), "utf8");

  it("usa o hook e nao redefine o clique com recarga completa", () => {
    expect(source).toContain("useProductAttributeToggle({");
    expect(source).not.toMatch(/const toggleAttribute\s*=/);
  });

  it("nao desabilita os botoes de atributo durante uma gravacao", () => {
    const button = source.slice(source.indexOf("aria-pressed={selected}"), source.indexOf("onClick={() => toggleAttribute"));
    expect(button).not.toBe("");
    expect(button).not.toContain("disabled=");
  });
});
