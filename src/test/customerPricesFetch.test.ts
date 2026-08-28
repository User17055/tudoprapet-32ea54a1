import { beforeEach, describe, expect, it, vi } from "vitest";

// Por que este teste existe: o mesmo defeito que tirou produtos da loja em
// 19/08/2026, agora na tabela de precos. O PostgREST corta a resposta (1000
// linhas por padrao no Supabase) e um `select()` sem paginacao devolve so a
// primeira pagina. Toda variante alem dela ficava sem valor cadastrado, e os
// consumidores caem no `?? shopifyPrice` -- a loja exibe o preco da Shopify em
// vez do valor do cliente. Nenhum erro, nenhum log, so o valor errado na tela.

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
              linhas.push({ shopify_variant_id: `gid://shopify/ProductVariant/${i}`, price: "19.90" });
            }
            return Promise.resolve({ data: linhas, error: null });
          },
        };
        return builder;
      },
    }),
  },
}));

const { fetchAllCustomerPrices } = await import("@/hooks/useCustomerPrices");

beforeEach(() => {
  estado.chamadas = [];
  estado.erro = null;
  estado.tetoDoServidor = 1000;
});

describe("fetchAllCustomerPrices", () => {
  it("le alem do teto de linhas do servidor em vez de parar na primeira pagina", async () => {
    estado.total = 2500;

    const rows = await fetchAllCustomerPrices();

    // O numero que importa: sem paginacao isto voltaria 1000 e 1500 variantes
    // passariam a exibir o preco da Shopify.
    expect(rows).toHaveLength(2500);
    expect(new Set(rows.map((row) => row.shopify_variant_id)).size).toBe(2500);
  });

  it("converte o preco para numero", async () => {
    estado.total = 1;

    const [row] = await fetchAllCustomerPrices();

    // O PostgREST devolve numeric como string; comparar string com numero
    // quebraria o teto de preco silenciosamente.
    expect(row.price).toBe(19.9);
    expect(typeof row.price).toBe("number");
  });

  it("para assim que uma pagina volta curta", async () => {
    estado.total = 1200;

    const rows = await fetchAllCustomerPrices();

    expect(rows).toHaveLength(1200);
    expect(estado.chamadas).toHaveLength(2);
  });

  it("nao pagina quando tudo cabe em uma pagina", async () => {
    estado.total = 42;

    const rows = await fetchAllCustomerPrices();

    expect(rows).toHaveLength(42);
    expect(estado.chamadas).toHaveLength(1);
  });

  it("ordena por uma coluna estavel, ou a paginacao pula linhas", async () => {
    estado.total = 1500;

    await fetchAllCustomerPrices();

    expect(estado.chamadas.every((c) => c.ordenadoPor === "shopify_variant_id")).toBe(true);
  });

  it("pede faixas contiguas e sem sobreposicao", async () => {
    estado.total = 3000;

    await fetchAllCustomerPrices();

    expect(estado.chamadas.map((c) => [c.from, c.to])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
    ]);
  });

  it("propaga o erro em vez de devolver lista curta em silencio", async () => {
    estado.total = 2500;
    estado.erro = { message: "boom" };

    await expect(fetchAllCustomerPrices()).rejects.toBeDefined();
  });

  it("devolve lista vazia quando a tabela esta vazia", async () => {
    estado.total = 0;

    await expect(fetchAllCustomerPrices()).resolves.toEqual([]);
  });
});
