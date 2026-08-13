import type { ShopifyProduct } from "@/lib/shopify";

export const isProductAvailable = (product: ShopifyProduct) =>
  product.node.variants.edges.some(({ node }) => node.availableForSale);

