import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  franchiseFiscalError,
  resolveFranchiseFiscalIdentity,
  validateFiscalSnapshot,
} from "./franchise-fiscal.ts";
import { buildOlistFranchiseOrder, buildOlistReceivable } from "./olist.ts";
import { shopifyAddress } from "./shopify-address.ts";
import { createFiscalDraftOrder } from "./shopify.ts";

const CNPJ = "64017410000128";
const CPF = "52998224725";
const complete = {
  name: "Maria da Silva",
  cpf: CPF,
  cnpj: CNPJ,
  company_legal_name: "Tudo Pra Pet LTDA",
  company_trade_name: "TudoPraPet",
  state_registration: "123456789",
  state_registration_indicator: "contributor",
};

Deno.test("aceita perfil fiscal contribuinte completo para revenda", () => {
  assertEquals(franchiseFiscalError(complete, "resale"), null);
});

Deno.test("revenda exige contribuinte e IE", () => {
  assertEquals(franchiseFiscalError({ ...complete, state_registration: null }, "resale")?.includes("inscrição estadual"), true);
  assertEquals(franchiseFiscalError({ ...complete, state_registration: null, state_registration_indicator: "exempt" }, "resale")?.includes("revenda"), true);
});

Deno.test("1. revenda envia CNPJ, razão social, contribuinte e IE", () => {
  const result = resolveFranchiseFiscalIdentity(complete, "resale");
  assertEquals(result.ok && result.identity, {
    documentType: "cnpj",
    cpfCnpj: CNPJ,
    name: "Tudo Pra Pet LTDA",
    legalName: "Tudo Pra Pet LTDA",
    tradeName: "TudoPraPet",
    stateRegistration: "123456789",
    stateRegistrationIndicator: "contributor",
  });
});

Deno.test("revenda nunca aceita CPF", () => {
  const result = resolveFranchiseFiscalIdentity({ ...complete, cnpj: null }, "resale");
  assertEquals(result.ok, false);
  assertEquals(validateFiscalSnapshot({ cpfCnpj: CPF, name: "Maria" }, "resale"), "Compras para revenda exigem CNPJ");
});

Deno.test("2. consumo final com CPF envia CPF, nome pessoal e nenhuma IE", () => {
  const result = resolveFranchiseFiscalIdentity(complete, "final_consumption");
  assertEquals(result.ok && result.identity, {
    documentType: "cpf",
    cpfCnpj: CPF,
    name: "Maria da Silva",
    legalName: "",
    tradeName: "",
    stateRegistration: "",
    stateRegistrationIndicator: "non_contributor",
  });
});

Deno.test("consumo final usa CNPJ quando só ele está cadastrado", () => {
  const result = resolveFranchiseFiscalIdentity({ ...complete, cpf: null }, "final_consumption");
  assertEquals(result.ok && result.identity.cpfCnpj, CNPJ);
});

Deno.test("CPF ou CNPJ com dígito inválido é recusado no servidor", () => {
  assertEquals(resolveFranchiseFiscalIdentity({ ...complete, cpf: "12345678901" }, "final_consumption").ok, false);
  assertEquals(resolveFranchiseFiscalIdentity({ ...complete, cnpj: "64017410000100" }, "resale").ok, false);
});

const address = {
  address1: "Rua das Flores", number: "10", neighborhood: "Centro",
  city: "São Paulo", provinceCode: "SP", postalCode: "01001000", countryCode: "BR" as const,
};

async function captureShopifyBodies(cpfCnpj: string, name: string) {
  const bodies: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    return new Response(JSON.stringify({ data: {} }), { status: 200 });
  }) as typeof fetch;
  try {
    await createFiscalDraftOrder({
      lineItems: [],
      email: "maria@exemplo.com",
      customerName: name,
      phone: "11999999999",
      cpfCnpj,
      shippingLine: { title: "Retirada", price: "0" },
      shippingAddress: shopifyAddress(address, name, "11999999999", cpfCnpj),
      billingAddress: shopifyAddress(address, name, "11999999999", cpfCnpj),
      tags: [],
      note: "teste",
      customAttributes: [],
    } as never, "token-teste").catch(() => null);
  } finally {
    globalThis.fetch = original;
  }
  return bodies.join("\n");
}

for (const purpose of ["resale", "final_consumption"] as const) {
  Deno.test(`3. Shopify, Olist e customer_snapshot recebem o mesmo documento (${purpose})`, async () => {
    const result = resolveFranchiseFiscalIdentity(complete, purpose);
    if (!result.ok) throw new Error(result.error);
    const browserCustomer = { name: "Outro", email: "maria@exemplo.com", cpfCnpj: "11144477735", mobilePhone: "11999999999" };
    const snapshot = { ...browserCustomer, ...result.identity };
    assertEquals(snapshot.cpfCnpj, result.identity.cpfCnpj);

    const olistCustomer = {
      name: snapshot.name, tradeName: snapshot.tradeName, stateRegistration: snapshot.stateRegistration,
      cpfCnpj: snapshot.cpfCnpj, email: snapshot.email, phone: snapshot.mobilePhone,
      address: "Rua das Flores", number: "10", neighborhood: "Centro", postalCode: "01001000",
      city: "São Paulo", state: "SP",
    };
    const olistInput = {
      customer: olistCustomer, items: [{ sku: "1", name: "Item", quantity: 1, price: 10 }],
      total: 10, dueDate: new Date(), externalReference: "x",
    } as never;
    const order = buildOlistFranchiseOrder(olistInput) as { pedido: { cliente: Record<string, string> } };
    const receivable = buildOlistReceivable(olistInput, "1") as { conta: { cliente: Record<string, string> } };
    assertEquals(order.pedido.cliente.cpf_cnpj, snapshot.cpfCnpj);
    assertEquals(receivable.conta.cliente.cpf_cnpj, snapshot.cpfCnpj);
    assertEquals(order.pedido.cliente.ie, purpose === "resale" ? "123456789" : undefined);

    const shopify = await captureShopifyBodies(snapshot.cpfCnpj, snapshot.name);
    assertEquals(shopify.includes(`"key":"CPF/CNPJ","value":"${snapshot.cpfCnpj}"`), true);
    assertEquals(shopify.includes("11144477735"), false);
  });
}

Deno.test("4. documento digitado no navegador não substitui o validado no servidor", () => {
  const result = resolveFranchiseFiscalIdentity(complete, "resale");
  if (!result.ok) throw new Error(result.error);
  // Mesma ordem usada no checkout-prepare: entrada do navegador primeiro, identidade por cima.
  const snapshot = { ...{ cpfCnpj: "11144477735", name: "Digitado" }, ...result.identity };
  assertEquals(snapshot.cpfCnpj, CNPJ);
  assertEquals(snapshot.name, "Tudo Pra Pet LTDA");
});
