import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface SubscriberPrice {
  shopify_variant_id: string;
  subscriber_price: number;
}

let cachedPrices: SubscriberPrice[] | null = null;
let fetchPromise: Promise<SubscriberPrice[]> | null = null;

async function fetchPrices(): Promise<SubscriberPrice[]> {
  if (cachedPrices) return cachedPrices;
  if (fetchPromise) return fetchPromise;
  
  fetchPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('subscriber_prices')
        .select('shopify_variant_id, subscriber_price');
      if (error) throw error;
      cachedPrices = data || [];
      return cachedPrices;
    } finally {
      fetchPromise = null;
    }
  })();
  
  return fetchPromise;
}

export function useSubscriberPrices() {
  const [prices, setPrices] = useState<SubscriberPrice[]>(cachedPrices || []);
  const [loading, setLoading] = useState(!cachedPrices);

  useEffect(() => {
    fetchPrices()
      .then(setPrices)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const getSubscriberPrice = (variantId: string): number | null => {
    const found = prices.find(p => p.shopify_variant_id === variantId);
    return found ? found.subscriber_price : null;
  };

  return { prices, loading, getSubscriberPrice };
}
