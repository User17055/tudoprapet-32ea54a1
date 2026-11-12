import { useSyncExternalStore } from "react";

// Itens que o checkout de franquia bloqueou por falta de custo (resposta
// `franchisePriceBlocked` de checkout-prepare, franchise-checkout e
// franchise-open-order). Um único aviso, montado no App, atende todos os
// pontos de compra.

export interface FranchisePriceBlockedItem {
  variantId: string;
  productId: string;
  title: string;
  reason: "missing_sku" | "not_found_in_olist" | "olist_unavailable";
  reviewStatus: string;
  canRequestReview: boolean;
  message: string;
}

let current: FranchisePriceBlockedItem[] = [];
const listeners = new Set<() => void>();

function emit(next: FranchisePriceBlockedItem[]) {
  current = next;
  for (const listener of listeners) listener();
}

/** Mostra o aviso se a resposta trouxer itens bloqueados. Retorna true nesse caso. */
export function handleFranchisePriceBlocked(response: unknown): boolean {
  const items = (response as { franchisePriceBlocked?: unknown } | null)?.franchisePriceBlocked;
  if (!Array.isArray(items) || items.length === 0) return false;
  emit(items as FranchisePriceBlockedItem[]);
  return true;
}

export function closeFranchisePriceBlocked() {
  emit([]);
}

export function useFranchisePriceBlocked(): FranchisePriceBlockedItem[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current,
  );
}
