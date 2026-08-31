// Espelho de supabase/functions/_shared/pricing.ts.
// src/test/priceCap.test.ts garante que os dois lados respondem igual.
//
// A regra NÃO barra nada. Cadastrar acima do preço da Shopify é permitido.
//
// Desde 28/08/2026 a tela de Valores responde a esse caso sincronizando o
// preço-base na Shopify (edge function admin-variant-price), para que o pedido
// mantenha a variante. A linha de ajuste do servidor
// (buildPriceAdjustmentLine) continua existindo como rede: ela cobre o pedido
// que nascer antes da sincronização, e aí o total cobrado fica certo com a
// diferença numa linha à parte, visível para o cliente.
//
// `exceedsShopifyPrice` identifica o caso; `resolveSyncPrice` decide o valor.

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

/**
 * Preço-base que a variante precisa ter na Shopify depois de salvar.
 *
 * Recebe os valores que VÃO EXISTIR, não os que existem hoje. `undefined`
 * significa "não haverá valor cadastrado nessa tabela", e por isso não entra na
 * conta. Esse contrato é a correção de um defeito real: a versão anterior
 * partia do valor atual e nunca o descartava, então **baixar** um valor de
 * R$ 570 para R$ 200 ainda sincronizava R$ 570, e **apagar** o valor
 * sincronizava o valor apagado. O destino da escrita é o preço público do
 * catálogo, então o erro saía da tela e ia para a loja.
 */
export function resolveSyncPrice(
  shopifyPrice: number,
  customerAfter?: number,
  franchiseAfter?: number,
): number {
  const positivo = (value?: number) =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
  return Math.max(positivo(shopifyPrice), positivo(customerAfter), positivo(franchiseAfter));
}
