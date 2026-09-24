import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findExactOlistCost, normalizeSku, roundMoney, subscriberPriceFromCost } from "./olist.ts";

Deno.test("normaliza SKU sem remover pontuacao significativa", () => {
  assertEquals(normalizeSku("  ab-12.3 "), "AB-12.3");
});

Deno.test("seleciona somente o codigo exato e calcula centavos", () => {
  const result = findExactOlistCost({ retorno: { produtos: [
    { produto: { id: 1, codigo: "1234", nome: "outro", preco_custo: "99.00" } },
    { produto: { id: 2, codigo: "123", nome: "Racao", preco_custo: "100.555" } },
  ] } }, "123");
  assertEquals(result, { id: "2", sku: "123", name: "Racao", cost: 100.56 });
  assertEquals(roundMoney(result!.cost * 1.12), 112.63);
});

Deno.test("ignora produto sem custo positivo", () => {
  assertEquals(findExactOlistCost({ retorno: { produtos: [
    { produto: { id: 1, codigo: "123", preco_custo: "0" } },
  ] } }, "123"), null);
});

Deno.test("calcula preco de assinante com 12,5% sobre o custo", () => {
  assertEquals(subscriberPriceFromCost(100), 112.5);
  assertEquals(subscriberPriceFromCost(100.55), 113.12);
});
