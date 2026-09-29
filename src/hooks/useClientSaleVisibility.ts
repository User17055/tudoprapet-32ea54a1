import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllShopifyProducts } from "@/lib/shopify";

let cached: Set<string> | null = null;
let cachedAt = 0;
let pending: Promise<Set<string>> | null = null;
const listeners = new Set<(ids: Set<string>) => void>();
const CACHE_TTL_MS = 30_000;
// A Shopify responde de forma consistente em lotes de até 100 variantes. Um
// lote único maior fazia a Edge Function devolver 503 e, como a vitrine fecha
// sem verificação de margem, o catálogo inteiro desaparecia.
const VISIBILITY_BATCH_SIZE = 100;
let focusSyncStarted = false;

async function loadBlockedVariants() {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  if (pending) return pending;
  pending = (async () => {
    const products = await fetchAllShopifyProducts();
    const variants = products.flatMap(({ node }) => node.variants.edges.map(({ node: variant }) => variant.id));
    const blocked = new Set<string>();
    for (let start = 0; start < variants.length; start += VISIBILITY_BATCH_SIZE) {
      const batch = variants.slice(start, start + VISIBILITY_BATCH_SIZE);
      const { data, error } = await supabase.functions.invoke("client-sale-visibility", {
        body: { variantIds: batch },
      });
      if (error || !Array.isArray(data?.blockedVariantIds)) {
        // Falha fechada apenas para o lote afetado. Os outros produtos continuam
        // na loja, em vez de um erro isolado apagar todo o catálogo.
        console.error("Não foi possível verificar um lote de margens:", error);
        batch.forEach((id) => blocked.add(id));
        continue;
      }
      for (const id of data.blockedVariantIds as string[]) blocked.add(id);
    }
    cached = blocked;
    cachedAt = Date.now();
    listeners.forEach((listener) => listener(blocked));
    return blocked;
  })().finally(() => { pending = null; });
  return pending;
}

export function useClientSaleVisibility() {
  const [blockedVariantIds, setBlockedVariantIds] = useState<ReadonlySet<string> | null>(cached);
  const [loading, setLoading] = useState(!cached);
  useEffect(() => {
    listeners.add(setBlockedVariantIds);
    void loadBlockedVariants().catch((error) => {
      console.error("Não foi possível verificar a margem dos produtos:", error);
      // Sem a verificação, a vitrine de clientes permanece fechada.
      setBlockedVariantIds(null);
    }).finally(() => setLoading(false));
    if (!focusSyncStarted) {
      focusSyncStarted = true;
      window.addEventListener("focus", () => {
        cachedAt = 0;
        void loadBlockedVariants().catch(console.error);
      });
    }
    return () => { listeners.delete(setBlockedVariantIds); };
  }, []);
  return { blockedVariantIds, loading };
}
