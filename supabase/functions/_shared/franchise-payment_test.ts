import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  franchisePaymentDueDate,
  franchiseVariantsWithoutSnapshotCost,
  resolveFranchiseOrderItems,
} from "./franchise-payment.ts";

Deno.test("produto sem custo em lugar nenhum recusa a compra", () => {
  const items = [{ sku: "A1", variantId: "1", costUnitPrice: 0, productTitle: "Sem custo", quantity: 1 }];
  assertThrows(() => resolveFranchiseOrderItems(items, new Map()), Error, "Produto A1 sem custo para a NF-e");
});

Deno.test("custo do carrinho vale antes do custo atual", () => {
  const items = [{ sku: "A1", variantId: "1", costUnitPrice: 10, productTitle: "Racao", variantTitle: "1 kg", quantity: 2 }];
  assertEquals(resolveFranchiseOrderItems(items, new Map([["1", 99]])), [
    { sku: "A1", description: "Racao - 1 kg", quantity: 2, unitPrice: 10 },
  ]);
});

Deno.test("item sem custo no carrinho usa o custo atual", () => {
  const items = [
    { sku: "A1", variantId: "1", costUnitPrice: 0, productTitle: "Racao", quantity: 1 },
    { sku: "B2", variantId: "2", costUnitPrice: 5, productTitle: "Areia", quantity: 1 },
  ];
  assertEquals(franchiseVariantsWithoutSnapshotCost(items), ["1"]);
  assertEquals(resolveFranchiseOrderItems(items, new Map([["1", 7]]))[0].unitPrice, 7);
});

Deno.test("calcula prazo livre a partir da data do pedido", () => {
  assertEquals(franchisePaymentDueDate({
    createdAt: "2026-09-29T12:00:00-03:00",
    scheduleType: "days_after_order",
    termDays: 14,
  }), "2026-10-13");
});

Deno.test("dia fixo sempre cai no mes seguinte", () => {
  assertEquals(franchisePaymentDueDate({
    createdAt: "2026-09-05T12:00:00-03:00",
    scheduleType: "fixed_day_next_month",
    termDays: 7,
    dueDay: 10,
  }), "2026-10-10");
});

Deno.test("dia 31 e ajustado ao ultimo dia de mes curto", () => {
  assertEquals(franchisePaymentDueDate({
    createdAt: "2027-01-20T12:00:00-03:00",
    scheduleType: "fixed_day_next_month",
    termDays: 7,
    dueDay: 31,
  }), "2027-02-28");
});

