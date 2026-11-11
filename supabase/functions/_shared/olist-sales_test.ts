import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  invoicesFromInvoiceEvent,
  isApprovedSituation,
  normalizeSituation,
  olistDateToIso,
  ordersFromSituationEvent,
  parseWebhookBody,
  retryDelayMinutes,
  toOlistDateTime,
} from "./olist-sales.ts";
import { getOlistInvoice, issueOlistInvoice } from "./olist.ts";

Deno.test("situacao da listagem e do webhook viram o mesmo valor", () => {
  assertEquals(normalizeSituation("Preparando envio"), "preparando envio");
  assertEquals(normalizeSituation("preparando_envio"), "preparando envio");
  assertEquals(normalizeSituation("  Não Entregue "), "nao entregue");
});

Deno.test("so pedido aprovado em diante entra na automacao", () => {
  for (const situation of ["Aprovado", "faturado", "pronto_envio", "Enviado", "Entregue", "Atendido"]) {
    assertEquals(isApprovedSituation(situation), true, situation);
  }
  for (const situation of ["Em aberto", "aberto", "Cancelado", "Dados incompletos", ""]) {
    assertEquals(isApprovedSituation(situation), false, situation);
  }
});

Deno.test("datas da Olist", () => {
  assertEquals(olistDateToIso("05/11/2026"), "2026-11-05");
  assertEquals(olistDateToIso("2026-11-05"), null);
  // 15:30 UTC = 12:30 em Brasília.
  assertEquals(toOlistDateTime(new Date("2026-11-11T15:30:05Z")), "11/11/2026 12:30:05");
});

Deno.test("retentativa cresce ate 6 horas", () => {
  assertEquals(retryDelayMinutes(1), 10);
  assertEquals(retryDelayMinutes(3), 40);
  assertEquals(retryDelayMinutes(20), 360);
});

Deno.test("le aviso em JSON ou formulario com o campo dados", () => {
  assertEquals(parseWebhookBody('{"evento":"envio_nota_fiscal"}')?.evento, "envio_nota_fiscal");
  const form = new URLSearchParams({ dados: '{"evento":"atualizacao_situacao_pedido"}' }).toString();
  assertEquals(parseWebhookBody(form)?.evento, "atualizacao_situacao_pedido");
  assertEquals(parseWebhookBody("lixo"), null);
});

Deno.test("extrai pedidos e notas dos avisos", () => {
  const orders = ordersFromSituationEvent({
    evento: "atualizacao_situacao_pedido",
    pedidos: [
      { id: 10, numero: 77, numero_ecommerce: "", situacao_atual: "aprovado" },
      { id: 11, numero: 78, numero_ecommerce: "#1235", situacao_atual: "enviado" },
    ],
  });
  assertEquals(orders, [
    { id: "10", number: "77", externalReference: "", situation: "aprovado" },
    { id: "11", number: "78", externalReference: "#1235", situation: "enviado" },
  ]);
  assertEquals(
    invoicesFromInvoiceEvent({ notas: [{ id: 900, pedido_id: 10 }, { id: 901 }] }),
    [{ id: "900", orderId: "10" }, { id: "901", orderId: null }],
  );
});

function stubOlist(responses: unknown[]) {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => {
    calls.push(String(url));
    return Promise.resolve(new Response(JSON.stringify(responses.shift()), { status: 200 }));
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = originalFetch) };
}

Deno.test("nota cancelada com chave de acesso nao conta como emitida", async () => {
  const stub = stubOlist([
    {
      retorno: {
        status: "OK",
        nota_fiscal: { id: 900, numero: "123", situacao: "3", chave_acesso: "3".repeat(44) },
      },
    },
  ]);
  try {
    const invoice = await getOlistInvoice("900", "token-test");
    assertEquals(invoice.issued, false);
    assertEquals(invoice.voided, true);
  } finally {
    stub.restore();
  }
});

Deno.test("nao tenta reemitir nota cancelada", async () => {
  const stub = stubOlist([
    { retorno: { status: "OK", nota_fiscal: { id: 900, numero: "123", situacao: "Cancelada" } } },
  ]);
  try {
    let message = "";
    try {
      await issueOlistInvoice({ id: "900", number: "123", issued: false }, "token-test");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assertEquals(message.includes("cancelada ou denegada"), true);
    assertEquals(stub.calls.some((url) => url.includes("nota.fiscal.emitir")), false);
  } finally {
    stub.restore();
  }
});
