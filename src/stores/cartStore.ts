import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  CartItem,
  ShopifyProduct,
  createShopifyCart,
  addLineToShopifyCart,
  updateShopifyCartLine,
  removeLineFromShopifyCart,
  findShopifyCartLine,
  syncShopifyCart,
  applyDiscountToCart,
} from '@/lib/shopify';

export type { CartItem, ShopifyProduct };

interface CartStore {
  items: CartItem[];
  cartId: string | null;
  checkoutUrl: string | null;
  discountCode: string | null;
  isLoading: boolean;
  isSyncing: boolean;
  isCartOpen: boolean;
  hasAutoOpenedCart: boolean;
  addItem: (item: Omit<CartItem, 'lineId'>) => Promise<boolean>;
  updateQuantity: (variantId: string, quantity: number) => Promise<void>;
  removeItem: (variantId: string) => Promise<void>;
  clearCart: () => void;
  syncCart: () => Promise<void>;
  getCheckoutUrl: () => string | null;
  applyDiscount: (discountCode: string) => Promise<boolean>;
  removeDiscount: () => Promise<void>;
  setCartOpen: (open: boolean) => void;
  openCartOnFirstAdd: () => void;
  replaceCart: (cart: Pick<CartStore, 'items' | 'cartId' | 'checkoutUrl' | 'discountCode' | 'hasAutoOpenedCart'>) => void;
  resetLocalCart: () => void;
}

export const useCartStore = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],
      cartId: null,
      checkoutUrl: null,
      discountCode: null,
      isLoading: false,
      isSyncing: false,
      isCartOpen: false,
      hasAutoOpenedCart: false,
      setCartOpen: (open: boolean) => set({ isCartOpen: open }),
      openCartOnFirstAdd: () => {
        if (get().hasAutoOpenedCart) return;
        set({ isCartOpen: true, hasAutoOpenedCart: true });
      },
      replaceCart: (cart) => set({
        ...cart,
        isLoading: false,
        isSyncing: false,
        isCartOpen: false,
      }),
      resetLocalCart: () => set({
        items: [],
        cartId: null,
        checkoutUrl: null,
        discountCode: null,
        isLoading: false,
        isSyncing: false,
        isCartOpen: false,
        hasAutoOpenedCart: false,
      }),

      addItem: async (item) => {
        const { items, cartId, clearCart } = get();
        const existingItem = items.find(i => i.variantId === item.variantId);
        if (existingItem && !existingItem.lineId) return false;

        const optimisticItems: CartItem[] = existingItem
          ? items.map(i => i.variantId === item.variantId
            ? { ...i, quantity: i.quantity + item.quantity }
            : i)
          : [...items, { ...item, lineId: null }];

        set({ items: optimisticItems, isLoading: true });
        try {
          if (!cartId) {
            const result = await createShopifyCart({ ...item, lineId: null });
            if (result) {
              set({
                cartId: result.cartId,
                checkoutUrl: result.checkoutUrl,
                items: get().items.map(i => i.variantId === item.variantId
                  ? { ...i, lineId: result.lineId }
                  : i),
              });
              return true;
            }
            set({ items });
            return false;
          } else if (existingItem) {
            const newQuantity = existingItem.quantity + item.quantity;
            const result = await updateShopifyCartLine(cartId, existingItem.lineId, newQuantity);
            if (result.cartNotFound) {
              clearCart();
              return false;
            }
            if (!result.success) {
              set({ items });
              return false;
            }
            return true;
          } else {
            const result = await addLineToShopifyCart(cartId, { ...item, lineId: null });
            if (result.success) {
              set({ items: get().items.map(i => i.variantId === item.variantId
                ? { ...i, lineId: result.lineId ?? null }
                : i) });
              return true;
            }
            if (result.cartNotFound) clearCart();
            else set({ items });
            return false;
          }
        } catch (error) {
          console.error('Failed to add item:', error);
          set({ items });
          return false;
        } finally {
          set({ isLoading: false });
        }
      },

      updateQuantity: async (variantId, quantity) => {
        if (quantity <= 0) { await get().removeItem(variantId); return; }
        const { items, cartId, clearCart } = get();
        const item = items.find(i => i.variantId === variantId);
        if (!item?.lineId || !cartId) return;

        set({
          items: items.map(i => i.variantId === variantId ? { ...i, quantity } : i),
          isLoading: true,
        });
        try {
          const result = await updateShopifyCartLine(cartId, item.lineId, quantity);
          if (result.cartNotFound) clearCart();
          else if (!result.success) set({ items });
        } catch (error) {
          console.error('Failed to update quantity:', error);
          set({ items });
        } finally {
          set({ isLoading: false });
        }
      },

      removeItem: async (variantId) => {
        const { items, cartId, clearCart } = get();
        const item = items.find(i => i.variantId === variantId);
        if (!item) return;

        const remainingItems = items.filter(i => i.variantId !== variantId);
        set({ items: remainingItems, isLoading: true });
        try {
          if (!cartId) {
            if (remainingItems.length === 0) clearCart();
            return;
          }

          let lineId = item.lineId;
          if (!lineId) {
            const resolved = await findShopifyCartLine(cartId, variantId);
            if (!resolved) {
              set({ items });
              return;
            }
            if (resolved.cartNotFound) {
              clearCart();
              return;
            }
            lineId = resolved.lineId;
          }

          // Se a linha já não existe na Shopify, a remoção local está correta.
          if (!lineId) {
            if (remainingItems.length === 0) clearCart();
            return;
          }

          let result = await removeLineFromShopifyCart(cartId, lineId);

          // Carrinhos antigos podem guardar um lineId obsoleto. Resolve pelo
          // variantId atual e repete a remoção uma vez com o identificador certo.
          if (!result.success && !result.cartNotFound) {
            const resolved = await findShopifyCartLine(cartId, variantId);
            if (!resolved) {
              set({ items });
              return;
            }
            if (resolved.cartNotFound) {
              clearCart();
              return;
            }
            if (!resolved.lineId) {
              if (remainingItems.length === 0) clearCart();
              return;
            }
            if (resolved.lineId !== lineId) {
              result = await removeLineFromShopifyCart(cartId, resolved.lineId);
            }
          }

          if (result.success && remainingItems.length === 0) clearCart();
          else if (result.cartNotFound) clearCart();
          else if (!result.success) set({ items });
        } catch (error) {
          console.error('Failed to remove item:', error);
          set({ items });
        } finally {
          set({ isLoading: false });
        }
      },

      clearCart: () => set({ items: [], cartId: null, checkoutUrl: null, discountCode: null, hasAutoOpenedCart: false }),
      getCheckoutUrl: () => get().checkoutUrl,

      applyDiscount: async (discountCode: string) => {
        const { cartId } = get();
        if (!cartId) return false;
        const result = await applyDiscountToCart(cartId, discountCode);
        if (result.success && result.applicable) {
          set({ discountCode });
          return true;
        }
        // Código inválido fica pendurado no carrinho Shopify; remove para não aparecer no checkout
        if (result.success) await applyDiscountToCart(cartId, null);
        return false;
      },

      removeDiscount: async () => {
        const { cartId } = get();
        if (cartId) await applyDiscountToCart(cartId, null);
        set({ discountCode: null });
      },

      syncCart: async () => {
        const { cartId, isSyncing, clearCart } = get();
        if (!cartId || isSyncing) return;
        set({ isSyncing: true });
        try {
          const hasItems = await syncShopifyCart(cartId);
          if (!hasItems) clearCart();
        } catch (error) {
          console.error('Failed to sync cart:', error);
        } finally {
          set({ isSyncing: false });
        }
      },
    }),
    {
      name: 'shopify-cart',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        items: state.items,
        cartId: state.cartId,
        checkoutUrl: state.checkoutUrl,
        discountCode: state.discountCode,
        hasAutoOpenedCart: state.hasAutoOpenedCart,
      }),
    }
  )
);
