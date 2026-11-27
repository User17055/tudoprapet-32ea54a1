import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchOlistPriceListExceptionsPage, OlistRateLimitError } from "./olist.ts";

// Leitura das listas de preço uma página por pedido (26/11/2026): a leitura
// inteira passava do limite por minuto dentro de um pedido só.

function withOlist(payloads: unknown[], run: (calls: URLSearchParams[]) => Promise<void>) {
  const previous = [Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")];
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  const original = globalThis.fetch;
  const calls: URLSearchParams[] = [];
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    calls.push(new URLSearchParams(String(init?.body ?? "")));
    return Promise.resolve(new Response(JSON.stringify(payloads[calls.length - 1])));
  }) as typeof fetch;
  return run(calls).finally(() => {
    globalThis.fetch = original;
    if (previous[0] !== undefined) Deno.env.set("SUPABASE_URL", previous[0]);
    if (previous[1] !== undefined) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", previous[1]);
  });
}

Deno.test("uma página de exceções faz uma chamada e devolve o total de páginas", () =>
  withOlist([{
    retorno: {
      status: "OK",
      numero_paginas: "8",
      registros: [
        { registro: { id_produto: "500", preco: "241.20", preco_promocional: "120.00" } },
        { registro: { id_produto: "501", preco: "10,50", preco_promocional: "" } },
      ],
    },
  }], async (calls) => {
    const page = await fetchOlistPriceListExceptionsPage("t", "1872", 3);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].get("idListaPreco"), "1872");
    assertEquals(calls[0].get("pagina"), "3");
    assertEquals(page.totalPages, 8);
    assertEquals(page.exceptions.map((entry) => entry.productId), ["500", "501"]);
    assertEquals(page.exceptions[0].promoPrice, 120);
  }));

Deno.test("lista sem exceções (Olist responde 'sem registros') termina sem erro", () =>
  withOlist([{
    retorno: { status: "Erro", codigo_erro: "20", erros: [{ erro: "A consulta não retornou registros" }] },
  }], async () => {
    const page = await fetchOlistPriceListExceptionsPage("t", "1871", 1);
    assertEquals(page.exceptions, []);
    assertEquals(page.totalPages, 0);
  }));

Deno.test("o erro de limite carrega quanto esperar", () => {
  assertEquals(new OlistRateLimitError(52_300).waitMs, 52_300);
  assertEquals(new OlistRateLimitError(52_300).message.includes("53 s"), true);
});
