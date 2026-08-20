import { beforeEach, describe, expect, it, vi } from "vitest";

// Por que este teste existe: ate 19/08/2026 a audiencia era lida com um
// `select()` sem paginacao. O PostgREST corta a resposta (1000 linhas por padrao
// no Supabase), entao todo produto alem da primeira pagina era lido como
// audiencia nula -- e audiencia nula e tratada como oculto, de proposito. O
// catalogo, a busca, a home e a pagina de produto perdiam itens em silencio:
// nenhum erro, nenhum log, so o cliente nao achando o que queria comprar.

const estado = vi.hoisted(() => ({
  total: 0,
  /** Teto de linhas por resposta, imitando o `max-rows` do PostgREST. */
  tetoDoServidor: 1000,
  chamadas: [] as Array<{ from: number; to: number; ordenadoPor: string | null }>,
  erro: null as { message: string } | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => {
        let ordenadoPor: string | null = null;
        const builder = {
          order(coluna: string) {
            ordenadoPor = coluna;
            return builder;
          },
          range(from: number, to: number) {
            estado.chamadas.push({ from, to, ordenadoPor });
            if (estado.erro) return Promise.resolve({ data: null, error: estado.erro });
            const pedido = to - from + 1;
            const limite = Math.min(pedido, estado.tetoDoServidor);
            const linhas = [];
            for (let i = from; i < Math.min(from + limite, estado.total); i++) {
              linhas.push({ shopify_product_id: `gid://shopify/Product/${i}`, audience: "ambos" });
            }
            return Promise.resolve({ data: linhas, error: null });
          },
        };
        return builder;
      },
    }),
  },
}));

const { fetchAllProductAudience } = await import("@/hooks/useProductAudience");

beforeEach(() => {
  estado.chamadas = [];
  estado.erro = null;
  estado.tetoDoServidor = 1000;
});

describe("fetchAllProductAudience", () => {
  it("reads past the server row cap instead of stopping at the first page", async () => {
    estado.total = 2500;

    const rows = await fetchAllProductAudience();

    // O numero que importa: sem paginacao isto voltaria 1000 e 1500 produtos
    // sumiriam da loja.
    expect(rows).toHaveLength(2500);
    expect(new Set(rows.map((row) => row.shopify_product_id)).size).toBe(2500);
  });

  it("stops as soon as a page comes back short", async () => {
    estado.total = 1200;

    const rows = await fetchAllProductAudience();

    expect(rows).toHaveLength(1200);
    // Duas paginas bastam: a segunda volta com 200 e encerra o laco.
    expect(estado.chamadas).toHaveLength(2);
  });

  it("does not paginate at all when everything fits in one page", async () => {
    estado.total = 42;

    const rows = await fetchAllProductAudience();

    expect(rows).toHaveLength(42);
    expect(estado.chamadas).toHaveLength(1);
  });

  it("orders by a stable column, or range pagination would skip rows", async () => {
    estado.total = 1500;

    await fetchAllProductAudience();

    // Sem ORDER BY estavel o Postgres pode devolver ordens diferentes entre as
    // paginas, e ai um produto e pulado -- some da loja exatamente como antes.
    expect(estado.chamadas.every((c) => c.ordenadoPor === "shopify_product_id")).toBe(true);
  });

  it("asks for contiguous, non-overlapping ranges", async () => {
    estado.total = 3000;

    await fetchAllProductAudience();

    expect(estado.chamadas.map((c) => [c.from, c.to])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
    ]);
  });

  it("propagates errors instead of silently returning a short list", async () => {
    estado.total = 2500;
    estado.erro = { message: "boom" };

    // Devolver lista curta seria pior que falhar: a loja ficaria sem produtos
    // sem ninguem entender por que.
    await expect(fetchAllProductAudience()).rejects.toBeDefined();
  });

  it("returns an empty list when the table is empty", async () => {
    estado.total = 0;

    await expect(fetchAllProductAudience()).resolves.toEqual([]);
  });
});
