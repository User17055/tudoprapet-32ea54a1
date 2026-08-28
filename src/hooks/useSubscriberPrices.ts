import { useEffect, useState } from 'react';
import { fetchAllRows } from '@/lib/fetchAllRows';

interface SubscriberPrice {
  shopify_variant_id: string;
  subscriber_price: number;
}

let cachedPrices: SubscriberPrice[] | null = null;
let fetchPromise: Promise<SubscriberPrice[]> | null = null;

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
