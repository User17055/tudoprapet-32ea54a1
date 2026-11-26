import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Leitura do catálogo da Olist (26/11/2026): o limite por minuto enche no meio
// da leitura; a tela tem de esperar o tempo devolvido e repetir só o pedido.

const responses = vi.hoisted(() => [] as Array<{ data: unknown; error: unknown }>);
const calls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: (_name: string, { body }: { body: Record<string, unknown> }) => {
        calls.push(body);
        return Promise.resolve(responses.shift() ?? { data: null, error: { message: "sem resposta" } });
      },
    },
  },
}));

const { invokeOlistCatalog } = await import("@/lib/olistCatalogApi");

beforeEach(() => {
  vi.useFakeTimers();
  responses.length = 0;
  calls.length = 0;
});

afterEach(() => vi.useRealTimers());

describe("invokeOlistCatalog", () => {
  it("limite cheio: espera o tempo devolvido, avisa e repete o mesmo pedido", async () => {
    responses.push(
      { data: { ok: false, retryable: true, retryAfterMs: 53_000, error: "Limite de chamadas" }, error: null },
      { data: { ok: true, totalPages: 8 }, error: null },
    );
    const waits: number[] = [];
    const pending = invokeOlistCatalog({ action: "price_list_page", listId: "1872", page: 2 }, (s) => waits.push(s));
    await vi.advanceTimersByTimeAsync(54_000);
    expect(waits).toEqual([55]);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toMatchObject({ ok: true, totalPages: 8 });
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ action: "price_list_page", listId: "1872", page: 2 });
  });

  it("aguenta várias esperas seguidas (leitura longa) antes de desistir", async () => {
    for (let index = 0; index < 3; index += 1) {
      responses.push({ data: { ok: false, retryable: true, retryAfterMs: 50_000, error: "Limite" }, error: null });
    }
    responses.push({ data: { ok: true }, error: null });
    const pending = invokeOlistCatalog({ action: "catalog_page", page: 5 });
    await vi.advanceTimersByTimeAsync(3 * 52_000);
    await expect(pending).resolves.toMatchObject({ ok: true });
  });

  it("recusa da função (não é limite) não se repete", async () => {
    responses.push({ data: { ok: false, error: "Lista não lida nesta execução" }, error: null });
    await expect(invokeOlistCatalog({ action: "price_list_page" })).rejects.toThrow("Lista não lida");
    expect(calls).toHaveLength(1);
  });
});
