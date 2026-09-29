import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildOlistFranchiseOrder,
  buildOlistReceivable,
  findExactOlistCost,
  normalizeOlistId,
  normalizeSku,
  roundMoney,
  subscriberPriceFromCost,
} from "./olist.ts";

Deno.test("normaliza SKU sem remover pontuacao significativa", () => {
  assertEquals(normalizeSku("  ab-12.3 "), "AB-12.3");
});

Deno.test("nao trata o identificador zero da Olist como nota fiscal existente", () => {
  assertEquals(normalizeOlistId("0"), null);
  assertEquals(normalizeOlistId(0), null);
  assertEquals(normalizeOlistId("000"), null);
  assertEquals(normalizeOlistId(" 123 "), "123");
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
  assertEquals(order.pedido.itens[0].item.codigo, "RACAO-1");
  assertEquals(order.pedido.situacao, "aprovado");
  assertEquals(order.pedido.id_natureza_operacao, "12345");
  assertEquals(order.pedido.obs.includes("revenda"), true);
  assertEquals(order.pedido.parcelas[0].parcela.data, "02/10/2026");
  assertEquals(order.pedido.parcelas[0].parcela.valor, 62);
  const receivable = buildOlistReceivable(input, "ABC123456") as any;
  assertEquals(receivable.conta.valor, 62);
  assertEquals(receivable.conta.vencimento, "02/10/2026");
});
