import { useEffect, useState } from "react";
import { fetchAllRows } from "@/lib/fetchAllRows";

type CustomerPrice = { shopify_variant_id: string; price: number };

let cached: CustomerPrice[] | null = null;
let pending: Promise<CustomerPrice[]> | null = null;

// Mesmo defeito que tirou produtos da loja em 19/08/2026, agora na tabela de
// precos: o PostgREST corta a resposta (1000 linhas por padrao no Supabase) e um
// `select()` sem paginacao devolve so a primeira pagina. Aqui o efeito e outro,
// e igualmente silencioso -- toda variante alem da primeira pagina fica sem
// valor cadastrado e os consumidores caem no `?? shopifyPrice`, exibindo o preco
// da Shopify em vez do valor do cliente. Sem erro, sem log, sem aviso.

/** Le a tabela inteira, pagina a pagina. Usada tambem pela tela de Valores. */
export async function fetchAllCustomerPrices(): Promise<CustomerPrice[]> {
  const rows = await fetchAllRows<{ shopify_variant_id: string; price: number | string }>(
    "customer_prices",
    "shopify_variant_id,price",
    { orderBy: "shopify_variant_id" },
  );
  // O PostgREST devolve `numeric` como string; comparar string com numero
  // quebraria o teto de preco em silencio.
  return rows.map((row) => ({ ...row, price: Number(row.price) }));
}

const fetchPrices = () => {
  if (!pending) {
    pending = (async () => {
      cached = await fetchAllCustomerPrices();
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
