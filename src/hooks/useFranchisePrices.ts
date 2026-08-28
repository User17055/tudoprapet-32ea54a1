import { useEffect, useState } from "react";
import { useIsFranchisee } from "@/hooks/useIsFranchisee";
import { fetchAllRows } from "@/lib/fetchAllRows";

interface FranchisePrice {
  shopify_variant_id: string;
  price: number;
}

let cached: FranchisePrice[] | null = null;
let pending: Promise<FranchisePrice[]> | null = null;

/** Le a tabela inteira, pagina a pagina. Usada tambem pela tela de Valores. */
export async function fetchAllFranchisePrices(): Promise<FranchisePrice[]> {
  const rows = await fetchAllRows<{ shopify_variant_id: string; price: number | string }>(
    "franchise_prices",
    "shopify_variant_id, price",
    { orderBy: "shopify_variant_id" },
  );
  return rows.map((r) => ({ shopify_variant_id: r.shopify_variant_id, price: Number(r.price) }));
}

async function fetchPrices(): Promise<FranchisePrice[]> {
  if (cached) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      // O erro precisa subir. Antes a leitura era `const { data } = await ...`,
      // sem olhar `error`: uma falha transitoria devolvia `data` nulo, gravava
      // lista VAZIA no cache e -- como `[]` e truthy -- ela ficava ali para
      // sempre. O franqueado passava a sessao inteira vendo o preco da Shopify
      // em vez do preco de franquia, sem nada no console. E o mesmo defeito que
      // o fix de 19/08 tratou em product_audience, que nao chegou ate aqui.
      cached = await fetchAllFranchisePrices();
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
