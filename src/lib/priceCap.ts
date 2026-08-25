// Espelho de supabase/functions/_shared/pricing.ts (teto do valor cadastrado).
// O servidor é a fonte da verdade do valor cobrado; aqui a regra existe para
// barrar o cadastro errado na tela do admin, antes de virar dado.
// src/test/priceCap.test.ts garante que os dois lados concordam.
//
// Por que a regra existe: um pedido na Shopify só sabe registrar desconto. Um
// valor cadastrado acima do preço da Shopify não tem como aparecer no pedido,
// então o site cobra um número e o pedido documenta outro.

/**
 * O valor cadastrado passa do preço da Shopify?
 *
 * Preço da Shopify ausente, não numérico ou <= 0 devolve `false`: sem uma
 * referência confiável não dá para afirmar que o cadastrado está errado.
 */
export function exceedsShopifyPrice(configured: number, shopifyPrice: number): boolean {
  if (!Number.isFinite(configured) || configured <= 0) return false;
  if (!Number.isFinite(shopifyPrice) || shopifyPrice <= 0) return false;
  return configured > shopifyPrice;
}
