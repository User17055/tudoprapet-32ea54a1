import { supabase } from "@/integrations/supabase/client";

export type CatalogResponse = {
  ok?: boolean;
  error?: string;
  retryable?: boolean;
  failed?: boolean;
  runId?: string;
  totalPages?: number;
  products?: number;
  lists?: number;
  exceptions?: number;
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/** Chama a função; limite da Olist cheio espera e tenta de novo (até ~2 min). */
export async function invokeOlistCatalog(body: Record<string, unknown>): Promise<CatalogResponse> {
  let lastError = "Falha de conexão com a função";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const { data, error } = await supabase.functions.invoke("admin-olist-catalog", { body });
      const response = data as CatalogResponse | null;
      if (!error && response?.ok) return response;
      lastError = response?.error || error?.message || lastError;
      if (response && !response.retryable && !error) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
    await wait(Math.min(20_000, 3_000 * (attempt + 1)));
  }
  throw new Error(lastError);
}
