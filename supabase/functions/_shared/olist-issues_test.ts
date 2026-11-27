import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isTransientOlistError, needsAction, nextDailyRetry } from "./olist-issues.ts";
import { issueFranchiseInvoiceSafely } from "./olist.ts";

Deno.test("erros que só se resolvem com correção na Olist precisam de ação", () => {
  for (
    const message of [
      "Total do pedido Olist (39.04) diverge da Shopify (34.82)",
      "Não é possível lançar contas pois existe nota fiscal gerada para o pedido.",
      "Duplicidade: 2 contas a receber ativas para o pedido Olist 501 (77, 78).",
      "A NF-e 123 do pedido está cancelada ou denegada na Olist",
      "Não foi possível confirmar o cliente do pedido antes da baixa",
    ]
  ) assertEquals(needsAction(message), true, message);
});

Deno.test("falhas passageiras não precisam de ação", () => {
  for (
    const message of [
      "API Bloqueada - Excedido o número de acessos a API",
      "Limite de chamadas à API da Olist atingido; nova tentativa em 30 s",
      "Olist respondeu HTTP 503",
      "Tempo esgotado ao consultar a Olist",
      "Pedido pago ainda não foi importado da Shopify para a Olist",
    ]
  ) assertEquals(needsAction(message), false, message);
  assertEquals(isTransientOlistError("Olist respondeu HTTP 502"), true);
  assertEquals(isTransientOlistError("O CFOP informado em um dos itens está inválido"), false);
});

Deno.test("nova tentativa diária é 24 h depois", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  assertEquals(nextDailyRetry(now), "2026-11-14T12:00:00.000Z");
});

Deno.test("falha passageira na emissão fica pendente, não recusada", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("erro", { status: 503 }))) as typeof fetch;
  try {
    const outcome = await issueFranchiseInvoiceSafely({
      orderId: "501",
      token: "t",
      savedInvoice: { id: "900", number: "1", issued: false },
    });
    assertEquals(outcome.status, "pending");
    assertEquals(outcome.error, "Olist respondeu HTTP 503");
  } finally {
    globalThis.fetch = original;
  }
});
