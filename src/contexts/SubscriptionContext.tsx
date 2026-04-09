import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useShopifyAuth } from '@/contexts/ShopifyAuthContext';
import { supabase } from '@/integrations/supabase/client';

interface SubscriptionState {
  isSubscribed: boolean;
  loading: boolean;
}

interface SubscriptionContextType extends SubscriptionState {
  checkSubscription: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { customer } = useShopifyAuth();
  const [state, setState] = useState<SubscriptionState>({
    isSubscribed: false,
    loading: false,
  });

  const checkSubscription = useCallback(async () => {
    if (!customer?.email) {
      setState({ isSubscribed: false, loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    try {
      const { data, error } = await supabase.functions.invoke('check-subscription', {
        body: { email: customer.email },
      });
      if (error) throw error;
      setState({
        isSubscribed: data?.subscribed || false,
        loading: false,
      });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, [customer?.email]);

  useEffect(() => {
    if (customer?.email) {
      checkSubscription();
    } else {
      setState({ isSubscribed: false, loading: false });
    }
  }, [customer?.email, checkSubscription]);

  return (
    <SubscriptionContext.Provider value={{ ...state, checkSubscription }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider');
  return ctx;
}
