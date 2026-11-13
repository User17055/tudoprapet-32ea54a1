import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { errorResponse, jsonResponse } from "../_shared/cors.ts";
import {
  assertSingleOlistReceivable,
  ensureOlistOrderReceivable,
  findImportedOlistOrders,
  findOlistOrderByEcommerceNumber,
  getOlistOrderReconciliationDetails,
  getOlistReceivable,
  issueFranchiseInvoiceSafely,
  olistCallsPerMinute,
  olistExternalReferenceMatches,
  setOlistCallPriority,
  settleOlistReceivable,
} from "../_shared/olist.ts";
import { getShopifyOrderReference, shopifyAdminToken } from "../_shared/shopify.ts";
import { needsAction, NEEDS_ACTION_RETRY_HOURS, nextDailyRetry } from "../_shared/olist-issues.ts";

function dateFromOlist(value?: string): Date | null {
  const match = String(value || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return new Date(`${match[3]}-${match[2]}-${match[1]}T23:59:59-03:00`);
}

function retryAt(attempt: number): string {
  // A importação Shopify -> Olist pode demorar. Começa em 10 minutos e
  // cresce até 6 horas, sem abandonar a conciliação silenciosamente.
  const minutes = Math.min(360, 10 * (2 ** Math.max(0, attempt - 1)));
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

// Toda venda tem que ter nota e venda paga não pode ficar com conta em aberto:
// não há janela móvel que abandone pendências. O piso só evita reprocessar
// vendas anteriores à ponte Asaas -> Olist, que foram tratadas manualmente.
// Manter igual ao padrão de public.admin_sales_fiscal_health.
const DEFAULT_RECONCILIATION_START = "2026-10-07T00:00:00-03:00";
// Mesma janela usada pela varredura de `findImportedOlistOrders`.
const IMPORT_SCAN_DAYS = 14;

function reconciliationStart(): string {
  const configured = new Date(Deno.env.get("OLIST_RECONCILIATION_START") || "");
  return Number.isNaN(configured.getTime())
    ? new Date(DEFAULT_RECONCILIATION_START).toISOString()
    : configured.toISOString();
}

/**
 * Vendas lançadas direto na Olist rodam em outra function, com orçamento de
 * tempo próprio. Disparada daqui para não guardar outra cópia da service role
 * no cron do banco (mesmo motivo do worker que chama esta conciliação).
 */
function scheduleSalesSync(serviceRole: string) {
  try {
    const task = fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/olist-sales-sync`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${serviceRole}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source: "olist-reconcile-franchise" }),
    }).then(async (response) => {
      if (!response.ok) console.error("Sincronização de vendas Olist recusada:", response.status);
    }).catch((error) => console.error("Falha isolada na sincronização de vendas Olist:", error));
    const runtime = (globalThis as unknown as {
      EdgeRuntime?: { waitUntil(value: Promise<unknown>): void };
    }).EdgeRuntime;
    runtime?.waitUntil(task);
  } catch (error) {
    console.error("Falha isolada na sincronização de vendas Olist:", error);
  }
}

// Cada rodada tem orçamento de tempo: o que não couber fica para a próxima
// (a conciliação roda a cada 10 min). Evita a function morrer no meio de um
// item quando a Olist está lenta ou o limite de chamadas está cheio.
const RUN_BUDGET_MS = 110_000;
let runDeadline = Number.POSITIVE_INFINITY;
const outOfTime = () => Date.now() > runDeadline;

const dayAgo = () => new Date(Date.now() - NEEDS_ACTION_RETRY_HOURS * 60 * 60_000).toISOString();

class AwaitingOlistImportError extends Error {
  constructor() {
    super("Pedido pago ainda não foi importado da Shopify para a Olist");
    this.name = "AwaitingOlistImportError";
  }
}

interface BridgeSession {
  id: string;
  customer_type: "common" | "subscriber";
  created_at: string;
  shopify_order_id: string;
  olist_order_id: string | null;
  olist_order_number: string | null;
  olist_receivable_id: string | null;
  olist_payment_sync_attempts: number;
  total: number;
  customer_snapshot: { cpfCnpj?: string; email?: string } | null;
}

interface BridgePayment {
  id: string;
  checkout_session_id: string;
  provider_payment_id: string;
  method: string;
  status: "confirmed" | "received";
  amount: number;
  confirmed_at: string | null;
  received_at: string | null;
}

async function reconcileAsaasPayments(admin: SupabaseClient, token: string) {
  const now = new Date().toISOString();
  const { data: sessions, error } = await admin.from("checkout_sessions")
    .select(
      "id,created_at,customer_type,shopify_order_id,olist_order_id,olist_order_number,olist_receivable_id,olist_payment_sync_attempts,total,customer_snapshot",
    )
    .in("customer_type", ["common", "subscriber"])
    .eq("status", "shopify_created")
    .not("shopify_order_id", "is", null)
    .is("olist_payment_synced_at", null)
    .gte("created_at", reconciliationStart())
    .or(`olist_payment_sync_next_attempt_at.is.null,olist_payment_sync_next_attempt_at.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(8);
  if (error) throw error;
  const pendingSessions = (sessions ?? []) as BridgeSession[];
  if (!pendingSessions.length) return { checked: 0, settled: 0, awaitingImport: 0, failed: 0 };

  const sessionIds = pendingSessions.map((session) => session.id);
  const { data: payments, error: paymentsError } = await admin.from("payments")
    .select(
      "id,checkout_session_id,provider_payment_id,method,status,amount,confirmed_at,received_at",
    )
    .in("checkout_session_id", sessionIds)
    .eq("provider", "asaas")
    .in("status", ["confirmed", "received"])
    .order("attempt_number", { ascending: false })
    .limit(250);
  if (paymentsError) throw paymentsError;
  const paymentBySession = new Map<string, BridgePayment>();
  for (const payment of (payments ?? []) as BridgePayment[]) {
    if (!paymentBySession.has(payment.checkout_session_id)) {
      paymentBySession.set(payment.checkout_session_id, payment);
    }
  }

  const shopifyToken = shopifyAdminToken();
  if (!shopifyToken) throw new Error("SHOPIFY_ACCESS_TOKEN ausente para conciliação Olist");
  const destinationAccount = String(Deno.env.get("OLIST_ASAAS_ACCOUNT_NAME") || "").trim();
  if (!destinationAccount) {
    throw new Error("OLIST_ASAAS_ACCOUNT_NAME ausente para conciliação Olist");
  }
  const references = new Map<string, Awaited<ReturnType<typeof getShopifyOrderReference>>>();
  for (const session of pendingSessions) {
    if (!paymentBySession.has(session.id)) continue;
    references.set(
      session.id,
      await getShopifyOrderReference(String(session.shopify_order_id), shopifyToken),
    );
  }
  const allReferences = [...references.values()].flatMap((order) => [
    order.id,
    order.name,
    order.orderNumber,
  ]);
  const importedOrders = await findImportedOlistOrders(allReferences, token);

  let settled = 0;
  let awaitingImport = 0;
  let failed = 0;
  for (const session of pendingSessions) {
    if (outOfTime()) break;
    const payment = paymentBySession.get(session.id);
    const shopify = references.get(session.id);
    if (!payment || !shopify) continue;
    const attempt = Number(session.olist_payment_sync_attempts || 0) + 1;
    try {
      if (shopify.financialStatus && shopify.financialStatus !== "paid") {
        throw new Error(`Shopify não confirma pedido como pago (${shopify.financialStatus})`);
      }
      // Pedido já vinculado: usa o id salvo. A varredura recente não alcança
      // vendas antigas, e o pedido completo é conferido logo abaixo.
      let imported = session.olist_order_id
        ? {
          id: String(session.olist_order_id),
          number: String(session.olist_order_number || session.olist_order_id),
          externalReference: "",
        }
        : importedOrders.find((order) =>
          olistExternalReferenceMatches(order.externalReference, [
            shopify.id,
            shopify.name,
            shopify.orderNumber,
          ])
        ) ?? null;
      const ageDays = (Date.now() - Date.parse(session.created_at)) / 86_400_000;
      if (!imported && ageDays >= IMPORT_SCAN_DAYS - 1) {
        imported = await findOlistOrderByEcommerceNumber(
          [shopify.id, shopify.name, shopify.orderNumber],
          token,
        );
      }
      if (!imported) {
        awaitingImport++;
        const waiting = new AwaitingOlistImportError();
        const { error: updateError } = await admin.from("checkout_sessions").update({
          olist_payment_sync_attempts: attempt,
          olist_payment_sync_next_attempt_at: retryAt(attempt),
          olist_payment_sync_error: waiting.message,
        }).eq("id", session.id).is("olist_payment_synced_at", null);
        if (updateError) {
          console.error(`Falha ao guardar espera de importação Olist ${session.id}:`, updateError);
        }
        console.warn(`Ponte Asaas -> Olist aguardando importação para ${session.id}`);
        continue;
      }

      // O numero externo sozinho pode se repetir entre canais. Antes de tocar
      // no financeiro, confirme no pedido completo da Olist o canal, o valor e
      // a identidade do comprador.
      const olistOrder = await getOlistOrderReconciliationDetails(imported.id, token);
      if (
        !olistExternalReferenceMatches(olistOrder.externalReference, [
          shopify.id,
          shopify.name,
          shopify.orderNumber,
        ])
      ) {
        throw new Error("Referência do pedido Olist diverge do pedido Shopify");
      }
      const orderAmount = Number(session.total);
      if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
        throw new Error("Valor do pedido inválido para baixa na Olist");
      }
      if (!Number.isFinite(olistOrder.total) || Math.abs(olistOrder.total - orderAmount) > 0.01) {
        throw new Error(
          `Total do pedido Olist (${olistOrder.total}) diverge da Shopify (${orderAmount})`,
        );
      }
      const expectedCpfCnpj = String(session.customer_snapshot?.cpfCnpj || "").replace(/\D/g, "");
      const expectedEmail = String(session.customer_snapshot?.email || "").trim().toLowerCase();
      if (
        expectedCpfCnpj && olistOrder.customerCpfCnpj &&
        expectedCpfCnpj !== olistOrder.customerCpfCnpj
      ) {
        throw new Error("CPF/CNPJ do pedido Olist diverge do checkout");
      }
      const identityConfirmed = Boolean(
        expectedCpfCnpj && olistOrder.customerCpfCnpj === expectedCpfCnpj,
      ) || Boolean(expectedEmail && olistOrder.customerEmail === expectedEmail);
      if (!identityConfirmed) {
        throw new Error("Não foi possível confirmar o cliente do pedido antes da baixa");
      }
      // Pedido confirmado: guarda o vínculo já agora para a NF-e poder ser
      // emitida mesmo que a baixa da conta falhe nesta rodada.
      if (!session.olist_order_id) {
        await admin.from("checkout_sessions").update({
          olist_order_id: imported.id,
          olist_order_number: imported.number,
        }).eq("id", session.id).is("olist_order_id", null);
      }


      const receivableRef = session.olist_receivable_id
        ? { id: String(session.olist_receivable_id) }
        : await ensureOlistOrderReceivable(imported.id, token);
      const receivable = await getOlistReceivable(receivableRef.id, token);
      const paidAmount = Number(payment.amount);
      if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
        throw new Error("Valor pago inválido para baixa na Olist");
      }
      if (
        Number.isFinite(receivable.amount) &&
        Math.abs(Number(receivable.amount) - orderAmount) > 0.01
      ) {
        throw new Error(
          `Valor da conta Olist (${receivable.amount}) diverge do pedido (${orderAmount})`,
        );
      }
      // Venda paga no site não pode deixar outra conta viva na Olist.
      await assertSingleOlistReceivable(imported.id, receivable.id, token);
      const paidAtValue = String(payment.received_at || payment.confirmed_at || now);
      const paidAt = new Date(paidAtValue);
      if (Number.isNaN(paidAt.getTime())) throw new Error("Data do pagamento Asaas inválida");
      await settleOlistReceivable(receivable.id, token, {
        paidAt,
        // Cartão parcelado pode cobrar juros do cliente no Asaas. A conta do
        // pedido na Olist representa a venda sem esses juros e deve ser baixada
        // pelo próprio valor; a diferença permanece identificada no histórico.
        amount: Number.isFinite(receivable.amount) ? Number(receivable.amount) : orderAmount,
        destinationAccount,
        history: `Pagamento ${
          String(payment.method).toUpperCase()
        } confirmado no Asaas ${payment.provider_payment_id}; cobrado R$ ${paidAmount.toFixed(2)}`,
      });
      const { error: updateError } = await admin.from("checkout_sessions").update({
        olist_order_id: imported.id,
        olist_order_number: imported.number,
        olist_receivable_id: receivable.id,
        olist_payment_synced_at: new Date().toISOString(),
        olist_payment_sync_attempts: attempt,
        olist_payment_sync_next_attempt_at: null,
        olist_payment_sync_error: null,
      }).eq("id", session.id).is("olist_payment_synced_at", null);
      if (updateError) throw updateError;
      settled++;
    } catch (entryError) {
      if (!(entryError instanceof AwaitingOlistImportError)) failed++;
      const message = entryError instanceof Error ? entryError.message : String(entryError);
      const { error: updateError } = await admin.from("checkout_sessions").update({
        olist_payment_sync_attempts: attempt,
        // Precisa de ação (total diferente, nota sem conta...): só uma vez por
        // dia, até alguém corrigir na Olist ou pedir "tentar agora" no painel.
        olist_payment_sync_next_attempt_at: needsAction(message) ? nextDailyRetry() : retryAt(attempt),
        olist_payment_sync_error: message.slice(0, 2000),
      }).eq("id", session.id).is("olist_payment_synced_at", null);
      if (updateError) {
        console.error(`Falha ao guardar retentativa Olist ${session.id}:`, updateError);
      }
      console.error(`Ponte Asaas -> Olist pendente para ${session.id}:`, message);
    }
  }
  return { checked: pendingSessions.length, settled, awaitingImport, failed };
}

/**
 * NF-e dos pedidos pagos de clientes (comum e Clube). Usa o pedido importado
 * da Shopify na Olist (a natureza vem da integração). Reaproveita a nota já
 * existente no pedido; a trava impede duas emissões simultâneas.
 */
async function issueCustomerInvoices(admin: SupabaseClient, token: string) {
  const summary = { checked: 0, issued: 0, pending: 0, rejected: 0 };
  const cutoff = reconciliationStart();
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: rows, error } = await admin.from("checkout_sessions")
    .select("id,olist_order_id,olist_invoice_id,olist_invoice_number,olist_invoice_status")
    .in("customer_type", ["common", "subscriber"])
    .eq("status", "shopify_created")
    .not("olist_order_id", "is", null)
    .gte("created_at", cutoff)
    .or(
      // Recusada pela SEFAZ/Olist só volta uma vez por dia (precisa de correção).
      `olist_invoice_status.is.null,olist_invoice_status.eq.pending,and(olist_invoice_status.eq.rejected,olist_invoice_checked_at.lt.${dayAgo()}),and(olist_invoice_status.eq.generating,olist_invoice_checked_at.lt.${stale})`,
    )
    .order("olist_invoice_checked_at", { ascending: true, nullsFirst: true })
    .limit(8);
  if (error) {
    console.error("Falha ao listar NF-e de clientes:", error);
    return summary;
  }
  for (const row of rows || []) {
    if (outOfTime()) break;
    summary.checked++;
    const { data: claimed, error: claimError } = await admin.rpc(
      "claim_olist_invoice_processing",
      { p_session_id: row.id },
    );
    if (claimError || !claimed) {
      if (claimError) console.error(`Falha ao reservar NF-e ${row.id}:`, claimError);
      continue;
    }
    const outcome = await issueFranchiseInvoiceSafely({
      orderId: String(row.olist_order_id),
      token,
      savedInvoice: row.olist_invoice_id
        ? { id: String(row.olist_invoice_id), number: String(row.olist_invoice_number || ""), issued: false }
        : null,
      onInvoiceGenerated: async (generated) => {
        const { error: saveError } = await admin.from("checkout_sessions").update({
          olist_invoice_id: generated.id,
          olist_invoice_number: generated.number,
        }).eq("id", row.id);
        if (saveError) throw saveError;
      },
    });
    summary[outcome.status]++;
    if (outcome.error) console.warn(`NF-e do cliente ${row.id} pendente:`, outcome.error);
    await admin.from("checkout_sessions").update({
      olist_invoice_status: outcome.status,
      olist_invoice_error: outcome.error ? outcome.error.slice(0, 2000) : null,
      olist_invoice_checked_at: new Date().toISOString(),
      ...(outcome.invoice?.id ? { olist_invoice_id: outcome.invoice.id } : {}),
      ...(outcome.invoice?.number ? { olist_invoice_number: outcome.invoice.number } : {}),
      ...(outcome.invoice?.accessUrl ? { olist_invoice_url: outcome.invoice.accessUrl } : {}),
    }).eq("id", row.id);
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

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRole);
    setOlistCallPriority("background");
    runDeadline = Date.now() + RUN_BUDGET_MS;
    const startedAt = new Date();
    const { data: rows, error } = await admin.from("payments")
      .select("id,provider_payment_id,status,due_date")
      .eq("provider", "olist")
      .in("status", ["pending", "processing", "confirmed", "overdue"])
      .not("provider_payment_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(15);
    if (error) throw error;

    let paid = 0;
    let overdue = 0;
    let pending = 0;
    let failed = 0;
    for (const row of rows || []) {
      if (outOfTime()) break;
      try {
        const account = await getOlistReceivable(String(row.provider_payment_id), token);
        const status = account.status.toLowerCase();
        let updateError: unknown = null;
        if (status === "pago") {
          const result = await admin.from("payments").update({
            status: "received",
            raw_status: status,
            ...(account.boletoUrl ? { provider_payment_url: account.boletoUrl } : {}),
            received_at: new Date().toISOString(),
            is_active: false,
          }).eq("id", row.id);
          updateError = result.error;
          paid++;
        } else if (status === "cancelado" || status === "cancelada") {
          const result = await admin.from("payments").update({
            status: "cancelled",
            raw_status: status,
            ...(account.boletoUrl ? { provider_payment_url: account.boletoUrl } : {}),
            is_active: false,
          }).eq("id", row.id);
          updateError = result.error;
        } else if (status === "parcial") {
          const result = await admin.from("payments").update({
            status: "processing",
            raw_status: status,
            ...(account.boletoUrl ? { provider_payment_url: account.boletoUrl } : {}),
          }).eq("id", row.id);
          updateError = result.error;
          pending++;
        } else {
          const due = dateFromOlist(account.dueDate) ||
            (row.due_date ? new Date(`${row.due_date}T23:59:59-03:00`) : null);
          const nextStatus = due && due.getTime() < Date.now() ? "overdue" : "pending";
          const result = await admin.from("payments").update({
            status: nextStatus,
            raw_status: status,
            ...(account.boletoUrl ? { provider_payment_url: account.boletoUrl } : {}),
          }).eq("id", row.id);
          updateError = result.error;
          if (nextStatus === "overdue") overdue++;
          else pending++;
        }
        if (updateError) throw updateError;
      } catch (entryError) {
        failed++;
        console.error(`Falha ao conciliar conta Olist ${row.provider_payment_id}:`, entryError);
      }
    }
    // Reprocessa NF-e pendentes/rejeitadas de pedidos já concluídos na Shopify.
    // Reaproveita a nota salva; só gera nota quando o pedido ainda não tem uma.
    const invoiceSummary = { checked: 0, issued: 0, pending: 0, rejected: 0 };
    const staleInvoiceClaim = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: invoiceRows, error: invoiceRowsError } = await admin.from("checkout_sessions")
      .select("id,olist_order_id,olist_invoice_id,olist_invoice_number,olist_invoice_status")
      .eq("customer_type", "franchise")
      .eq("status", "credit_approved")
      .not("olist_order_id", "is", null)
      // Status nulo = a emissão nem chegou a ser tentada (ex.: o checkout caiu
      // depois de criar o pedido). Também entra na fila, a partir do piso.
      .or(
        `olist_invoice_status.eq.pending,and(olist_invoice_status.eq.rejected,olist_invoice_checked_at.lt.${dayAgo()}),and(olist_invoice_status.eq.generating,olist_invoice_checked_at.lt.${staleInvoiceClaim}),and(olist_invoice_status.is.null,created_at.gte.${reconciliationStart()})`,
      )
      .order("olist_invoice_checked_at", { ascending: true, nullsFirst: true })
      .limit(8);
    if (invoiceRowsError) console.error("Falha ao listar NF-e pendentes:", invoiceRowsError);
    for (const row of invoiceRows || []) {
      if (outOfTime()) break;
      invoiceSummary.checked++;
      const { data: claimed, error: claimError } = await admin.rpc(
        "claim_olist_invoice_processing",
        { p_session_id: row.id },
      );
      if (claimError) {
        invoiceSummary.rejected++;
        console.error(`Falha ao reservar NF-e da sessão ${row.id}:`, claimError);
        continue;
      }
      // Outro checkout/worker já está gerando ou emitindo esta mesma nota.
      if (!claimed) continue;
      const outcome = await issueFranchiseInvoiceSafely({
        orderId: String(row.olist_order_id),
        token,
        savedInvoice: row.olist_invoice_id
          ? { id: String(row.olist_invoice_id), number: String(row.olist_invoice_number || ""), issued: false }
          : null,
        onInvoiceGenerated: async (generated) => {
          const { error: saveError } = await admin.from("checkout_sessions").update({
            olist_invoice_id: generated.id,
            olist_invoice_number: generated.number,
          }).eq("id", row.id);
          if (saveError) throw saveError;
        },
      });
      invoiceSummary[outcome.status]++;
      if (outcome.error) console.warn(`NF-e da sessão ${row.id} segue pendente:`, outcome.error);
      await admin.from("checkout_sessions").update({
        olist_invoice_status: outcome.status,
        olist_invoice_error: outcome.error ? outcome.error.slice(0, 2000) : null,
        olist_invoice_checked_at: new Date().toISOString(),
        ...(outcome.invoice?.id ? { olist_invoice_id: outcome.invoice.id } : {}),
        ...(outcome.invoice?.number ? { olist_invoice_number: outcome.invoice.number } : {}),
        ...(outcome.invoice?.accessUrl ? { olist_invoice_url: outcome.invoice.accessUrl } : {}),
      }).eq("id", row.id);
    }

    const asaasBridge = await reconcileAsaasPayments(admin, token);
    const customerInvoices = await issueCustomerInvoices(admin, token);
    scheduleSalesSync(serviceRole);
    const result = {
      // Mantém o contrato anterior para quem já monitora a conciliação de
      // franquias; a ponte nova entra em um bloco adicional.
      checked: rows?.length || 0,
      paid,
      overdue,
      pending,
      failed,
      invoices: invoiceSummary,
      asaasBridge,
      customerInvoices,
    };
    // Última execução, para o painel de automações do admin.
    const { error: stateError } = await admin.from("olist_sync_state").upsert({
      key: "reconcile_run",
      value: new Date().toISOString(),
      details: {
        ...result,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        outOfTime: outOfTime(),
        callsPerMinute: olistCallsPerMinute(),
      },
      updated_at: new Date().toISOString(),
    });
    if (stateError) console.error("olist-reconcile-franchise estado:", stateError);
    return jsonResponse(result);
  } catch (error) {
    console.error("olist-reconcile-franchise:", error);
    return errorResponse("Falha ao conciliar contas da Olist", 500);
  }
});
