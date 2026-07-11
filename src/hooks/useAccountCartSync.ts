import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import type { CartItem } from '@/stores/cartStore';
import { useCartStore } from '@/stores/cartStore';

const SAVE_DELAY_MS = 400;
const REFRESH_INTERVAL_MS = 5_000;

type SavedCart = {
  items: CartItem[];
  cartId: string | null;
  checkoutUrl: string | null;
  discountCode: string | null;
  hasAutoOpenedCart: boolean;
};

type AccountCartRow = {
  items: Json;
  cart_id: string | null;
  checkout_url: string | null;
  discount_code: string | null;
  has_auto_opened_cart: boolean;
};

function getSavedCart(): SavedCart {
  const state = useCartStore.getState();
  return {
    items: state.items,
    cartId: state.cartId,
    checkoutUrl: state.checkoutUrl,
    discountCode: state.discountCode,
    hasAutoOpenedCart: state.hasAutoOpenedCart,
  };
}

function signature(cart: SavedCart) {
  return JSON.stringify(cart);
}

function rowToCart(row: AccountCartRow): SavedCart {
  return {
    items: Array.isArray(row.items) ? row.items as unknown as CartItem[] : [],
    cartId: row.cart_id,
    checkoutUrl: row.checkout_url,
    discountCode: row.discount_code,
    hasAutoOpenedCart: row.has_auto_opened_cart,
  };
}

async function saveCart(userId: string, cart: SavedCart) {
  const { error } = await supabase.from('user_carts').upsert({
    user_id: userId,
    items: cart.items as unknown as Json,
    cart_id: cart.cartId,
    checkout_url: cart.checkoutUrl,
    discount_code: cart.discountCode,
    has_auto_opened_cart: cart.hasAutoOpenedCart,
  }, { onConflict: 'user_id' });

  if (error) console.error('Failed to save account cart:', error);
}

export function useAccountCartSync() {
  const { user, loading } = useAuth();
  const readyRef = useRef(false);
  const previousUserIdRef = useRef<string | null>(null);
  const lastSignatureRef = useRef('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (loading) return;

    let cancelled = false;
    readyRef.current = false;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

    const loadAccountCart = async () => {
      if (!user) {
        if (previousUserIdRef.current) useCartStore.getState().resetLocalCart();
        previousUserIdRef.current = null;
        lastSignatureRef.current = signature(getSavedCart());
        return;
      }

      const { data, error } = await supabase
        .from('user_carts')
        .select('items, cart_id, checkout_url, discount_code, has_auto_opened_cart')
        .eq('user_id', user.id)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error('Failed to load account cart:', error);
        return;
      }

      if (data) {
        useCartStore.getState().replaceCart(rowToCart(data));
      } else {
        await saveCart(user.id, getSavedCart());
        if (cancelled) return;
      }

      previousUserIdRef.current = user.id;
      lastSignatureRef.current = signature(getSavedCart());
      readyRef.current = true;
    };

    void loadAccountCart();
    return () => { cancelled = true; };
  }, [loading, user]);

  useEffect(() => {
    if (!user) return;

    const applyRemoteCart = (row: AccountCartRow) => {
      const state = useCartStore.getState();
      if (!readyRef.current || state.isLoading || state.isSyncing || saveTimerRef.current) return;

      const remoteCart = rowToCart(row);
      const remoteSignature = signature(remoteCart);
      if (remoteSignature === lastSignatureRef.current) return;

      lastSignatureRef.current = remoteSignature;
      useCartStore.getState().replaceCart(remoteCart);
    };

    const refreshFromAccount = async () => {
      if (!readyRef.current) return;
      const { data, error } = await supabase
        .from('user_carts')
        .select('items, cart_id, checkout_url, discount_code, has_auto_opened_cart')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        console.error('Failed to refresh account cart:', error);
        return;
      }
      if (!data) return;
      applyRemoteCart(data);
    };

    const unsubscribe = useCartStore.subscribe((state) => {
      if (!readyRef.current || state.isLoading || state.isSyncing) return;
      const cart: SavedCart = {
        items: state.items,
        cartId: state.cartId,
        checkoutUrl: state.checkoutUrl,
        discountCode: state.discountCode,
        hasAutoOpenedCart: state.hasAutoOpenedCart,
      };
      const nextSignature = signature(cart);
      if (nextSignature === lastSignatureRef.current) return;

      lastSignatureRef.current = nextSignature;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void saveCart(user.id, cart);
      }, SAVE_DELAY_MS);
    });

    const realtimeChannel = supabase
      .channel(`user-cart-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_carts', filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (payload.eventType !== 'DELETE') applyRemoteCart(payload.new as AccountCartRow);
        },
      )
      .subscribe();

    const refreshInterval = window.setInterval(() => { void refreshFromAccount(); }, REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', refreshFromAccount);
    window.addEventListener('pageshow', refreshFromAccount);
    window.addEventListener('focus', refreshFromAccount);
    window.addEventListener('online', refreshFromAccount);

    return () => {
      unsubscribe();
      void supabase.removeChannel(realtimeChannel);
      window.clearInterval(refreshInterval);
      document.removeEventListener('visibilitychange', refreshFromAccount);
      window.removeEventListener('pageshow', refreshFromAccount);
      window.removeEventListener('focus', refreshFromAccount);
      window.removeEventListener('online', refreshFromAccount);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [user]);
}
