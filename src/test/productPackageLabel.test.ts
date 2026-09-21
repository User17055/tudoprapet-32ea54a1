import { describe, expect, it } from "vitest";
import { productPackageLabel } from "@/lib/productPackageLabel";

describe("apresentação no card do produto", () => {
  it("mostra o peso mesmo sem grupo de variações", () => {
    expect(productPackageLabel("Default Title", "Ração Premier Nattu para Cães 1 Kg")).toBe("1 kg");
    expect(productPackageLabel("10.1 Kg")).toBe("10,1 kg");
  });

  it("prioriza o rótulo da variação selecionada", () => {
    expect(productPackageLabel("15 kg", "1 kg", "Ração 1 kg")).toBe("15 kg");
  });

  it("mantém a faixa de peso de produtos como Bravecto", () => {
    expect(productPackageLabel("Bravecto para cães 10 a 20 Kg")).toBe("10 a 20 kg");
  });

  it("não inventa um peso quando não foi informado", () => {
    expect(productPackageLabel("Ração Natural para Cães")).toBeNull();
  });
});
