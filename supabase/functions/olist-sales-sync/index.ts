import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { errorResponse, jsonResponse } from "../_shared/cors.ts";
import {
  listOlistOrdersPage,
  olistCallsPerMinute,
  setOlistCallPriority,
  toOlistDate,
} from "../_shared/olist.ts";
import {
  loadSalesOrderQueue,
  processOlistWebhookEvent,
  refreshSalesOrder,
  toOlistDateTime,
  upsertInternalOrderStubs,
} from "../_shared/olist-sales.ts";

/**
 * Sincroniza as vendas lançadas direto na Olist. Chamada pela conciliação
 * (olist-reconcile-franchise, a cada 10 min), que é disparada pelo worker:
 *  1. reprocessa avisos de webhook que falharam ou não terminaram;
 *  2. de hora em hora, varre os pedidos alterados (rede de segurança dos
 *     webhooks, que a Olist reenvia poucas vezes);
 *  3. trabalha a fila: pedido novo/alterado, NF-e pendente, boleto em aberto.
 */

const BUDGET_MS = 110_000;
const SCAN_INTERVAL_MS = 55 * 60_000;
// Primeira varredura: espelha 90 dias para o painel (sem faturar pedidos
// anteriores à data de corte da automação).
const BACKFILL_DAYS = 90;
const MAX_SCAN_PAGES = 30;
const SCAN_STATE_KEY = "orders_scan";

async function processPendingEvents(admin: SupabaseClient, token: string, deadline: number) {
  const summary = { processed: 0, failed: 0 };
  const { data: events, error } = await admin.from("olist_webhook_events")
    .select("id,event,payload,attempts")
    .is("processed_at", null)
    .lt("attempts", 20)
    // Aviso recém-chegado ainda está sendo tratado pelo próprio webhook.
    .lt("received_at", new Date(Date.now() - 2 * 60_000).toISOString())
    .order("received_at", { ascending: true })
    .limit(20);
  if (error) throw error;
  for (const event of events ?? []) {
    if (Date.now() > deadline) break;
    try {
      await processOlistWebhookEvent(admin, event.event, event.payload, token);
      await admin.from("olist_webhook_events").update({
        processed_at: new Date().toISOString(),
        attempts: event.attempts + 1,
        last_error: null,
      }).eq("id", event.id);
      summary.processed++;
    } catch (eventError) {
      summary.failed++;
      await admin.from("olist_webhook_events").update({
        attempts: event.attempts + 1,
        last_error: (eventError instanceof Error ? eventError.message : String(eventError))
          .slice(0, 2000),
      }).eq("id", event.id);
    }
  }
  return summary;
}

async function scanChangedOrders(admin: SupabaseClient, token: string, deadline: number) {
  const { data: state, error } = await admin.from("olist_sync_state")
    .select("value").eq("key", SCAN_STATE_KEY).maybeSingle();
  if (error) throw error;
  const last = state?.value ? new Date(state.value) : null;
  if (last && Date.now() - last.getTime() < SCAN_INTERVAL_MS) return { skipped: true };

  const startedAt = new Date();
  let filters: Record<string, string>;
  if (last) {
    // Margem de 10 min para não perder alterações gravadas durante a última varredura.
    filters = { dataAtualizacao: toOlistDateTime(new Date(last.getTime() - 10 * 60_000)) };
  } else {
    const from = new Date(startedAt);
    from.setDate(from.getDate() - BACKFILL_DAYS);
    filters = { dataInicial: toOlistDate(from), dataFinal: toOlistDate(startedAt) };
  }

  let pages = 0;
  let queued = 0;
  let complete = false;
  for (let page = 1; page <= MAX_SCAN_PAGES; page++) {
    if (Date.now() > deadline) break;
    const { orders, totalPages } = await listOlistOrdersPage(filters, page, token);
    pages++;
    queued += await upsertInternalOrderStubs(admin, orders);
    if (!orders.length || page >= totalPages) {
      complete = true;
      break;
    }
  }
  // Só avança o marco quando a varredura terminou; senão repete na próxima rodada.
  if (complete) {
    const { error: saveError } = await admin.from("olist_sync_state").upsert({
      key: SCAN_STATE_KEY,
      value: startedAt.toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (saveError) throw saveError;
  }
  return { skipped: false, pages, queued, complete };
}

async function workQueue(admin: SupabaseClient, token: string, deadline: number) {
  const summary: Record<string, number> = { done: 0, waiting: 0, retry: 0, site: 0, busy: 0 };
  const rows = await loadSalesOrderQueue(admin, 15);
  for (const row of rows) {
    if (Date.now() > deadline) break;
    try {
      summary[await refreshSalesOrder(admin, row, token)]++;
    } catch (error) {
      summary.retry++;
      console.error(`olist-sales-sync ${row.olist_order_id}:`, error);
    }
  }
  return summary;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!serviceRole || bearer !== serviceRole) return errorResponse("Não autorizado", 401);
  const token = Deno.env.get("OLIST_API_TOKEN") || Deno.env.get("TINY_API_TOKEN") || "";
  if (!token) return errorResponse("OLIST_API_TOKEN não configurado", 503);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRole);
  setOlistCallPriority("background");
  const startedAt = Date.now();
  const deadline = startedAt + BUDGET_MS;
  const result: Record<string, unknown> = {};
  // Cada etapa falha sozinha: um erro na varredura não impede a fila.
  for (
    const [name, step] of [
      ["events", () => processPendingEvents(admin, token, deadline)],
      ["scan", () => scanChangedOrders(admin, token, deadline)],
      ["queue", () => workQueue(admin, token, deadline)],
    ] as const
  ) {
    try {
      result[name] = await step();
    } catch (error) {
      console.error(`olist-sales-sync ${name}:`, error);
      result[name] = { error: error instanceof Error ? error.message : String(error) };
    }
  }
  // Última execução, para o painel de automações do admin.
  const { error: stateError } = await admin.from("olist_sync_state").upsert({
    key: "sales_sync_run",
    value: new Date().toISOString(),
    details: { ...result, durationMs: Date.now() - startedAt, callsPerMinute: olistCallsPerMinute() },
    updated_at: new Date().toISOString(),
  });
  if (stateError) console.error("olist-sales-sync estado:", stateError);
  return jsonResponse(result);
});
