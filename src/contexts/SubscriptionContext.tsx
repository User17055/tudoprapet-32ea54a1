import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
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
  const { user } = useAuth();
  const [state, setState] = useState<SubscriptionState>({
    isSubscribed: false,
    loading: false,
  });

  const checkSubscription = useCallback(async () => {
    if (!user?.email) {
      setState({ isSubscribed: false, loading: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    try {
      const { data, error } = await supabase.functions.invoke('check-subscription', {
        body: { email: user.email },
      });
      if (error) throw error;
      setState({
        isSubscribed: data?.subscribed || false,
        loading: false,
      });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, [user?.email]);

  useEffect(() => {
    if (user?.email) {
      checkSubscription();
    } else {
      setState({ isSubscribed: false, loading: false });
    }
  }, [user?.email, checkSubscription]);

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
