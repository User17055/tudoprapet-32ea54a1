import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shopifyAddress } from "./shopify-address.ts";
import type { CheckoutAddressInput } from "./checkout-input.ts";

// Por que estes testes existem: em 11/09/2026 havia 73 pedidos parados no
// Omie.Hub sem nota fiscal emitida. Um dos motivos era "Bairro é obrigatório" --
// o bairro saía daqui grudado dentro de `address2` e nenhum campo do endereço
// o carregava sozinho. O caso abaixo é o pedido #1106 (Carolina Barletta),
// copiado do endereço real que travou.

const endereco: CheckoutAddressInput = {
  address1: "Rua Djalma Dutra",
  number: "280",
  address2: "Apto 1201",
  neighborhood: "Vila Ocidental",
  city: "Presidente Prudente",
  provinceCode: "SP",
  postalCode: "19015040",
  countryCode: "BR",
};

const montado = () => shopifyAddress(endereco, "Carolina Barletta", "18981215087");

Deno.test("bairro viaja em campo proprio, nao so dentro de address2", () => {
  assertEquals(montado().company, "Vila Ocidental");
});

Deno.test("o que ja chegava ao Omie continua igual -- a mudanca e acrescimo", () => {
  const a = montado();
  // Exatamente o que o pedido #1106 mostrava na Shopify antes da mudanca.
  assertEquals(a.address1, "Rua Djalma Dutra, 280");
  assertEquals(a.address2, "Apto 1201 - Vila Ocidental");
});

Deno.test("sem complemento, address2 fica so com o bairro e company continua preenchido", () => {
  const a = shopifyAddress({ ...endereco, address2: undefined }, "Carolina Barletta", "18981215087");
  assertEquals(a.address2, "Vila Ocidental");
  assertEquals(a.company, "Vila Ocidental");
});

Deno.test("bairro vazio nao vira string vazia em company", () => {
  // `company: ""` seria pior que ausente: a Shopify grava o campo vazio e o
  // Omie passa a ler um bairro em branco em vez de nao ler nada.
  const a = shopifyAddress({ ...endereco, neighborhood: "" }, "Carolina Barletta", "18981215087");
  assertEquals(a.company, undefined);
});

Deno.test("nome com uma palavra so nao deixa last_name vazio", () => {
  const a = shopifyAddress(endereco, "Carolina", "18981215087");
  assertEquals(a.first_name, "Carolina");
  assertEquals(a.last_name, "Carolina");
});

Deno.test("telefone sai com DDI", () => {
  assertEquals(montado().phone, "+5518981215087");
});
