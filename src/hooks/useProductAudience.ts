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

// O PostgREST limita o numero de linhas por resposta (1000 por padrao no
// Supabase). Ler sem paginar devolvia so a primeira pagina, e TODO produto alem
// dela era lido como audiencia nula -- que `isAudienceVisibleTo` trata como
// oculto, de proposito. O efeito era o catalogo, a busca, a home, o "comprar por
// pet" e a pagina de produto perderem itens em silencio: sem erro, sem aviso,
// sem nada no console. O fail-closed esta certo; quem estava errado era a leitura.
const AUDIENCE_PAGE_SIZE = 1000;
// 100 mil linhas. Guarda contra laco infinito se a paginacao vier quebrada.
const AUDIENCE_MAX_PAGES = 100;

/** Le a tabela inteira, pagina a pagina. Usada tambem pelas telas do admin. */
export async function fetchAllProductAudience(): Promise<AudienceRow[]> {
  const rows: AudienceRow[] = [];
  for (let page = 0; page < AUDIENCE_MAX_PAGES; page++) {
    const from = page * AUDIENCE_PAGE_SIZE;
    const { data, error } = await supabase
      .from("product_audience")
      .select("shopify_product_id, audience")
      // Ordem estavel e obrigatoria: sem ela o `range` pode repetir ou pular
      // linhas entre paginas, e o produto pulado some da loja.
      .order("shopify_product_id", { ascending: true })
      .range(from, from + AUDIENCE_PAGE_SIZE - 1);
    if (error) throw error;
    const lote = (data || []) as AudienceRow[];
    rows.push(...lote);
    if (lote.length < AUDIENCE_PAGE_SIZE) return rows;
  }
  // Truncar de novo aqui repetiria o bug original, entao pelo menos nao e em
  // silencio.
  console.error(
    `product_audience: leitura parou em ${rows.length} linhas (limite de seguranca de ${AUDIENCE_MAX_PAGES} paginas). Produtos podem sumir da loja.`,
  );
  return rows;
}

async function fetchAudience(): Promise<AudienceRow[]> {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  if (pending) return pending;
  pending = (async () => {
    try {
      const rows = await fetchAllProductAudience();
      cached = rows;
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
    // Nao zere o cache antes de ter o substituto na mao. Zerando primeiro, uma
    // falha transitoria -- troca de aba, rede oscilando, realtime disparando no
    // momento errado -- deixava `cached` nulo, e como audiencia ausente e
    // fail-closed, a loja inteira ficava sem produto ate alguem recarregar.
    // Buscar direto tambem evita o TTL, que e o ponto de um refresh.
    const rows = await fetchAllProductAudience();
    cached = rows;
    cachedAt = Date.now();
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
  // `refreshAudience` ja ignora o TTL e busca do servidor, entao zerar o cache
  // aqui so criaria a janela em que a loja fica sem audiencia nenhuma.
  void refreshAudience().catch(console.error);
}
