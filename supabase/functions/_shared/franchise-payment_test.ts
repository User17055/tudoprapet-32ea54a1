import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { franchisePaymentDueDate } from "./franchise-payment.ts";

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

