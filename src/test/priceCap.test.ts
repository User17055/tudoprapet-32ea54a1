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

describe("resolveSyncPrice", () => {
  // Por que este teste existe: entre 28/08 e 31/08/2026 a tela somava o valor
  // JÁ CADASTRADO ao máximo e nunca o descartava. Como o destino da escrita é o
  // preço público da Shopify, baixar um valor empurrava o valor antigo para o
  // catálogo, e apagar um valor empurrava o valor apagado.

  it("empurra o novo valor, não o que está sendo substituído", () => {
    // Shopify 135,60; cadastrado 570,00; admin digita 200,00.
    expect(client.resolveSyncPrice(135.6, 200)).toBe(200);
  });

  it("não empurra nada quando o valor é apagado", () => {
    // Campo esvaziado: a linha será removida, então não há valor a sincronizar.
    expect(client.resolveSyncPrice(135.6, undefined)).toBe(135.6);
  });

  it("preserva o campo que não foi editado", () => {
    expect(client.resolveSyncPrice(100, 150, 120)).toBe(150);
    expect(client.resolveSyncPrice(100, undefined, 120)).toBe(120);
  });

  it("mantém o preço da Shopify quando nenhum valor o supera", () => {
    expect(client.resolveSyncPrice(100, 80, 60)).toBe(100);
    expect(client.resolveSyncPrice(100)).toBe(100);
  });

  it("ignora valores inválidos em vez de zerar o catálogo", () => {
    expect(client.resolveSyncPrice(100, 0)).toBe(100);
    expect(client.resolveSyncPrice(100, -5)).toBe(100);
    expect(client.resolveSyncPrice(100, NaN)).toBe(100);
  });
});
