import type { ShopifyProduct } from "@/lib/shopify";

export function isClientProductVisible(
  product: ShopifyProduct,
  blockedVariantIds: ReadonlySet<string> | null,
  isFranchisee: boolean,
) {
  if (isFranchisee) return true;
  if (!blockedVariantIds) return false;
  return product.node.variants.edges.some(({ node }) => !blockedVariantIds.has(node.id));
}
