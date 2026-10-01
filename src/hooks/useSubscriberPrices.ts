import { useEffect, useState } from 'react';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { supabase } from '@/integrations/supabase/client';

interface SubscriberPrice {
  shopify_variant_id: string;
  subscriber_price: number;
}

let cachedPrices: SubscriberPrice[] | null = null;
let fetchPromise: Promise<SubscriberPrice[]> | null = null;
let liveStarted = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(prices: SubscriberPrice[]) => void>();

/** Le a tabela inteira, pagina a pagina. Usada tambem pela tela de Valores. */
export async function fetchAllSubscriberPrices(): Promise<SubscriberPrice[]> {
  const rows = await fetchAllRows<{ shopify_variant_id: string; subscriber_price: number | string }>(
    'subscriber_prices',
    'shopify_variant_id, subscriber_price',
    { orderBy: 'shopify_variant_id' },
  );
  return rows.map((r) => ({
    shopify_variant_id: r.shopify_variant_id,
    subscriber_price: Number(r.subscriber_price),
  }));
}

async function fetchPrices(): Promise<SubscriberPrice[]> {
  if (cachedPrices) return cachedPrices;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      cachedPrices = await fetchAllSubscriberPrices();
      return cachedPrices;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

async function refreshPrices() {
  if (fetchPromise) return fetchPromise;
  fetchPromise = (async () => {
    try {
      cachedPrices = await fetchAllSubscriberPrices();
      for (const listener of listeners) listener(cachedPrices);
      return cachedPrices;
    } finally {
      fetchPromise = null;
    }
  })();
  return fetchPromise;
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { void refreshPrices().catch(console.error); }, 250);
}

function ensureLiveUpdates() {
  if (liveStarted || typeof window === 'undefined') return;
  liveStarted = true;
  supabase.channel('live-subscriber-prices')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'subscriber_prices' }, scheduleRefresh)
    .subscribe();
  window.addEventListener('focus', scheduleRefresh);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRefresh();
  });
}

export function useSubscriberPrices() {
  const [prices, setPrices] = useState<SubscriberPrice[]>(cachedPrices || []);
  const [loading, setLoading] = useState(!cachedPrices);

  useEffect(() => {
    ensureLiveUpdates();
    listeners.add(setPrices);
    fetchPrices()
      .then(setPrices)
      .catch(console.error)
      .finally(() => setLoading(false));
    return () => { listeners.delete(setPrices); };
  }, []);

  const getSubscriberPrice = (variantId: string): number | null => {
    const found = prices.find(p => p.shopify_variant_id === variantId);
    return found ? found.subscriber_price : null;
  };

  return { prices, loading, getSubscriberPrice };
}
