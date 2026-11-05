import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Trava contra venda criada na Shopify com checkout de franquia falhando.
//
// Por que existe: em 03/11/2026 um produto sem custo fez o checkout falhar depois de concluir o
// pedido na Shopify. O franqueado viu erro, mas a venda ficou criada e a importacao da Olist
// trouxe um pedido em aberto, sem nota e com preco de loja.
//
// Regra: tudo que pode recusar a compra por dado do proprio carrinho roda antes de concluir na
// Shopify, porque essa etapa nao tem volta.
describe("checkout de franquia", () => {
  const source = readFileSync(
    join(process.cwd(), "supabase/functions/checkout-payment/index.ts"),
    "utf8",
  );

  it("confere o custo dos itens antes de concluir o pedido na Shopify", () => {
    const costCheck = source.indexOf("resolveFranchiseOrderItems(");
    const shopifyStage = source.indexOf('olistStage = "shopify"');
    expect(costCheck).toBeGreaterThan(-1);
    expect(shopifyStage).toBeGreaterThan(-1);
    expect(costCheck).toBeLessThan(shopifyStage);
  });
});
