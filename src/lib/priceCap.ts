// Espelho de supabase/functions/_shared/pricing.ts.
// src/test/priceCap.test.ts garante que os dois lados respondem igual.
//
// A regra NÃO barra nada. Cadastrar acima do preço da Shopify é permitido: a
// linha da variante no pedido só aceita desconto, então a diferença é cobrada
// numa linha de ajuste separada (buildPriceAdjustmentLine, no servidor). O
// total cobrado fica certo.
//
// O que esta função faz é identificar esse caso para a tela do admin avisar
// quem cadastrou -- o valor não vai sair como preço da variante, e o cliente
// enxerga a linha extra no pedido. É aviso, não impedimento.

/**
 * O valor cadastrado passa do preço da Shopify?
 *
 * Preço da Shopify ausente, não numérico ou <= 0 devolve `false`: sem uma
 * referência confiável não dá para afirmar nada sobre o cadastrado.
 */
export function exceedsShopifyPrice(configured: number, shopifyPrice: number): boolean {
  if (!Number.isFinite(configured) || configured <= 0) return false;
  if (!Number.isFinite(shopifyPrice) || shopifyPrice <= 0) return false;
  return configured > shopifyPrice;
}
