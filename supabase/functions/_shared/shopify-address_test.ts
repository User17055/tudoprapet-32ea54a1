import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shopifyAddress } from "./shopify-address.ts";
import type { CheckoutAddressInput } from "./checkout-input.ts";

// Por que estes testes existem: em 11/09/2026 havia 73 pedidos parados no
// Omie.Hub, todos com "CPF ou CNPJ do cliente esta vazio ou invalido". O CPF
// estava no pedido da Shopify -- nos atributos e no campo localizado
// TAX_CREDENTIAL_BR -- e mesmo assim o Omie nao o via.
//
// O que destravou (medido no pedido #1169, à mão, sem mexer em mais nada):
// preencher o campo "Empresa" do endereço com os 11 dígitos. É de `company`
// que o Omie le o documento. Nao esta documentado em lugar nenhum.

const endereco: CheckoutAddressInput = {
  address1: "Avenida Manoel Goulart",
  number: "1499",
  address2: "Clinica",
  neighborhood: "Vila Santa Helena",
  city: "Presidente Prudente",
  provinceCode: "SP",
  postalCode: "19015241",
  countryCode: "BR",
};

const CPF = "22172999806";
const montado = () => shopifyAddress(endereco, "Maria Aparecida", "18997993603", CPF);

Deno.test("o CPF viaja em company -- e dali que o Omie le o documento", () => {
  assertEquals(montado().company, CPF);
});

Deno.test("CPF formatado vira so digitos: o Omie valida e recusa pontuacao", () => {
  const a = shopifyAddress(endereco, "Maria Aparecida", "18997993603", "221.729.998-06");
  assertEquals(a.company, "22172999806");
});

Deno.test("sem CPF, company fica ausente em vez de string vazia", () => {
  // `company: ""` seria pior que ausente: a Shopify grava o campo vazio e o
  // pedido passa a declarar um documento em branco.
  assertEquals(shopifyAddress(endereco, "Maria Aparecida", "18997993603", "").company, undefined);
});

Deno.test("o bairro NAO ocupa company -- esse campo tem dono", () => {
  // Regressao de uma tentativa anterior, no mesmo dia: o bairro chegou a ser
  // posto aqui antes de sabermos que `company` e o CPF. Se voltar, o Omie passa
  // a receber um bairro onde espera documento.
  const a = montado();
  assertEquals(a.company === endereco.neighborhood, false);
});

Deno.test("endereco continua chegando na Shopify como sempre chegou", () => {
  const a = montado();
  // Conferido contra o pedido #1169: e exatamente o que o proprio formulario
  // brasileiro da Shopify produz ao salvar os mesmos campos.
  assertEquals(a.address1, "Avenida Manoel Goulart, 1499");
  assertEquals(a.address2, "Clinica - Vila Santa Helena");
});

Deno.test("sem complemento, address2 carrega o bairro sozinho", () => {
  const a = shopifyAddress({ ...endereco, address2: undefined }, "Maria Aparecida", "18997993603", CPF);
  assertEquals(a.address2, "Vila Santa Helena");
});

Deno.test("nome com uma palavra so nao deixa last_name vazio", () => {
  const a = shopifyAddress(endereco, "Maria", "18997993603", CPF);
  assertEquals(a.first_name, "Maria");
  assertEquals(a.last_name, "Maria");
});

Deno.test("telefone sai com DDI", () => {
  assertEquals(montado().phone, "+5518997993603");
});
