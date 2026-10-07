import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { externalPaymentAttributes, externalPaymentTags } from "./shopify-payment.ts";

Deno.test("identifica Pix Asaas para a importação financeira da Olist", () => {
  assertEquals(externalPaymentAttributes("pix"), [
    { key: "payment_method", value: "pix" },
    { key: "meio_pagamento", value: "Pix" },
    { key: "payment_gateway", value: "Asaas" },
    { key: "provedor_pagamento", value: "Asaas" },
  ]);
  assertEquals(externalPaymentTags("pix"), ["pagamento-pix", "gateway-asaas"]);
});

Deno.test("não inventa forma de pagamento quando ela não foi escolhida", () => {
  assertEquals(externalPaymentAttributes("unknown"), []);
  assertEquals(externalPaymentTags("unknown"), []);
});
