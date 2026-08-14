import { describe, expect, it } from "vitest";
import {
  applyDeliveryPolicy,
  PRESIDENTE_PRUDENTE_LOCAL_FEE,
  PRESIDENTE_PRUDENTE_LOCAL_HANDLE,
} from "../../supabase/functions/_shared/shipping-policy";

const localOption = {
  handle: "shopify-local",
  code: "LOCAL",
  title: "Entrega local",
  description: "Motoboy",
  deliveryMethodType: "LOCAL",
  amount: 12,
  currencyCode: "BRL",
};

const carrierOption = {
  handle: "shopify-pac",
  code: "PAC",
  title: "PAC",
  description: "Correios",
  deliveryMethodType: "SHIPPING",
  amount: 24.9,
  currencyCode: "BRL",
};

describe("shipping policy", () => {
  it("offers the R$ 10 local delivery only in Presidente Prudente/SP", () => {
    const options = applyDeliveryPolicy(
      { city: "Presidente Prudente", provinceCode: "SP" },
      [localOption, carrierOption],
    );

    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({
      handle: PRESIDENTE_PRUDENTE_LOCAL_HANDLE,
      amount: PRESIDENTE_PRUDENTE_LOCAL_FEE,
      deliveryMethodType: "LOCAL",
    });
    expect(options[1]).toEqual(carrierOption);
  });

  it("removes local delivery for addresses outside Presidente Prudente", () => {
    expect(
      applyDeliveryPolicy(
        { city: "São Paulo", provinceCode: "SP" },
        [localOption, carrierOption],
      ),
    ).toEqual([carrierOption]);
  });

  it("returns no delivery option outside the city when only local delivery exists", () => {
    expect(
      applyDeliveryPolicy(
        { city: "Regente Feijó", provinceCode: "SP" },
        [localOption],
      ),
    ).toEqual([]);
  });
});
