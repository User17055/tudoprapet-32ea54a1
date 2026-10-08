import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildOlistFranchiseOrder,
  buildOlistReceivable,
  findExactOlistCost,
  issueFranchiseInvoiceSafely,
  getOlistOrderReconciliationDetails,
  issueOlistInvoice,
  normalizeOlistId,
  normalizeSku,
  olistExternalReferenceMatches,
  roundMoney,
  settleOlistReceivable,
  subscriberPriceFromCost,
} from "./olist.ts";

Deno.test("normaliza SKU sem remover pontuacao significativa", () => {
  assertEquals(normalizeSku("  ab-12.3 "), "AB-12.3");
});

Deno.test("relaciona o numero Shopify com ou sem cerquilha", () => {
  assertEquals(olistExternalReferenceMatches("#1542", ["1542"]), true);
  assertEquals(olistExternalReferenceMatches("1542", ["#1542"]), true);
  assertEquals(olistExternalReferenceMatches("1542", ["1543"]), false);
});

Deno.test("nao trata o identificador zero da Olist como nota fiscal existente", () => {
  assertEquals(normalizeOlistId("0"), null);
  assertEquals(normalizeOlistId(0), null);
  assertEquals(normalizeOlistId("000"), null);
  assertEquals(normalizeOlistId(" 123 "), "123");
});

Deno.test("permite seguir com o pedido quando a emissao da nota foi aceita e segue pendente", async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    { retorno: { nota_fiscal: { id: 321, numero: 42, situacao: "Pendente" } } },
    { retorno: { status: "OK", nota_fiscal: { id: 321 } } },
    { retorno: { nota_fiscal: { id: 321, numero: 42, situacao: "Pendente" } } },
  ];
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )) as typeof fetch;

  try {
    const invoice = await issueOlistInvoice(
      { id: "321", number: "42", issued: false },
      "token-test",
    );
    assertEquals(invoice, {
      id: "321",
      number: "42",
      series: undefined,
      issued: false,
      accessKey: null,
      accessUrl: null,
    });
    assertEquals(responses.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("baixa conta Olist com valor, data e conta Asaas", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const responses = [
    { retorno: { status: "OK", conta: { id: 77, situacao: "aberto", valor: 50, saldo: 50 } } },
    { retorno: { status: "OK", registros: [{ registro: { status: "OK", id: 77 } }] } },
  ];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: new URLSearchParams(String(init?.body || "")) });
    return Promise.resolve(new Response(JSON.stringify(responses.shift()), { status: 200 }));
  }) as typeof fetch;

  try {
    await settleOlistReceivable("77", "token-test", {
      paidAt: new Date("2026-10-07T15:00:00-03:00"),
      amount: 50,
      destinationAccount: "Asaas",
      history: "Pagamento Pix confirmado",
    });
    assertEquals(calls.length, 2);
    assertEquals(calls[1].url.endsWith("conta.receber.baixar.php"), true);
    assertEquals(JSON.parse(calls[1].body.get("conta") || "{}"), {
      conta: {
        id: "77",
        data: "07/10/2026",
        valorPago: 50,
        contaDestino: "Asaas",
        historico: "Pagamento Pix confirmado",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("confere referencia, total e cliente no pedido completo da Olist", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          retorno: {
            pedido: {
              id: 501,
              numero: 156,
              numero_ecommerce: "#1042",
              total_pedido: "1106.99",
              cliente: {
                cpf_cnpj: "123.456.789-00",
                email: "CLIENTE@EXEMPLO.COM",
              },
              ecommerce: { nomeEcommerce: "Loja TudoPraPet" },
            },
          },
        }),
        { status: 200 },
      ),
    )) as typeof fetch;

  try {
    assertEquals(await getOlistOrderReconciliationDetails("501", "token-test"), {
      id: "501",
      number: "156",
      externalReference: "#1042",
      total: 1106.99,
      customerCpfCnpj: "12345678900",
      customerEmail: "cliente@exemplo.com",
      ecommerceName: "Loja TudoPraPet",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("seleciona somente o codigo exato e calcula centavos", () => {
  const result = findExactOlistCost({
    retorno: {
      produtos: [
        { produto: { id: 1, codigo: "1234", nome: "outro", preco_custo: "99.00" } },
        { produto: { id: 2, codigo: "123", nome: "Racao", preco_custo: "100.555" } },
      ],
    },
  }, "123");
  assertEquals(result, { id: "2", sku: "123", name: "Racao", cost: 100.56 });
  assertEquals(roundMoney(result!.cost * 1.12), 112.63);
});

Deno.test("ignora produto sem custo positivo", () => {
  assertEquals(
    findExactOlistCost({
      retorno: {
        produtos: [
          { produto: { id: 1, codigo: "123", preco_custo: "0" } },
        ],
      },
    }, "123"),
    null,
  );
});

Deno.test("calcula preco de assinante com 5% sobre o custo", () => {
  assertEquals(subscriberPriceFromCost(100), 105);
  assertEquals(subscriberPriceFromCost(100.55), 105.58);
});

Deno.test("pedido de franquia leva taxa e conta com vencimento integral", () => {
  const input = {
    externalReference: "12345678-1234-1234-1234-123456789012",
    customer: {
      name: "Franquia Teste",
      tradeName: "Franquia Teste Centro",
      stateRegistration: "123456789",
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
    items: [{ sku: "RACAO-1", description: "Racao", quantity: 2, unitPrice: 25 }],
    shippingAmount: 10,
    serviceFee: 2,
    total: 62,
    dueDate: "2026-10-02",
    invoicePurpose: "resale" as const,
    natureOperationId: "12345",
  };
  const order = buildOlistFranchiseOrder(input) as any;
  assertEquals(order.pedido.outras_despesas, 2);
  assertEquals(order.pedido.cliente.nome_fantasia, "Franquia Teste Centro");
  assertEquals(order.pedido.cliente.ie, "123456789");
  assertEquals(order.pedido.itens[0].item.codigo, "RACAO-1");
  assertEquals(order.pedido.situacao, "aprovado");
  assertEquals(order.pedido.id_natureza_operacao, "12345");
  assertEquals(order.pedido.obs.includes("revenda"), true);
  assertEquals(order.pedido.parcelas[0].parcela.data, "02/10/2026");
  assertEquals(order.pedido.parcelas[0].parcela.valor, 62);
  const receivable = buildOlistReceivable(input, "ABC123456") as any;
  assertEquals(receivable.conta.valor, 62);
  assertEquals(receivable.conta.cliente.ie, "123456789");
  assertEquals(receivable.conta.vencimento, "02/10/2026");
});

Deno.test("emissao aceita pela Olist mas pendente na SEFAZ nao interrompe o fluxo", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: Request | URL | string) => {
    const url = String(input);
    if (url.includes("nota.fiscal.emitir.php")) {
      return Promise.resolve(new Response(JSON.stringify({
        retorno: { status: "OK", nota_fiscal: { id: "555" } },
      })));
    }
    if (url.includes("nota.fiscal.obter.php")) {
      // Nota ainda sem chave de acesso: pendente na SEFAZ.
      return Promise.resolve(new Response(JSON.stringify({
        retorno: {
          status: "OK",
          nota_fiscal: { id: "555", numero: "000007", serie: "1", situacao: "pendente" },
        },
      })));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  };
  try {
    const result = await issueOlistInvoice(
      { id: "555", number: "000007", issued: false },
      "token-de-teste",
    );
    assertEquals(result.id, "555");
    assertEquals(result.issued, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("rejeicao fiscal da Olist vira alerta e nao interrompe o fluxo", async () => {
  const originalFetch = globalThis.fetch;
  let generateCalls = 0;
  globalThis.fetch = (input: Request | URL | string) => {
    const url = String(input);
    if (url.includes("gerar.nota.fiscal") || url.includes("nota.fiscal.gerar")) generateCalls++;
    if (url.includes("nota.fiscal.emitir.php")) {
      return Promise.resolve(new Response(JSON.stringify({
        retorno: {
          status: "Erro",
          erros: [{ erro: "O CFOP informado em um dos itens está inválido" }],
        },
      })));
    }
    if (url.includes("nota.fiscal.obter.php")) {
      return Promise.resolve(new Response(JSON.stringify({
        retorno: { status: "OK", nota_fiscal: { id: "777", numero: "000091", situacao: "pendente" } },
      })));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  };
  try {
    const outcome = await issueFranchiseInvoiceSafely({
      orderId: "156",
      savedInvoice: { id: "777", number: "000091", issued: false },
      token: "token-de-teste",
    });
    assertEquals(outcome.status, "rejected");
    assertEquals(outcome.invoice?.id, "777");
    assertEquals(Boolean(outcome.error), true);
    // Nota já salva: nunca gera uma segunda.
    assertEquals(generateCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
