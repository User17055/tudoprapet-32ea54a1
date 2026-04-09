import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useShopifyAuth } from '@/contexts/ShopifyAuthContext';
import { supabase } from '@/integrations/supabase/client';

interface SubscriptionState {
  isSubscribed: boolean;
  subscriptionEnd: string | null;
  loading: boolean;
  subscriberPrices: Record<string, number>; // variantId -> price
}

interface SubscriptionContextType extends SubscriptionState {
  checkSubscription: () => Promise<void>;
  createCheckout: () => Promise<string | null>;
  openCustomerPortal: () => Promise<string | null>;
  getSubscriberPrice: (variantId: string) => number | null;
}

const SubscriptionContext = createContext<SubscriptionContextType | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { customer } = useShopifyAuth();
  const [state, setState] = useState<SubscriptionState>({
    isSubscribed: false,
    subscriptionEnd: null,
    loading: false,
    subscriberPrices: {},
  });

  // Load subscriber prices from Supabase
  const loadSubscriberPrices = useCallback(async () => {
    const { data } = await supabase.from('subscriber_prices').select('*');
    if (data) {
      const priceMap: Record<string, number> = {};
      data.forEach((row) => {
        priceMap[row.shopify_variant_id] = row.subscriber_price;
      });
      setState((s) => ({ ...s, subscriberPrices: priceMap }));
    }
  }, []);

  const checkSubscription = useCallback(async () => {
    if (!customer?.email) {
      setState((s) => ({ ...s, isSubscribed: false, subscriptionEnd: null, loading: false }));
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    try {
      const { data, error } = await supabase.functions.invoke('check-subscription', {
        body: { email: customer.email },
      });
      if (error) throw error;
      setState((s) => ({
        ...s,
        isSubscribed: data?.subscribed || false,
        subscriptionEnd: data?.subscription_end || null,
        loading: false,
      }));
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, [customer?.email]);

  const createCheckout = useCallback(async (): Promise<string | null> => {
    if (!customer?.email) return null;
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: {
          email: customer.email,
          customerName: `${customer.firstName} ${customer.lastName}`,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data?.url || null;
    } catch {
      return null;
    }
  }, [customer]);

  const openCustomerPortal = useCallback(async (): Promise<string | null> => {
    if (!customer?.email) return null;
    try {
      const { data, error } = await supabase.functions.invoke('customer-portal', {
        body: { email: customer.email },
      });
      if (error) throw error;
      return data?.url || null;
    } catch {
      return null;
    }
  }, [customer?.email]);

  const getSubscriberPrice = useCallback(
    (variantId: string): number | null => {
      return state.subscriberPrices[variantId] ?? null;
    },
    [state.subscriberPrices]
  );

  useEffect(() => {
    loadSubscriberPrices();
  }, [loadSubscriberPrices]);

  useEffect(() => {
    if (customer?.email) {
      checkSubscription();
    } else {
      setState((s) => ({ ...s, isSubscribed: false, subscriptionEnd: null }));
    }
  }, [customer?.email, checkSubscription]);

  return (
    <SubscriptionContext.Provider
      value={{ ...state, checkSubscription, createCheckout, openCustomerPortal, getSubscriberPrice }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider');
  return ctx;
}
