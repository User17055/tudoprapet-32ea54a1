import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ProductAudience = "cliente" | "franquia" | "ambos";

export function isAudienceVisibleTo(
  audience: ProductAudience | null,
  isFranchisee: boolean,
): boolean {
  // Fail closed: an unconfigured product must never be rendered while
  // audience data is missing or incomplete.
  if (!audience) return false;
  if (audience === "ambos") return true;
  return isFranchisee ? audience === "franquia" : audience === "cliente";
}

interface AudienceRow {
  shopify_product_id: string;
  audience: ProductAudience;
}

let cached: AudienceRow[] | null = null;
let cachedAt = 0;
let pending: Promise<AudienceRow[]> | null = null;
let refreshing: Promise<AudienceRow[]> | null = null;
let syncStarted = false;
const CACHE_TTL_MS = 30_000;
const listeners = new Set<(rows: AudienceRow[]) => void>();

async function fetchAudience(): Promise<AudienceRow[]> {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const { data, error } = await supabase
        .from("product_audience")
        .select("shopify_product_id, audience");
      if (error) throw error;
      cached = (data || []) as AudienceRow[];
      cachedAt = Date.now();
      return cached;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

function refreshAudience(): Promise<AudienceRow[]> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (pending) await pending.catch(() => undefined);
    cached = null;
    cachedAt = 0;
    const rows = await fetchAudience();
    listeners.forEach((listener) => listener(rows));
    return rows;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

function ensureAudienceSync() {
  if (syncStarted || typeof window === "undefined") return;
  syncStarted = true;

  supabase
    .channel("product-audience-sync")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "product_audience" },
      () => void refreshAudience().catch(console.error),
    )
    .subscribe();

  window.addEventListener("focus", () => {
    void refreshAudience().catch(console.error);
  });
}

export function useProductAudience() {
  const [rows, setRows] = useState<AudienceRow[]>(cached || []);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    listeners.add(setRows);
    ensureAudienceSync();
    fetchAudience()
      .then(setRows)
      .catch(console.error)
      .finally(() => setLoading(false));
    return () => {
      listeners.delete(setRows);
    };
  }, []);

  const audienceMap = new Map(rows.map((r) => [r.shopify_product_id, r.audience]));

  const getAudience = (productId: string): ProductAudience | null =>
    audienceMap.get(productId) ?? null;

  const isVisibleTo = (productId: string, isFranchisee: boolean): boolean => {
    return isAudienceVisibleTo(getAudience(productId), isFranchisee);
  };

  return { rows, loading, getAudience, isVisibleTo };
}

export function invalidateAudienceCache() {
  cached = null;
  cachedAt = 0;
  void refreshAudience().catch(console.error);
}
