import { useMemo } from "react";
import { useProductAudience } from "@/hooks/useProductAudience";
import { useClientSaleVisibility } from "@/hooks/useClientSaleVisibility";
import type { CartItem } from "@/stores/cartStore";

export type CartUnavailableReason = "hidden" | "out_of_stock";

export function useCartAvailability(items: CartItem[], isFranchisee: boolean) {
  const { loading: audienceLoading, isVisibleTo } = useProductAudience();
  const { loading: saleLoading, blockedVariantIds } = useClientSaleVisibility();
  const loading = audienceLoading || (!isFranchisee && saleLoading);

  return useMemo(() => {
    const unavailableReasons = new Map<string, CartUnavailableReason>();
    if (!loading) {
      for (const item of items) {
        const variant = item.product.node.variants.edges.find(
          ({ node }) => node.id === item.variantId,
        )?.node;
        if (!isVisibleTo(item.product.node.id, isFranchisee)
          || (!isFranchisee && (!blockedVariantIds || blockedVariantIds.has(item.variantId)))) {
          unavailableReasons.set(item.variantId, "hidden");
        } else if (!variant?.availableForSale) {
          unavailableReasons.set(item.variantId, "out_of_stock");
        }
      }
    }
    return {
      loading,
      unavailableReasons,
      availableItems: loading
        ? []
        : items.filter((item) => !unavailableReasons.has(item.variantId)),
      unavailableItems: loading
        ? []
        : items.filter((item) => unavailableReasons.has(item.variantId)),
    };
  }, [isFranchisee, isVisibleTo, items, loading, blockedVariantIds]);
}
