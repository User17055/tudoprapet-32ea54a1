import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shouldShowCustomerOrder } from "./customer-order-visibility.ts";

Deno.test("mostra pedido de franquia aprovado mesmo com pagamento pendente na Shopify", () => {
  assertEquals(
    shouldShowCustomerOrder({
      financialStatus: "pending",
      cancelled: false,
      linkedCustomerType: "franchise",
      linkedSessionStatus: "credit_approved",
    }),
    true,
  );
});

Deno.test("nao mostra pedido pendente sem vinculo aprovado da franquia", () => {
  assertEquals(shouldShowCustomerOrder({ financialStatus: "pending", cancelled: false }), false);
  assertEquals(
    shouldShowCustomerOrder({
      financialStatus: "pending",
      cancelled: false,
      linkedCustomerType: "common",
      linkedSessionStatus: "shopify_created",
    }),
    false,
  );
});

Deno.test("mantem pedidos pagos e esconde cancelados", () => {
  assertEquals(shouldShowCustomerOrder({ financialStatus: "paid", cancelled: false }), true);
  assertEquals(
    shouldShowCustomerOrder({
      financialStatus: "pending",
      cancelled: true,
      linkedCustomerType: "franchise",
      linkedSessionStatus: "credit_approved",
    }),
    false,
  );
});
