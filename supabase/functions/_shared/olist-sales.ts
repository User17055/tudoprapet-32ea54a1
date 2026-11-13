import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import {
  assertSingleOlistReceivable,
  ensureOlistOrderReceivable,
  getOlistInvoice,
  getOlistOrderSnapshot,
  getOlistReceivable,
  issueFranchiseInvoiceSafely,
  type OlistInvoice,
  type OlistOrderListEntry,
} from "./olist.ts";

/**
 * Vendas lançadas direto na Olist (pedido de venda interno/presencial).
 *
 * Pedido sem número de e-commerce = venda interna. Os pedidos do site sempre
 * têm esse número (importação Shopify ou pedido de franquia criado pela API) e
 * seguem pela conciliação de checkout_sessions.
 *
 * Toda venda aprovada precisa de NF-e; venda de franquia também precisa da
 * conta a receber com boleto na Olist. NF-e nunca bloqueia nada: falha vira
 * status/erro gravado e retentativa (AGENTS.md).
 */

// Pedidos internos anteriores a esta data aparecem no painel, mas não são
// faturados sozinhos (podem ter sido tratados à mão antes da automação).
export const DEFAULT_INTERNAL_AUTOMATION_START = "2026-11-11";

export function internalAutomationStart(): string {
  const configured = String(Deno.env.get("OLIST_INTERNAL_AUTOMATION_START") || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(configured) ? configured : DEFAULT_INTERNAL_AUTOMATION_START;
}

/** Interruptor de emergência: OLIST_INTERNAL_AUTOMATION=off só espelha os pedidos. */
export function internalAutomationEnabled(): boolean {
  return String(Deno.env.get("OLIST_INTERNAL_AUTOMATION") || "").trim().toLowerCase() !== "off";
}

export function normalizeSituation(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// "Em aberto", "cancelado" e "dados incompletos" ficam de fora: a venda ainda
// não foi aprovada (pode ser orçamento) ou não existe mais.
const APPROVED_SITUATIONS = new Set([
  "aprovado",
  "preparando envio",
  "faturado",
  "pronto envio",
  "pronto para envio",
  "enviado",
  "entregue",
  "nao entregue",
  "atendido",
]);

export function isApprovedSituation(value: unknown): boolean {
  return APPROVED_SITUATIONS.has(normalizeSituation(value));
}

/** "dd/mm/yyyy" -> "yyyy-mm-dd". */
export function olistDateToIso(value: unknown): string | null {
  const match = String(value ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** Formato do filtro `dataAtualizacao`: "dd/mm/yyyy hh:mm:ss" no horário de Brasília. */
export function toOlistDateTime(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function retryDelayMinutes(attempts: number): number {
  return Math.min(360, 10 * 2 ** Math.max(0, attempts - 1));
}

function formatCpfCnpj(digits: string): string {
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  return digits;
}

export interface SalesOrderRow {
  id: string;
  olist_order_id: string;
  olist_order_number: string | null;
  customer_type: string;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  receivable_id: string | null;
  receivable_status: string | null;
  attempts: number;
}

const SALES_ORDER_COLUMNS =
  "id,olist_order_id,olist_order_number,customer_type,invoice_id,invoice_number,invoice_status,receivable_id,receivable_status,attempts";

/**
 * Registra (ou marca para atualizar) os pedidos internos de uma listagem.
 * Só pedidos novos ou com situação diferente voltam para a fila.
 */
export async function upsertInternalOrderStubs(
  admin: SupabaseClient,
  entries: Array<Pick<OlistOrderListEntry, "id" | "number" | "externalReference" | "situation"> & {
    orderDate?: string | null;
    customerName?: string;
    total?: number;
  }>,
): Promise<number> {
  const internal = entries.filter((entry) => !entry.externalReference);
  if (!internal.length) return 0;
  const ids = internal.map((entry) => entry.id);
  // Defesa extra: pedido criado pelo checkout nunca é venda interna.
  const [{ data: sessions, error: sessionsError }, { data: existing, error: existingError }] =
    await Promise.all([
      // leitura-limitada: no máximo os 100 pedidos de uma página da Olist
      admin.from("checkout_sessions").select("olist_order_id").in("olist_order_id", ids),
      // leitura-limitada: no máximo os 100 pedidos de uma página da Olist
      admin.from("sales_orders").select("olist_order_id,situation").in("olist_order_id", ids),
    ]);
  if (sessionsError) throw sessionsError;
  if (existingError) throw existingError;
  const siteIds = new Set((sessions ?? []).map((row) => String(row.olist_order_id)));
  const knownSituation = new Map(
    (existing ?? []).map((row) => [String(row.olist_order_id), normalizeSituation(row.situation)]),
  );
  const changed = internal.filter((entry) =>
    !siteIds.has(entry.id) &&
    (!knownSituation.has(entry.id) ||
      knownSituation.get(entry.id) !== normalizeSituation(entry.situation))
  );
  if (!changed.length) return 0;
  const { error } = await admin.from("sales_orders").upsert(
    changed.map((entry) => ({
      olist_order_id: entry.id,
      olist_order_number: entry.number,
      situation: entry.situation || null,
      ...(entry.orderDate ? { order_date: olistDateToIso(entry.orderDate) } : {}),
      ...(entry.customerName ? { customer_name: entry.customerName } : {}),
      ...(Number.isFinite(entry.total) ? { total: entry.total } : {}),
      needs_refresh: true,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "olist_order_id" },
  );
  if (error) throw error;
  return changed.length;
}

async function resolveCustomer(
  admin: SupabaseClient,
  cpfCnpj: string,
): Promise<{ userId: string | null; type: "franchise" | "common" | "unknown" }> {
  if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) return { userId: null, type: "unknown" };
  const column = cpfCnpj.length === 14 ? "cnpj" : "cpf";
  const { data, error } = await admin.from("profiles")
    .select("user_id,is_franchisee")
    .or(`${column}.eq.${cpfCnpj},${column}.eq."${formatCpfCnpj(cpfCnpj)}"`)
    .limit(2);
  if (error) throw error;
  // Documento em mais de um cadastro: não adivinha a quem mostrar a venda.
  if (!data || data.length !== 1) return { userId: null, type: "unknown" };
  return {
    userId: String(data[0].user_id),
    type: data[0].is_franchisee && column === "cnpj" ? "franchise" : "common",
  };
}

function invoicePatch(invoice: OlistInvoice | null, status: string, error: string | null) {
  return {
    invoice_status: status,
    invoice_error: error ? error.slice(0, 2000) : null,
    invoice_checked_at: new Date().toISOString(),
    ...(invoice?.id ? { invoice_id: invoice.id } : {}),
    ...(invoice?.number ? { invoice_number: invoice.number } : {}),
    ...(invoice?.accessUrl ? { invoice_url: invoice.accessUrl } : {}),
  };
}

const SETTLED_RECEIVABLE = ["pago", "cancelado", "cancelada"];

/**
 * Atualiza um pedido interno a partir da Olist e, se aprovado, garante boleto
 * (franquia) e NF-e. Retorna o que aconteceu, para o resumo do job.
 */
export async function refreshSalesOrder(
  admin: SupabaseClient,
  row: SalesOrderRow,
  token: string,
): Promise<"site" | "done" | "waiting" | "retry" | "busy"> {
  const { data: claimed, error: claimError } = await admin.rpc("claim_sales_order", {
    p_id: row.id,
  });
  if (claimError) throw claimError;
  if (!claimed) return "busy";

  const now = new Date();
  const patch: Record<string, unknown> = {};
  let hadError = false;
  let waiting = false;
  try {
    const snapshot = await getOlistOrderSnapshot(row.olist_order_id, token);
    if (snapshot.externalReference) {
      // Pedido do site: quem cuida é a conciliação de checkout_sessions.
      const { error } = await admin.from("sales_orders").delete().eq("id", row.id);
      if (error) throw error;
      return "site";
    }
    const customer = await resolveCustomer(admin, snapshot.customer.cpfCnpj);
    const orderDate = olistDateToIso(snapshot.orderDate);
    const eligible = internalAutomationEnabled() && isApprovedSituation(snapshot.situation) &&
      !!orderDate && orderDate >= internalAutomationStart();
    Object.assign(patch, {
      olist_order_number: snapshot.number,
      user_id: customer.userId,
      customer_type: customer.type,
      customer_name: snapshot.customer.name || null,
      customer_cpf_cnpj: snapshot.customer.cpfCnpj || null,
      situation: snapshot.situation || null,
      order_date: orderDate,
      total: Number.isFinite(snapshot.total) ? snapshot.total : null,
      items: snapshot.items,
      tracking_code: snapshot.trackingCode,
      automation_eligible: eligible,
    });

    if (eligible && customer.type === "franchise") {
      // Boleto primeiro: a NF-e pode mudar a origem financeira do pedido, e
      // ensureOlistOrderReceivable já sabe reaproveitar a conta nos dois casos.
      try {
        const reference = row.receivable_id
          ? { id: row.receivable_id }
          : await ensureOlistOrderReceivable(row.olist_order_id, token);
        const account = await getOlistReceivable(reference.id, token);
        if (!row.receivable_id) {
          await assertSingleOlistReceivable(row.olist_order_id, account.id, token);
        }
        Object.assign(patch, {
          receivable_id: account.id,
          receivable_status: account.status,
          receivable_due_date: account.dueDate || null,
          receivable_amount: Number.isFinite(account.amount) ? account.amount : null,
          receivable_error: null,
          ...(account.boletoUrl ? { boleto_url: account.boletoUrl } : {}),
        });
        if (!SETTLED_RECEIVABLE.includes(account.status)) waiting = true;
      } catch (receivableError) {
        hadError = true;
        patch.receivable_error = (receivableError instanceof Error
          ? receivableError.message
          : String(receivableError)).slice(0, 2000);
      }
    }

    if (eligible && row.invoice_status !== "issued") {
      const outcome = await issueFranchiseInvoiceSafely({
        orderId: row.olist_order_id,
        token,
        savedInvoice: row.invoice_id
          ? { id: row.invoice_id, number: String(row.invoice_number || ""), issued: false }
          : null,
        onInvoiceGenerated: async (generated) => {
          const { error } = await admin.from("sales_orders").update({
            invoice_id: generated.id,
            invoice_number: generated.number,
            invoice_status: "generating",
          }).eq("id", row.id);
          if (error) throw error;
        },
      });
      Object.assign(patch, invoicePatch(outcome.invoice, outcome.status, outcome.error));
      if (outcome.status === "rejected") hadError = true;
      // Pendente com erro = limite de chamadas da Olist: tenta de novo em 10 min.
      if (outcome.status === "pending") {
        if (outcome.error) hadError = true;
        else waiting = true;
      }
    } else if (!eligible && snapshot.invoiceId && row.invoice_status !== "issued") {
      // Fora da automação, só mostra a nota que já existe na Olist.
      const invoice = await getOlistInvoice(snapshot.invoiceId, token);
      Object.assign(
        patch,
        invoicePatch(
          invoice,
          invoice.issued ? "issued" : invoice.voided ? "rejected" : "pending",
          invoice.voided ? "NF-e cancelada ou denegada na Olist" : null,
        ),
      );
    }
  } catch (error) {
    hadError = true;
    console.error(`Venda Olist ${row.olist_order_id}:`, error);
    patch.invoice_error = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  }

  const attempts = hadError ? row.attempts + 1 : 0;
  const next = hadError
    ? new Date(now.getTime() + retryDelayMinutes(attempts) * 60_000)
    : waiting
    ? new Date(now.getTime() + 60 * 60_000)
    : null;
  const { error: saveError } = await admin.from("sales_orders").update({
    ...patch,
    needs_refresh: false,
    refreshed_at: now.toISOString(),
    attempts,
    next_attempt_at: next ? next.toISOString() : null,
    processing_until: null,
    updated_at: now.toISOString(),
  }).eq("id", row.id);
  if (saveError) throw saveError;
  return hadError ? "retry" : waiting ? "waiting" : "done";
}

export async function loadSalesOrder(
  admin: SupabaseClient,
  olistOrderId: string,
): Promise<SalesOrderRow | null> {
  const { data, error } = await admin.from("sales_orders")
    .select(SALES_ORDER_COLUMNS)
    .eq("olist_order_id", olistOrderId)
    .maybeSingle();
  if (error) throw error;
  return (data as SalesOrderRow | null) ?? null;
}

export async function loadSalesOrderQueue(
  admin: SupabaseClient,
  limit: number,
): Promise<SalesOrderRow[]> {
  const now = new Date().toISOString();
  const { data, error } = await admin.from("sales_orders")
    .select(SALES_ORDER_COLUMNS)
    // A trava (processing_until) é conferida por claim_sales_order.
    .or(`needs_refresh.eq.true,next_attempt_at.lte.${now}`)
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as SalesOrderRow[];
}

/** Corpo do webhook: JSON, ou formulário com o JSON no campo `dados`. */
export function parseWebhookBody(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    const form = new URLSearchParams(raw);
    const data = form.get("dados") || form.get("data");
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
}

export interface WebhookOrderRef {
  id: string;
  number: string;
  externalReference: string;
  situation: string;
}

/** Pedidos citados no aviso `atualizacao_situacao_pedido`. */
export function ordersFromSituationEvent(payload: any): WebhookOrderRef[] {
  const list = Array.isArray(payload?.pedidos)
    ? payload.pedidos
    : payload?.dados
    ? [payload.dados]
    : [];
  return list
    .map((entry: any) => entry?.pedido ?? entry)
    .filter((order: any) => order?.id)
    .map((order: any) => ({
      id: String(order.id),
      number: String(order.numero ?? order.id),
      externalReference: String(order.numero_ecommerce || "").trim(),
      situation: String(order.situacao_atual ?? order.situacao ?? "").trim(),
    }));
}

/** Notas citadas no aviso `envio_nota_fiscal`. */
export function invoicesFromInvoiceEvent(payload: any): Array<{ id: string; orderId: string | null }> {
  const list = Array.isArray(payload?.notas)
    ? payload.notas
    : payload?.dados
    ? [payload.dados]
    : [];
  return list
    .map((entry: any) => entry?.nota ?? entry)
    .filter((invoice: any) => invoice?.id)
    .map((invoice: any) => ({
      id: String(invoice.id),
      orderId: invoice.pedido_id ? String(invoice.pedido_id) : invoice.idPedido
        ? String(invoice.idPedido)
        : null,
    }));
}

/**
 * Processa um aviso da Olist. O conteúdo do aviso só diz o que mudou: os dados
 * usados são sempre relidos da própria API (o webhook não tem assinatura).
 */
export async function processOlistWebhookEvent(
  admin: SupabaseClient,
  event: string,
  payload: any,
  token: string,
): Promise<void> {
  if (event === "atualizacao_situacao_pedido") {
    const orders = ordersFromSituationEvent(payload).filter((order) => !order.externalReference);
    if (!orders.length) return;
    await upsertInternalOrderStubs(admin, orders);
    for (const order of orders) {
      const row = await loadSalesOrder(admin, order.id);
      if (row) await refreshSalesOrder(admin, row, token);
    }
    return;
  }

  if (event === "envio_nota_fiscal") {
    for (const reference of invoicesFromInvoiceEvent(payload)) {
      if (!reference.orderId) continue;
      const row = await loadSalesOrder(admin, reference.orderId);
      if (row) {
        await admin.from("sales_orders").update({ needs_refresh: true }).eq("id", row.id);
        await refreshSalesOrder(admin, row, token);
        continue;
      }
      // Pedido do site: atualiza a nota na hora, sem esperar a conciliação.
      const { data: session, error } = await admin.from("checkout_sessions")
        .select("id,olist_invoice_id")
        .eq("olist_order_id", reference.orderId)
        .maybeSingle();
      if (error) throw error;
      if (!session) continue;
      if (session.olist_invoice_id && String(session.olist_invoice_id) !== reference.id) continue;
      const invoice = await getOlistInvoice(reference.id, token);
      if (!invoice.issued && !invoice.voided) continue;
      const { error: saveError } = await admin.from("checkout_sessions").update({
        olist_invoice_id: invoice.id,
        olist_invoice_status: invoice.issued ? "issued" : "rejected",
        olist_invoice_error: invoice.voided ? "NF-e cancelada ou denegada na Olist" : null,
        olist_invoice_checked_at: new Date().toISOString(),
        ...(invoice.number ? { olist_invoice_number: invoice.number } : {}),
        ...(invoice.accessUrl ? { olist_invoice_url: invoice.accessUrl } : {}),
      }).eq("id", session.id);
      if (saveError) throw saveError;
    }
  }
}
