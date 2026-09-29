import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { franchiseFiscalError } from "./franchise-fiscal.ts";

const complete = {
  cnpj: "64017410000128",
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

Deno.test("consumo final permite não contribuinte", () => {
  assertEquals(franchiseFiscalError({ ...complete, state_registration: null, state_registration_indicator: "non_contributor" }, "final_consumption"), null);
});
