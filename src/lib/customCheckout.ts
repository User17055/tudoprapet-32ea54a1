import type { NavigateFunction } from "react-router-dom";

export const customCheckoutEnabled = import.meta.env.VITE_CUSTOM_CHECKOUT_ENABLED === "true";

export interface CheckoutLaunchItem {
  variantId: string;
  quantity: number;
  productTitle?: string;
  variantTitle?: string;
  imageUrl?: string | null;
  unitPrice?: number;
}

export function startCustomCheckout(
  navigate: NavigateFunction,
  items: CheckoutLaunchItem[],
  source: "cart" | "buy_now" | "open_order",
  openOrderId?: string,
) {
  sessionStorage.removeItem("tpp_checkout_active");
  sessionStorage.setItem("tpp_checkout_launch", JSON.stringify({ items, source, openOrderId }));
  navigate("/checkout");
}

export function readCheckoutLaunch(): { items: CheckoutLaunchItem[]; source: "cart" | "buy_now" | "open_order"; openOrderId?: string } | null {
  try {
    const raw = sessionStorage.getItem("tpp_checkout_launch");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.items) || !["cart", "buy_now", "open_order"].includes(parsed?.source)) return null;
    return parsed;
  } catch {
    return null;
  }
}
