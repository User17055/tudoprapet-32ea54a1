import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { errorResponse, jsonResponse } from "../_shared/cors.ts";
import {
  ensureOlistOrderReceivable,
  findImportedOlistOrders,
  getOlistOrderReconciliationDetails,
  getOlistReceivable,
  issueFranchiseInvoiceSafely,
  olistExternalReferenceMatches,
  settleOlistReceivable,
} from "../_shared/olist.ts";
import { getShopifyOrderReference, shopifyAdminToken } from "../_shared/shopify.ts";

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

class AwaitingOlistImportError extends Error {
  constructor() {
    super("Pedido pago ainda não foi importado da Shopify para a Olist");
    this.name = "AwaitingOlistImportError";
  }
}

interface BridgeSession {
  id: string;
  customer_type: "common" | "subscriber";
  shopify_order_id: string;
  olist_order_id: string | null;
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
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60_000).toISOString();
  const { data: sessions, error } = await admin.from("checkout_sessions")
    .select(
      "id,customer_type,shopify_order_id,olist_order_id,olist_receivable_id,olist_payment_sync_attempts,total,customer_snapshot",
    )
    .in("customer_type", ["common", "subscriber"])
    .eq("status", "shopify_created")
    .not("shopify_order_id", "is", null)
    .is("olist_payment_synced_at", null)
    .gte("created_at", cutoff)
    .or(`olist_payment_sync_next_attempt_at.is.null,olist_payment_sync_next_attempt_at.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(20);
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
    const payment = paymentBySession.get(session.id);
    const shopify = references.get(session.id);
    if (!payment || !shopify) continue;
    const attempt = Number(session.olist_payment_sync_attempts || 0) + 1;
    try {
      if (shopify.financialStatus && shopify.financialStatus !== "paid") {
        throw new Error(`Shopify não confirma pedido como pago (${shopify.financialStatus})`);
      }
      const imported = session.olist_order_id
        ? importedOrders.find((order) => order.id === String(session.olist_order_id))
        : importedOrders.find((order) =>
          olistExternalReferenceMatches(order.externalReference, [
            shopify.id,
            shopify.name,
            shopify.orderNumber,
          ])
        );
      if (!imported) {
        awaitingImport++;
        throw new AwaitingOlistImportError();
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
        olist_payment_sync_next_attempt_at: retryAt(attempt),
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!serviceRole || bearer !== serviceRole) return errorResponse("Não autorizado", 401);
  const token = Deno.env.get("OLIST_API_TOKEN") || Deno.env.get("TINY_API_TOKEN") || "";
  if (!token) return errorResponse("OLIST_API_TOKEN não configurado", 503);

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRole);
    const { data: rows, error } = await admin.from("payments")
      .select("id,provider_payment_id,status,due_date")
      .eq("provider", "olist")
      .in("status", ["pending", "processing", "confirmed", "overdue"])
      .not("provider_payment_id", "is", null)
      .order("created_at", { ascending: true })
      .limit(40);
    if (error) throw error;

    let paid = 0;
    let overdue = 0;
    let pending = 0;
    let failed = 0;
    for (const row of rows || []) {
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
    const { data: invoiceRows, error: invoiceRowsError } = await admin.from("checkout_sessions")
      .select("id,olist_order_id,olist_invoice_id,olist_invoice_number")
      .eq("customer_type", "franchise")
      .eq("status", "credit_approved")
      .not("olist_order_id", "is", null)
      .in("olist_invoice_status", ["pending", "rejected"])
      .order("olist_invoice_checked_at", { ascending: true, nullsFirst: true })
      .limit(15);
    if (invoiceRowsError) console.error("Falha ao listar NF-e pendentes:", invoiceRowsError);
    for (const row of invoiceRows || []) {
      invoiceSummary.checked++;
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
        olist_invoice_checked_at: new Date().toISOString(),
        ...(outcome.invoice?.id ? { olist_invoice_id: outcome.invoice.id } : {}),
        ...(outcome.invoice?.number ? { olist_invoice_number: outcome.invoice.number } : {}),
        ...(outcome.invoice?.accessUrl ? { olist_invoice_url: outcome.invoice.accessUrl } : {}),
      }).eq("id", row.id);
    }

    const asaasBridge = await reconcileAsaasPayments(admin, token);
    return jsonResponse({
      // Mantém o contrato anterior para quem já monitora a conciliação de
      // franquias; a ponte nova entra em um bloco adicional.
      checked: rows?.length || 0,
      paid,
      overdue,
      pending,
      failed,
      invoices: invoiceSummary,
      asaasBridge,
    });
  } catch (error) {
    console.error("olist-reconcile-franchise:", error);
    return errorResponse("Falha ao conciliar contas da Olist", 500);
  }
});
