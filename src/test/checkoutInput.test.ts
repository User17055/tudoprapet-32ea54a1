import { describe, expect, it } from "vitest";
import { parseCheckoutPrepareInput } from "../../supabase/functions/_shared/checkout-input.ts";

const valid = {
  items: [{ variantId: "gid://shopify/ProductVariant/123", quantity: 2 }],
  customer: {
    name: "Maria da Silva",
    email: "MARIA@EXEMPLO.COM",
    cpfCnpj: "529.982.247-25",
    mobilePhone: "(11) 99999-9999",
  },
  delivery: { code: "pick_up" },
  billingAddress: {
    address1: "Rua das Flores",
    number: "10",
    neighborhood: "Centro",
    city: "São Paulo",
    provinceCode: "SP",
    postalCode: "01001-000",
  },
};

describe("entrada do checkout próprio", () => {
  it("normaliza documento, telefone e e-mail", () => {
    const result = parseCheckoutPrepareInput(valid);
    expect(result.ok && result.value.customer).toMatchObject({
      email: "maria@exemplo.com",
      cpfCnpj: "52998224725",
      mobilePhone: "11999999999",
    });
  });

  it("exige endereço de faturamento inclusive na retirada", () => {
    const result = parseCheckoutPrepareInput({ ...valid, billingAddress: undefined });
    expect(result).toEqual({ ok: false, message: "Preencha o endereço de faturamento completo" });
  });

  it("rejeita documento com tamanho correto e dígitos verificadores inválidos", () => {
    const result = parseCheckoutPrepareInput({
      ...valid,
      customer: { ...valid.customer, cpfCnpj: "123.456.789-01" },
    });
    expect(result).toEqual({ ok: false, message: "Informe um CPF ou CNPJ válido" });
  });

  it("exige endereço completo para envio", () => {
    const result = parseCheckoutPrepareInput({ ...valid, delivery: { code: "pac" } });
    expect(result).toEqual({ ok: false, message: "Preencha o endereço de entrega completo" });
  });

  it("aceita endereço brasileiro completo", () => {
    const result = parseCheckoutPrepareInput({
      ...valid,
      delivery: {
        code: "sedex",
        optionHandle: "shopify-rate-sedex",
        address: {
          address1: "Rua das Flores",
          number: "10",
          neighborhood: "Centro",
          city: "São Paulo",
          provinceCode: "sp",
          postalCode: "01001-000",
        },
      },
    });
    expect(result.ok && result.value.delivery.address).toMatchObject({
      provinceCode: "SP",
      postalCode: "01001000",
    });
  });

  it("exige uma tarifa calculada para pedidos com envio", () => {
    const result = parseCheckoutPrepareInput({
      ...valid,
      delivery: {
        code: "shipping",
        address: {
          address1: "Rua das Flores", number: "10", neighborhood: "Centro",
          city: "São Paulo", provinceCode: "SP", postalCode: "01001000",
        },
      },
    });
    expect(result).toEqual({ ok: false, message: "Escolha uma modalidade de frete" });
  });

  it("aceita código de indicação opcional e o normaliza", () => {
    const withoutCode = parseCheckoutPrepareInput(valid);
    expect(withoutCode.ok && withoutCode.value.referralCode).toBeUndefined();
    const withCode = parseCheckoutPrepareInput({ ...valid, referralCode: "  maria10  " });
    expect(withCode.ok && withCode.value.referralCode).toBe("MARIA10");
    expect(parseCheckoutPrepareInput({ ...valid, referralCode: "cupom\ninválido" })).toEqual({
      ok: false, message: "Informe um código de indicação válido",
    });
  });
});
