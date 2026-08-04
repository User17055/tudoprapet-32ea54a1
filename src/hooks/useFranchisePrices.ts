import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useIsFranchisee } from "@/hooks/useIsFranchisee";

interface FranchisePrice {
  shopify_variant_id: string;
  price: number;
}

let cached: FranchisePrice[] | null = null;
let pending: Promise<FranchisePrice[]> | null = null;

async function fetchPrices(): Promise<FranchisePrice[]> {
  if (cached) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const { data } = await supabase
        .from("franchise_prices")
        .select("shopify_variant_id, price");
      cached = ((data || []) as { shopify_variant_id: string; price: number }[]).map((r) => ({
        shopify_variant_id: r.shopify_variant_id,
        price: Number(r.price),
      }));
      return cached;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

export function invalidateFranchisePricesCache() {
  cached = null;
}

export function useFranchisePrices() {
  const { isFranchisee, loading: franchiseeLoading } = useIsFranchisee();
  const [prices, setPrices] = useState<FranchisePrice[]>(cached || []);
  const [pricesLoading, setPricesLoading] = useState(isFranchisee && !cached);

  useEffect(() => {
    if (franchiseeLoading) {
      return;
    }
    if (!isFranchisee) {
      setPrices([]);
      setPricesLoading(false);
      return;
    }
    setPricesLoading(!cached);
    fetchPrices()
      .then(setPrices)
      .catch(console.error)
      .finally(() => setPricesLoading(false));
  }, [franchiseeLoading, isFranchisee]);

  const getFranchisePrice = (variantId: string): number | null => {
    if (!isFranchisee) return null;
    const found = prices.find((p) => p.shopify_variant_id === variantId);
    return found ? found.price : null;
  };

  return {
    isFranchisee,
    prices,
    loading: franchiseeLoading || pricesLoading,
    getFranchisePrice,
  };
}
