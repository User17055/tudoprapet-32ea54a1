import { describe, expect, it } from "vitest";
import * as client from "../lib/priceCap";
import {
  buildDraftLineItems,
  capPricesToShopify,
  exceedsShopifyPrice,
} from "../../supabase/functions/_shared/pricing.ts";

// Por que este teste existe: em 25/08/2026 um valor cadastrado acima do preço da
// Shopify cobrava R$ 200,00 do cliente enquanto o pedido na Shopify registrava
// R$ 160,00. A causa é estrutural — o pedido na Shopify só sabe registrar
// DESCONTO, e a Shopify ignora `price` quando a linha traz `variant_id`. Não
// existe forma de o pedido refletir um valor maior que o preço nativo, então
// cobrar acima dele garante que os dois lados divergem.

const VARIANTE = "gid://shopify/ProductVariant/111";
const OUTRA = "gid://shopify/ProductVariant/222";

/** O que o pedido na Shopify vai registrar, dado o preço nativo e a linha montada. */
function registradoPelaShopify(line: Record<string, unknown>, precoShopify: number): number {
  const desconto = line.applied_discount as Record<string, unknown> | undefined;
  if (!desconto) return precoShopify;
  return Number((precoShopify - Number(desconto.value)).toFixed(2));
}

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

describe("capPricesToShopify", () => {
  it("limita o valor cadastrado ao preço da Shopify e relata o que limitou", () => {
    const { prices, capped } = capPricesToShopify(
      new Map([[VARIANTE, 200]]),
      new Map([[VARIANTE, 160]]),
    );

    expect(prices.get(VARIANTE)).toBe(160);
    expect(capped).toEqual([{ variantId: VARIANTE, configured: 200, shopifyPrice: 160 }]);
  });

  it("não toca no valor que já está abaixo", () => {
    const { prices, capped } = capPricesToShopify(
      new Map([[VARIANTE, 120]]),
      new Map([[VARIANTE, 160]]),
    );

    expect(prices.get(VARIANTE)).toBe(120);
    expect(capped).toEqual([]);
  });

  it("deixa passar a variante sem preço de referência", () => {
    // A Storefront API pode não devolver a variante (removida, sem publicação).
    // Inventar um teto aqui seria pior que não ter teto.
    const { prices, capped } = capPricesToShopify(
      new Map([[VARIANTE, 200]]),
      new Map([[OUTRA, 160]]),
    );

    expect(prices.get(VARIANTE)).toBe(200);
    expect(capped).toEqual([]);
  });

  it("não altera o mapa recebido", () => {
    const original = new Map([[VARIANTE, 200]]);
    capPricesToShopify(original, new Map([[VARIANTE, 160]]));
    expect(original.get(VARIANTE)).toBe(200);
  });

  it("preserva as demais variantes intactas", () => {
    const { prices } = capPricesToShopify(
      new Map([[VARIANTE, 200], [OUTRA, 50]]),
      new Map([[VARIANTE, 160], [OUTRA, 80]]),
    );

    expect(prices.get(VARIANTE)).toBe(160);
    expect(prices.get(OUTRA)).toBe(50);
  });
});

describe("invariante: o valor cobrado é o que o pedido na Shopify registra", () => {
  const casos: Array<{ nome: string; cadastrado?: number; shopify: number; esperado: number }> = [
    { nome: "o bug de 25/08: cadastrado acima do preço da Shopify", cadastrado: 200, shopify: 160, esperado: 160 },
    { nome: "desconto normal, cadastrado abaixo", cadastrado: 120, shopify: 160, esperado: 120 },
    { nome: "cadastrado igual ao preço da Shopify", cadastrado: 160, shopify: 160, esperado: 160 },
    { nome: "um centavo acima já divergia", cadastrado: 160.01, shopify: 160, esperado: 160 },
    { nome: "sem valor cadastrado", shopify: 160, esperado: 160 },
  ];

  for (const caso of casos) {
    it(caso.nome, () => {
      const configurado = new Map<string, number>();
      if (caso.cadastrado !== undefined) configurado.set(VARIANTE, caso.cadastrado);
      const precosShopify = new Map([[VARIANTE, caso.shopify]]);

      const { prices } = capPricesToShopify(configurado, precosShopify);
      const efetivo = prices.get(VARIANTE) ?? caso.shopify;

      const [linha] = buildDraftLineItems(
        [{ variantId: VARIANTE, quantity: 1 }],
        prices,
        precosShopify,
        "TudoPraPet",
      );

      expect(efetivo).toBe(caso.esperado);
      // O número que importa: o que o cliente paga tem de ser o que o pedido
      // documenta. Antes do teto, 200 cobrado contra 160 registrado.
      expect(registradoPelaShopify(linha, caso.shopify)).toBe(efetivo);
    });
  }

  it("vale também com quantidade maior que um", () => {
    const precosShopify = new Map([[VARIANTE, 160]]);
    const { prices } = capPricesToShopify(new Map([[VARIANTE, 200]]), precosShopify);

    const [linha] = buildDraftLineItems(
      [{ variantId: VARIANTE, quantity: 3 }],
      prices,
      precosShopify,
      "TudoPraPet",
    );

    const efetivo = prices.get(VARIANTE)!;
    expect(efetivo * 3).toBe(480);
    expect(registradoPelaShopify(linha, 160) * 3).toBe(480);
  });
});
