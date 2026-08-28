import type { ShopifyProduct } from "@/lib/shopify";

export const isProductAvailable = (product: ShopifyProduct) =>
  product.node.variants.edges.some(({ node }) => node.availableForSale);

interface VariationProductReference {
  shopify_product_id: string;
}

/**
 * Escolhe o produto que representa um grupo na vitrine. Uma opção disponível
 * sempre tem prioridade; se todo o grupo estiver esgotado, mantém a primeira
 * opção visível para buscas que também exibem itens indisponíveis.
 */
export function selectVariationRepresentative(
  variations: VariationProductReference[],
  productsById: Map<string, ShopifyProduct>,
  visibleIds: Set<string>,
): string | null {
  const visible = variations.filter((item) => visibleIds.has(item.shopify_product_id));
  return visible.find((item) => {
    const product = productsById.get(item.shopify_product_id);
    return product ? isProductAvailable(product) : false;
  })?.shopify_product_id ?? visible[0]?.shopify_product_id ?? null;
}
