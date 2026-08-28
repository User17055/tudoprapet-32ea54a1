import { beforeEach, describe, expect, it, vi } from "vitest";

// Continuacao do fix de 19/08/2026 (product_audience). Aquele commit avisava que
// existiam tres copias do mesmo `select` e que corrigir uma so deixaria as
// outras apodrecendo. Foi o que aconteceu: a paginacao ficou na audiencia e as
// tabelas de preco seguiram lendo so a primeira pagina do PostgREST.
//
// A leitura de franquia tinha um agravante proprio: era `const { data } = await`,
// sem olhar `error`. Uma falha transitoria devolvia `data` nulo, gravava lista
// VAZIA no cache do modulo e -- como `[]` e truthy -- ela ficava ali pelo resto
// da sessao. O franqueado via o preco da Shopify em vez do preco de franquia,
// sem nada no console.

const estado = vi.hoisted(() => ({
  total: 0,
  tabela: null as string | null,
  colunas: null as string | null,
  chamadas: [] as Array<{ from: number; to: number; ordenadoPor: string | null }>,
  erro: null as { message: string } | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabela: string) => {
      estado.tabela = tabela;
      return {
        select: (colunas: string) => {
          estado.colunas = colunas;
          // Devolve exatamente as colunas pedidas, com `numeric` como string --
          // que e o que o PostgREST faz de verdade.
          const nomes = colunas.split(",").map((c) => c.trim());
          let ordenadoPor: string | null = null;
          const builder = {
            order(coluna: string) {
              ordenadoPor = coluna;
              return builder;
            },
            range(from: number, to: number) {
              estado.chamadas.push({ from, to, ordenadoPor });
              if (estado.erro) return Promise.resolve({ data: null, error: estado.erro });
              const limite = Math.min(to - from + 1, 1000);
              const linhas = [];
              for (let i = from; i < Math.min(from + limite, estado.total); i++) {
                const linha: Record<string, unknown> = {};
                for (const nome of nomes) {
                  linha[nome] = nome.endsWith("_id")
                    ? `gid://shopify/ProductVariant/${i}`
                    : "19.90";
                }
                linhas.push(linha);
              }
              return Promise.resolve({ data: linhas, error: null });
            },
          };
          return builder;
        },
      };
    },
  },
}));

const { fetchAllFranchisePrices } = await import("@/hooks/useFranchisePrices");
const { fetchAllSubscriberPrices } = await import("@/hooks/useSubscriberPrices");

beforeEach(() => {
  estado.chamadas = [];
  estado.erro = null;
  estado.tabela = null;
  estado.colunas = null;
});

describe("fetchAllFranchisePrices", () => {
  it("le alem do teto de linhas do servidor", async () => {
    estado.total = 2500;

    const rows = await fetchAllFranchisePrices();

    // Sem paginacao isto voltaria 1000 e 1500 variantes exibiriam o preco da
    // Shopify para o franqueado.
    expect(rows).toHaveLength(2500);
    expect(estado.tabela).toBe("franchise_prices");
  });

  it("converte o preco para numero", async () => {
    estado.total = 1;

    const [row] = await fetchAllFranchisePrices();

    expect(row.price).toBe(19.9);
    expect(typeof row.price).toBe("number");
  });

  it("propaga o erro em vez de gravar lista vazia no cache", async () => {
    // O ponto do teste: falhar. Antes o erro era ignorado e o cache do modulo
    // ficava com `[]` pelo resto da sessao.
    estado.total = 2500;
    estado.erro = { message: "rede oscilando" };

    await expect(fetchAllFranchisePrices()).rejects.toBeDefined();
  });

  it("ordena por uma coluna estavel", async () => {
    estado.total = 1500;

    await fetchAllFranchisePrices();

    expect(estado.chamadas.every((c) => c.ordenadoPor === "shopify_variant_id")).toBe(true);
  });
});

describe("fetchAllSubscriberPrices", () => {
  it("le alem do teto de linhas do servidor", async () => {
    estado.total = 2500;

    const rows = await fetchAllSubscriberPrices();

    expect(rows).toHaveLength(2500);
    expect(estado.tabela).toBe("subscriber_prices");
  });

  it("converte o preco para numero", async () => {
    estado.total = 1;

    const [row] = await fetchAllSubscriberPrices();

    // Antes o valor cru do PostgREST ia direto para o cache: `subscriber_price`
    // chegava como string na tela.
    expect(row.subscriber_price).toBe(19.9);
    expect(typeof row.subscriber_price).toBe("number");
  });

  it("propaga o erro em vez de devolver lista curta", async () => {
    estado.total = 2500;
    estado.erro = { message: "boom" };

    await expect(fetchAllSubscriberPrices()).rejects.toBeDefined();
  });

  it("pede faixas contiguas e sem sobreposicao", async () => {
    estado.total = 3000;

    await fetchAllSubscriberPrices();

    expect(estado.chamadas.map((c) => [c.from, c.to])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [3000, 3999],
    ]);
  });
});
