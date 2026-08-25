import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type CustomerPrice = { shopify_variant_id: string; price: number };

let cached: CustomerPrice[] | null = null;
let pending: Promise<CustomerPrice[]> | null = null;

// Mesmo defeito que tirou produtos da loja em 19/08/2026, agora na tabela de
// precos: o PostgREST corta a resposta (1000 linhas por padrao no Supabase) e um
// `select()` sem paginacao devolve so a primeira pagina. Aqui o efeito e outro,
// e igualmente silencioso -- toda variante alem da primeira pagina fica sem
// valor cadastrado e os consumidores caem no `?? shopifyPrice`, exibindo o preco
// da Shopify em vez do valor do cliente. Sem erro, sem log, sem aviso.
const CUSTOMER_PRICE_PAGE_SIZE = 1000;
// 100 mil linhas. Guarda contra laco infinito se a paginacao vier quebrada.
const CUSTOMER_PRICE_MAX_PAGES = 100;

/** Le a tabela inteira, pagina a pagina. */
export async function fetchAllCustomerPrices(): Promise<CustomerPrice[]> {
  const rows: CustomerPrice[] = [];
  for (let page = 0; page < CUSTOMER_PRICE_MAX_PAGES; page++) {
    const from = page * CUSTOMER_PRICE_PAGE_SIZE;
    const { data, error } = await supabase
      .from("customer_prices")
      .select("shopify_variant_id,price")
      // Ordem estavel e obrigatoria: sem ela o `range` pode repetir ou pular
      // linhas entre paginas, e a variante pulada perde o valor cadastrado.
      .order("shopify_variant_id", { ascending: true })
      .range(from, from + CUSTOMER_PRICE_PAGE_SIZE - 1);
    if (error) throw error;
    const lote = (data || []).map((row) => ({ ...row, price: Number(row.price) }));
    rows.push(...lote);
    if (lote.length < CUSTOMER_PRICE_PAGE_SIZE) return rows;
  }
  // Truncar de novo aqui repetiria o bug original, entao pelo menos nao e em
  // silencio.
  console.error(
    `customer_prices: leitura parou em ${rows.length} linhas (limite de seguranca de ${CUSTOMER_PRICE_MAX_PAGES} paginas). Variantes podem exibir o preco da Shopify em vez do valor do cliente.`,
  );
  return rows;
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
