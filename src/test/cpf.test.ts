import { describe, expect, it } from "vitest";
import { cnpjDigits, cpfDigits, isValidCnpj, isValidCpf, maskCnpj, maskCpf } from "@/lib/cpf";

describe("CPF", () => {
  it("formata e normaliza os 11 digitos", () => {
    expect(maskCpf("52998224725")).toBe("529.982.247-25");
    expect(cpfDigits("529.982.247-25")).toBe("52998224725");
  });

  it("aceita um CPF com digitos verificadores validos", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
  });

  it("rejeita CPF invalido, incompleto e com numeros repetidos", () => {
    expect(isValidCpf("123.456.789-01")).toBe(false);
    expect(isValidCpf("529.982.247-2")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
  });
});

describe("CNPJ", () => {
  it("formata, normaliza e valida os 14 dígitos", () => {
    expect(maskCnpj("04252011000110")).toBe("04.252.011/0001-10");
    expect(cnpjDigits("04.252.011/0001-10")).toBe("04252011000110");
    expect(isValidCnpj("04.252.011/0001-10")).toBe(true);
  });

  it("rejeita CNPJ inválido ou repetido", () => {
    expect(isValidCnpj("04.252.011/0001-11")).toBe(false);
    expect(isValidCnpj("11.111.111/1111-11")).toBe(false);
  });
});
