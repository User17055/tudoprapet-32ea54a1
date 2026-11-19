// Pedido de franquia x automação "Emitir NFe ao aprovar o pedido" da Olist.
// Em 18/11/2026 o site criava o pedido já aprovado, a automação gerava a nota
// 1 s depois sem lançar contas e o "lançar contas" do pedido era recusado
// ("existe nota fiscal gerada"): o checkout falhava com o pedido criado.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildOlistFranchiseOrder,
  ensureOlistOrderApproved,
  ensureOlistOrderReceivable,
  findImportedTwinOrders,
  findOlistOrderByExternalReference,
  issueFranchiseInvoiceSafely,
  validOlistStateRegistration,
} from "./olist.ts";

function stubOlist(responses: unknown[]) {
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: new URLSearchParams(String(init?.body || "")) });
    const next = responses.shift();
    if (next === undefined) throw new Error(`chamada inesperada: ${url}`);
    return Promise.resolve(new Response(JSON.stringify(next), { status: 200 }));
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = originalFetch) };
}

const ok = { retorno: { status: "OK" } };
const noRecords = { retorno: { status: "Erro", codigo_erro: 20, erros: [{ erro: "sem registros" }] } };
const account77 = {
  retorno: { status: "OK", contas: [{ conta: { id: 77, situacao: "aberto", valor: "933.61", saldo: "933.61" } }] },
};
const order = (fields: Record<string, unknown>) => ({ retorno: { status: "OK", pedido: { id: 1, ...fields } } });
const called = (calls: Array<{ url: string; body: URLSearchParams }>, endpoint: string) =>
  calls.filter((call) => call.url.includes(endpoint));

const input = {
  externalReference: "1344",
  customer: {
    name: "Franquia Teste",
    stateRegistration: "562781000110",
    cpfCnpj: "12345678000199",
    email: "franquia@teste.com",
    phone: "18999999999",
    address: "Rua Teste",
    number: "10",
    neighborhood: "Centro",
    postalCode: "19000000",
    city: "Presidente Prudente",
    state: "SP",
  },
  items: [{ sku: "1000655", description: "Item", quantity: 1, unitPrice: 50 }],
  shippingAmount: 0,
  serviceFee: 0,
  total: 50,
  dueDate: "2026-12-10",
  invoicePurpose: "resale" as const,
};

Deno.test("pedido de franquia nasce em aberto (a aprovação vem depois da cobrança)", () => {
  const built = buildOlistFranchiseOrder(input) as { pedido: Record<string, unknown> };
  assertEquals(built.pedido.situacao, "aberto");
  assertEquals(String(built.pedido.obs).startsWith("Pedido de franquia TudoPraPet 1344"), true);
});

Deno.test("nota da automação sem conta: lança as contas pela nota", async () => {
  const stub = stubOlist([
    noRecords, // contas do pedido 729
    order({ id: 729, id_nota_fiscal: 530 }), // a nota já existe
    noRecords, // contas da nota 530
    ok, // nota.fiscal.lancar.contas
    account77, // contas da nota 530
  ]);
  try {
    const receivable = await ensureOlistOrderReceivable("729", "token-test");
    assertEquals(receivable.id, "77");
    const launched = called(stub.calls, "nota.fiscal.lancar.contas.php");
    assertEquals(launched.length, 1);
    assertEquals(launched[0].body.get("id"), "530");
    assertEquals(called(stub.calls, "pedido.lancar.contas.php").length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("nota gerada no meio do caminho (caso de 18/11): recupera pela nota", async () => {
  const stub = stubOlist([
    noRecords, // contas do pedido
    order({ id: 727, id_nota_fiscal: 0 }), // ainda sem nota
    {
      retorno: {
        status: "Erro",
        codigo_erro: 32,
        erros: [{ erro: "Não é possível lançar contas pois existe nota fiscal gerada para o pedido." }],
      },
    },
    order({ id: 727, id_nota_fiscal: 529 }), // a automação gerou a nota
    noRecords, // contas da nota 529
    ok, // nota.fiscal.lancar.contas
    account77,
  ]);
  try {
    const receivable = await ensureOlistOrderReceivable("727", "token-test");
    assertEquals(receivable.id, "77");
    assertEquals(called(stub.calls, "nota.fiscal.lancar.contas.php")[0].body.get("id"), "529");
  } finally {
    stub.restore();
  }
});

Deno.test("busca do pedido do site ignora a cópia importada da Shopify", async () => {
  const stub = stubOlist([
    {
      retorno: {
        status: "OK",
        pedidos: [
          { pedido: { id: 728, numero: 728, numero_ecommerce: "1343" } },
          { pedido: { id: 727, numero: 727, numero_ecommerce: "1343" } },
        ],
      },
    },
    order({ id: 728, obs: "", situacao: "Em aberto" }),
    order({ id: 727, obs: "Pedido de franquia TudoPraPet 1343 - NF-e: revenda", situacao: "Aprovado" }),
  ]);
  try {
    const found = await findOlistOrderByExternalReference("1343", "token-test");
    assertEquals(found?.id, "727");
    assertEquals(stub.calls[0].body.get("numeroEcommerce"), "1343");
  } finally {
    stub.restore();
  }
});

Deno.test("só a cópia importada não basta para reaproveitar: cria o pedido do site", async () => {
  const stub = stubOlist([
    { retorno: { status: "OK", pedidos: [{ pedido: { id: 728, numero: 728, numero_ecommerce: "1343" } }] } },
    order({ id: 728, obs: "", situacao: "Em aberto" }),
  ]);
  try {
    assertEquals(await findOlistOrderByExternalReference("1343", "token-test"), null);
  } finally {
    stub.restore();
  }
});

Deno.test("aprova só pedido em aberto", async () => {
  const open = stubOlist([order({ situacao: "Em aberto" }), ok]);
  try {
    assertEquals(await ensureOlistOrderApproved("731", "token-test"), true);
    const change = called(open.calls, "pedido.alterar.situacao.php");
    assertEquals(change.length, 1);
    assertEquals(change[0].body.get("situacao"), "aprovado");
    assertEquals(change[0].body.get("id"), "731");
  } finally {
    open.restore();
  }
  const approved = stubOlist([order({ situacao: "Preparando envio" })]);
  try {
    assertEquals(await ensureOlistOrderApproved("727", "token-test"), false);
    assertEquals(called(approved.calls, "pedido.alterar.situacao.php").length, 0);
  } finally {
    approved.restore();
  }
});

Deno.test("aprova e reaproveita a nota da automação em vez de gerar outra", async () => {
  const stub = stubOlist([
    order({ situacao: "Em aberto" }), // ensureOlistOrderApproved
    ok, // pedido.alterar.situacao
    order({ id_nota_fiscal: 600 }), // generateOlistInvoice: a automação já gerou
    { retorno: { status: "OK", nota_fiscal: { id: 600, numero: "000600", situacao: "Pendente" } } },
    { retorno: { status: "OK", nota_fiscal: { id: 600, numero: "000600", situacao: "Pendente" } } },
    { retorno: { status: "OK", nota_fiscal: { id: 600 } } }, // nota.fiscal.emitir
    {
      retorno: {
        status: "OK",
        nota_fiscal: { id: 600, numero: "000600", situacao: "Autorizada", chave_acesso: "3526", link_acesso: "https://x" },
      },
    },
  ]);
  try {
    const outcome = await issueFranchiseInvoiceSafely({
      orderId: "731",
      token: "token-test",
      savedInvoice: null,
      approveOrder: true,
      automationWaitMs: 0,
    });
    assertEquals(outcome.status, "issued");
    assertEquals(outcome.invoice?.id, "600");
    assertEquals(called(stub.calls, "gerar.nota.fiscal.pedido.php").length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("sem approveOrder (pedidos importados) a situação do pedido não muda", async () => {
  const stub = stubOlist([
    order({ id_nota_fiscal: 600 }),
    { retorno: { status: "OK", nota_fiscal: { id: 600, numero: "000600", situacao: "Autorizada", chave_acesso: "1", link_acesso: "https://x" } } },
    { retorno: { status: "OK", nota_fiscal: { id: 600, numero: "000600", situacao: "Autorizada", chave_acesso: "1", link_acesso: "https://x" } } },
  ]);
  try {
    const outcome = await issueFranchiseInvoiceSafely({ orderId: "800", token: "token-test", savedInvoice: null });
    assertEquals(outcome.status, "issued");
    assertEquals(called(stub.calls, "pedido.alterar.situacao.php").length, 0);
  } finally {
    stub.restore();
  }
});

const twinSearch = {
  retorno: {
    status: "OK",
    pedidos: [
      { pedido: { id: 727, numero: 727, numero_ecommerce: "1343" } },
      { pedido: { id: 728, numero: 728, numero_ecommerce: "1343" } },
    ],
  },
};

Deno.test("aponta a cópia importada sem cancelar quando o cancelamento está desligado", async () => {
  const stub = stubOlist([
    twinSearch,
    order({ id: 728, obs: "", situacao: "Em aberto", id_nota_fiscal: 0 }),
    noRecords, // contas do 728
  ]);
  try {
    const result = await findImportedTwinOrders("1343", "727", "token-test", false);
    assertEquals(result.twins.map((twin) => twin.number), ["728"]);
    assertEquals(result.cancelled, []);
    assertEquals(called(stub.calls, "pedido.alterar.situacao.php").length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("cancela a cópia importada quando ligado", async () => {
  const stub = stubOlist([
    twinSearch,
    order({ id: 728, obs: "", situacao: "Em aberto", id_nota_fiscal: 0 }),
    noRecords,
    ok,
  ]);
  try {
    const result = await findImportedTwinOrders("1343", "727", "token-test", true);
    assertEquals(result.cancelled, ["728"]);
    const change = called(stub.calls, "pedido.alterar.situacao.php")[0];
    assertEquals(change.body.get("id"), "728");
    assertEquals(change.body.get("situacao"), "cancelado");
  } finally {
    stub.restore();
  }
});

Deno.test("cópia com nota, com conta ou já andando nunca é cancelada", async () => {
  for (const twin of [
    { fields: { situacao: "Em aberto", id_nota_fiscal: 9 }, extra: [] },
    { fields: { situacao: "Aprovado", id_nota_fiscal: 0 }, extra: [] },
    { fields: { situacao: "Em aberto", id_nota_fiscal: 0 }, extra: [account77] },
  ]) {
    const stub = stubOlist([twinSearch, order({ id: 728, obs: "", ...twin.fields }), ...twin.extra]);
    try {
      const result = await findImportedTwinOrders("1343", "727", "token-test", true);
      assertEquals(result.twins, []);
      assertEquals(called(stub.calls, "pedido.alterar.situacao.php").length, 0);
    } finally {
      stub.restore();
    }
  }
});

Deno.test("IE de SP com tamanho errado não vai para a Olist", () => {
  assertEquals(validOlistStateRegistration("56278100011", "SP"), null);
  assertEquals(validOlistStateRegistration("562.781.000.110", "sp"), "562781000110");
  assertEquals(validOlistStateRegistration("0623079040081", "MG"), "0623079040081");
  assertEquals(validOlistStateRegistration("", "SP"), null);
  const built = buildOlistFranchiseOrder({
    ...input,
    customer: { ...input.customer, stateRegistration: "56278100011" },
  }) as { pedido: { cliente: Record<string, unknown> } };
  assertEquals("ie" in built.pedido.cliente, false);
});
