import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ProductAudience = "cliente" | "franquia" | "ambos";

interface AudienceRow {
  shopify_product_id: string;
  audience: ProductAudience;
}

let cached: AudienceRow[] | null = null;
let pending: Promise<AudienceRow[]> | null = null;

async function fetchAudience(): Promise<AudienceRow[]> {
  if (cached) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const { data } = await supabase
        .from("product_audience")
        .select("shopify_product_id, audience");
      cached = (data || []) as AudienceRow[];
      return cached;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

export function useProductAudience() {
  const [rows, setRows] = useState<AudienceRow[]>(cached || []);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    fetchAudience()
      .then(setRows)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const audienceMap = new Map(rows.map((r) => [r.shopify_product_id, r.audience]));

  const getAudience = (productId: string): ProductAudience | null =>
    audienceMap.get(productId) ?? null;

  const isVisibleTo = (productId: string, isFranchisee: boolean): boolean => {
    const a = getAudience(productId);
    if (!a) return false; // produto sem marcação não aparece
    if (a === "ambos") return true;
    return isFranchisee ? a === "franquia" : a === "cliente";
  };

  return { rows, loading, getAudience, isVisibleTo };
}

export function invalidateAudienceCache() {
  cached = null;
}
