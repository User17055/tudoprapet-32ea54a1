import { supabase } from "@/integrations/supabase/client";

export type CatalogResponse = {
  ok?: boolean;
  error?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  failed?: boolean;
  runId?: string;
  totalPages?: number;
  products?: number;
  lists?: number;
  priceLists?: Array<{ id: string; name: string }>;
  exceptions?: number;
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

// A leitura inteira (~23 chamadas) passa do limite por minuto que as
// automações podem usar; esperar o tempo devolvido é o caminho normal.
const MAX_LIMIT_WAITS = 8;
const MAX_FAILURES = 4;

/**
 * Chama a função. Limite da Olist cheio: espera o tempo que a função devolve
 * (avisando `onWait` com os segundos) e repete só este pedido. Recusa da
 * função (dado inválido, erro de banco) não se repete.
 */
export async function invokeOlistCatalog(
  body: Record<string, unknown>,
  onWait?: (seconds: number) => void,
): Promise<CatalogResponse> {
  let lastError = "Falha de conexão com a função";
  let limitWaits = 0;
  let failures = 0;
  for (;;) {
    let response: CatalogResponse | null = null;
    let transportFailed = false;
    try {
      const result = await supabase.functions.invoke("admin-olist-catalog", { body });
      response = result.data as CatalogResponse | null;
      if (!result.error && response?.ok) return response;
      lastError = response?.error || result.error?.message || lastError;
      transportFailed = Boolean(result.error) || !response;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      transportFailed = true;
    }
    if (transportFailed && body.action === "apply" && body.dryRun !== true) throw new Error(lastError);
    if (!transportFailed && !response?.retryable) throw new Error(lastError);

    const retryAfterMs = Number(response?.retryAfterMs);
    if (!transportFailed && retryAfterMs > 0) {
      limitWaits += 1;
      if (limitWaits > MAX_LIMIT_WAITS) break;
      const ms = Math.min(retryAfterMs, 120_000) + 1_500;
      onWait?.(Math.ceil(ms / 1000));
      await wait(ms);
      continue;
    }
    failures += 1;
    if (failures >= MAX_FAILURES) break;
    await wait(3_000 * failures);
  }
  throw new Error(lastError);
}
