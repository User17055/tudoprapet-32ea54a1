import { describe, expect, it } from "vitest";
import * as client from "../lib/priceCap";
import { exceedsShopifyPrice } from "../../supabase/functions/_shared/pricing.ts";

// Por que este teste existe: em 25/08/2026 um valor cadastrado acima do preço da
// Shopify cobrava R$ 200,00 do cliente enquanto o pedido na Shopify registrava
// R$ 160,00. A linha da variante só aceita desconto, então o acréscimo precisa
// vir em outra linha — quem faz isso é buildPriceAdjustmentLine. A regra abaixo
// não corrige nada: ela só identifica o caso, e precisa responder igual nos dois
// lados, porque a tela do admin usa a cópia do frontend.

describe("regra do teto espelhada entre frontend e backend", () => {
  it("mantém a mesma resposta nos dois lados", () => {
    const valores = [0, -1, 0.01, 1, 99.9, 160, 160.01, 200, 1000.55, NaN, Infinity];
    for (const cadastrado of valores) {
      for (const shopify of valores) {
        expect(client.exceedsShopifyPrice(cadastrado, shopify))
          .toBe(exceedsShopifyPrice(cadastrado, shopify));
      }
    }
  });
});

describe("exceedsShopifyPrice", () => {
  it("acusa o valor cadastrado acima do preço da Shopify", () => {
    expect(exceedsShopifyPrice(200, 160)).toBe(true);
    expect(exceedsShopifyPrice(160.01, 160)).toBe(true);
  });

  it("aceita o valor igual ou abaixo", () => {
    expect(exceedsShopifyPrice(160, 160)).toBe(false);
    expect(exceedsShopifyPrice(99.9, 160)).toBe(false);
  });

  it("não acusa nada quando falta referência confiável", () => {
    // Sem preço da Shopify utilizável não dá para afirmar que o cadastrado está
    // errado — e baixar para zero seria dar o produto.
    expect(exceedsShopifyPrice(200, 0)).toBe(false);
    expect(exceedsShopifyPrice(200, NaN)).toBe(false);
    expect(exceedsShopifyPrice(200, -5)).toBe(false);
    expect(exceedsShopifyPrice(NaN, 160)).toBe(false);
    expect(exceedsShopifyPrice(0, 160)).toBe(false);
  });
});
