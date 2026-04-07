import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { shopifyLogin, shopifyLogout, shopifyGetCustomer, shopifyRegister, type ShopifyCustomer } from '@/lib/shopify-auth';

interface AuthState {
  customer: ShopifyCustomer | null;
  token: string | null;
  loading: boolean;
}

interface ShopifyAuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (input: { firstName: string; lastName: string; email: string; password: string }) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const ShopifyAuthContext = createContext<ShopifyAuthContextType | null>(null);

const TOKEN_KEY = 'shopify_customer_token';

export function ShopifyAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ customer: null, token: null, loading: true });

  const loadCustomer = useCallback(async (token: string) => {
    try {
      const customer = await shopifyGetCustomer(token);
      if (customer) {
        setState({ customer, token, loading: false });
      } else {
        localStorage.removeItem(TOKEN_KEY);
        setState({ customer: null, token: null, loading: false });
      }
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setState({ customer: null, token: null, loading: false });
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(TOKEN_KEY);
    if (saved) {
      loadCustomer(saved);
    } else {
      setState(s => ({ ...s, loading: false }));
    }
  }, [loadCustomer]);

  const login = async (email: string, password: string) => {
    const result = await shopifyLogin(email, password);
    if ('error' in result) return { success: false, error: result.error };
    localStorage.setItem(TOKEN_KEY, result.token);
    await loadCustomer(result.token);
    return { success: true };
  };

  const register = async (input: { firstName: string; lastName: string; email: string; password: string }) => {
    const result = await shopifyRegister(input);
    if (!result.success) return { success: false, error: result.error };
    // Auto-login after register
    return login(input.email, input.password);
  };

  const logout = async () => {
    if (state.token) {
      try { await shopifyLogout(state.token); } catch { /* ignore */ }
    }
    localStorage.removeItem(TOKEN_KEY);
    setState({ customer: null, token: null, loading: false });
  };

  return (
    <ShopifyAuthContext.Provider value={{ ...state, login, register, logout }}>
      {children}
    </ShopifyAuthContext.Provider>
  );
}

export function useShopifyAuth() {
  const ctx = useContext(ShopifyAuthContext);
  if (!ctx) throw new Error('useShopifyAuth must be used within ShopifyAuthProvider');
  return ctx;
}
