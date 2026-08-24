import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type CustomerPrice = { shopify_variant_id: string; price: number };

let cached: CustomerPrice[] | null = null;
let pending: Promise<CustomerPrice[]> | null = null;

const fetchPrices = () => {
  if (!pending) {
    pending = (async () => {
      const { data, error } = await supabase.from("customer_prices").select("shopify_variant_id,price");
      if (error) throw error;
      cached = (data || []).map((row) => ({ ...row, price: Number(row.price) }));
      return cached;
    })().finally(() => { pending = null; });
  }
  return pending;
};

/** Retorna o valor definido no sistema; null indica fallback para a Shopify. */
export function useCustomerPrices() {
  const [prices, setPrices] = useState<CustomerPrice[]>(cached || []);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let active = true;
    fetchPrices()
      .then((rows) => { if (active) setPrices(rows); })
      .catch((error) => console.error("Failed to load customer prices:", error))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const getCustomerPrice = (variantId: string): number | null =>
    prices.find((row) => row.shopify_variant_id === variantId)?.price ?? null;

  return { prices, loading, getCustomerPrice };
}
