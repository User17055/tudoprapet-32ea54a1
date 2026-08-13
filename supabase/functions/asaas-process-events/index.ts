import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeadersWith, jsonResponse } from "../_shared/cors.ts";
import {
  mapAsaasPaymentStatus,
  parseAsaasEvent,
  retryDelaySeconds,
  shouldApplyPaymentStatus,
  type LocalPaymentStatus,
} from "../_shared/payment-events.ts";
import { completeDraftOrder } from "../_shared/shopify.ts";
import { timingSafeEqual } from "../_shared/webhook.ts";
import { deleteAsaasPayment, getAsaasPayment } from "../_shared/asaas.ts";

interface PaymentRow {
  id: string;
  checkout_session_id: string;
  status: LocalPaymentStatus;
  is_active: boolean;
  provider_payment_id: string | null;
  method: "pix" | "boleto" | "credit_card" | "terms";
}

interface EventRow {
  id: string;
  attempts: number;
  payload: Record<string, unknown>;
}

interface ActionRow {
  id: string;
  payment_id: string;
  action_type: "cancel_provider_charge" | "refund_duplicate";
  attempts: number;
}

async function findPayment(admin: SupabaseClient, parsed: ReturnType<typeof parseAsaasEvent>) {
  if (!parsed) return null;
  if (parsed.providerPaymentId) {
    const { data } = await admin.from("payments").select("*")
      .eq("provider_payment_id", parsed.providerPaymentId).maybeSingle();
    if (data) return data as PaymentRow;
  }
  if (parsed.externalReference) {
    const { data } = await admin.from("payments").select("*")
      .eq("external_reference", parsed.externalReference).maybeSingle();
    if (data) return data as PaymentRow;
  }
  return null;
}

async function enqueueCancellationOfOtherAttempts(
  admin: SupabaseClient,
  paid: PaymentRow,
) {
  const { data: others, error } = await admin.from("payments")
    .select("id")
    .eq("checkout_session_id", paid.checkout_session_id)
    .neq("id", paid.id)
    .eq("is_active", true)
    .in("status", ["pending", "processing"]);
  if (error) throw error;

  for (const other of others ?? []) {
    const { error: updateError } = await admin.from("payments").update({
      status: "cancellation_requested",
    }).eq("id", other.id);
    if (updateError) throw updateError;

    const { error: actionError } = await admin.from("payment_actions").upsert({
      payment_id: other.id,
      action_type: "cancel_provider_charge",
      status: "PENDING",
      next_attempt_at: new Date().toISOString(),
    }, { onConflict: "payment_id,action_type", ignoreDuplicates: true });
    if (actionError) throw actionError;
  }
}

async function finalizePaidCheckout(admin: SupabaseClient, payment: PaymentRow) {
  const { data: session, error } = await admin.from("checkout_sessions")
    .select("id,status,shopify_draft_order_id,shopify_order_id")
    .eq("id", payment.checkout_session_id)
    .single();
  if (error) throw error;

  if (session.shopify_order_id || session.status === "shopify_created") return;

  const { error: markPaidError } = await admin.from("checkout_sessions")
    .update({ status: "paid_pending_shopify" })
    .eq("id", session.id)
    .is("shopify_order_id", null);
  if (markPaidError) throw markPaidError;

  if (!session.shopify_draft_order_id) {
    throw new Error("Pagamento recebido sem Draft Order Shopify");
  }
  const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN") || "";
  if (!shopifyToken) throw new Error("SHOPIFY_ACCESS_TOKEN ausente");

  const result = await completeDraftOrder(session.shopify_draft_order_id, shopifyToken);
  if (!result.requestOk || !result.orderId) throw new Error("Falha ao concluir Draft Order Shopify");

  const { error: completedError } = await admin.from("checkout_sessions").update({
    status: "shopify_created",
    shopify_order_id: result.orderId,
  }).eq("id", session.id).is("shopify_order_id", null);
  if (completedError) throw completedError;
}

async function flagDuplicatePayment(admin: SupabaseClient, payment: PaymentRow) {
  const { data: another, error } = await admin.from("payments")
    .select("id")
    .eq("checkout_session_id", payment.checkout_session_id)
    .eq("status", "received")
    .neq("id", payment.id)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!another) return false;

  const { error: actionError } = await admin.from("payment_actions").upsert({
    payment_id: payment.id,
    action_type: "refund_duplicate",
    status: "REVIEW_REQUIRED",
    processing_error: "Pagamento duplicado: revisão e estorno pelo Financeiro",
  }, { onConflict: "payment_id,action_type", ignoreDuplicates: true });
  if (actionError) throw actionError;
  return true;
}

async function processCancellationAction(admin: SupabaseClient, action: ActionRow) {
  const { data: payment, error } = await admin.from("payments")
    .select("id,status,provider_payment_id")
    .eq("id", action.payment_id)
    .single();
  if (error) throw error;

  if (["received", "confirmed", "refunded", "chargeback"].includes(payment.status)) {
    // A corrida foi vencida pelo pagamento; o webhook é a autoridade financeira.
    return;
  }
  if (!payment.provider_payment_id) {
    const { error: updateError } = await admin.from("payments").update({
      status: "cancelled",
      is_active: false,
      provider_deleted_at: new Date().toISOString(),
    }).eq("id", payment.id);
    if (updateError) throw updateError;
    return;
  }

  const remote = await getAsaasPayment(payment.provider_payment_id);
  const remoteStatus = String(remote.status || "").toUpperCase();
  if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(remoteStatus)) {
    const localStatus = remoteStatus === "RECEIVED" || remoteStatus === "RECEIVED_IN_CASH"
      ? "received"
      : "confirmed";
    const { error: paidError } = await admin.from("payments").update({
      status: localStatus,
      is_active: localStatus !== "received",
      raw_status: remoteStatus,
      ...(localStatus === "received" ? { received_at: new Date().toISOString() } : {}),
    }).eq("id", payment.id);
    if (paidError) throw paidError;
    return;
  }

  const deleted = await deleteAsaasPayment(payment.provider_payment_id);
  if (!deleted.deleted) throw new Error("Asaas não confirmou exclusão da cobrança");
  const { error: cancelledError } = await admin.from("payments").update({
    status: "cancelled",
    is_active: false,
    provider_deleted_at: new Date().toISOString(),
  }).eq("id", payment.id);
  if (cancelledError) throw cancelledError;
}

async function processActions(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("claim_payment_actions", { p_limit: 25 });
  if (error) throw error;
  let processed = 0;
  let failed = 0;

  for (const action of (data ?? []) as ActionRow[]) {
    try {
      if (action.action_type === "cancel_provider_charge") {
        await processCancellationAction(admin, action);
      } else {
        throw new Error("Ação financeira exige revisão humana");
      }
      const { error: doneError } = await admin.from("payment_actions").update({
        status: "PROCESSED",
        processed_at: new Date().toISOString(),
        locked_at: null,
        next_attempt_at: null,
        processing_error: null,
      }).eq("id", action.id);
      if (doneError) throw doneError;
      processed++;
    } catch (actionError) {
      failed++;
      const message = actionError instanceof Error ? actionError.message : String(actionError);
      const delay = retryDelaySeconds(action.attempts);
      await admin.from("payment_actions").update({
        status: "ERROR",
        locked_at: null,
        processing_error: message.slice(0, 2000),
        next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
      }).eq("id", action.id);
    }
  }
  return { claimed: (data ?? []).length, processed, failed };
}

async function processEvent(admin: SupabaseClient, row: EventRow) {
  const parsed = parseAsaasEvent(row.payload);
  if (!parsed) throw new Error("Payload Asaas inválido na inbox");
  const next = mapAsaasPaymentStatus(parsed.eventType, parsed.providerStatus);
  const payment = await findPayment(admin, parsed);

  // O webhook pode receber outros pagamentos da mesma conta. Não é erro da fila.
  if (!payment || !next) return;

  if (shouldApplyPaymentStatus(payment.status, next)) {
    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      status: next,
      raw_status: parsed.providerStatus || parsed.eventType,
    };
    if (next === "confirmed") update.confirmed_at = now;
    if (next === "received") {
      update.received_at = now;
      update.is_active = false;
    }
    if (["cancelled", "failed", "refunded", "chargeback"].includes(next)) update.is_active = false;

    const { error } = await admin.from("payments").update(update).eq("id", payment.id);
    if (error) throw error;
  }

  if (next === "received") {
    const duplicate = await flagDuplicatePayment(admin, payment);
    await enqueueCancellationOfOtherAttempts(admin, payment);
    if (!duplicate) await finalizePaidCheckout(admin, payment);
  } else if (next === "confirmed" && payment.method === "credit_card") {
    await finalizePaidCheckout(admin, payment);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersWith("x-payment-worker-token") });
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido" }, 405);

  const expected = Deno.env.get("PAYMENT_WORKER_TOKEN") || "";
  const received = req.headers.get("x-payment-worker-token") || "";
  if (!expected || !timingSafeEqual(expected, received)) {
    return jsonResponse({ error: "Não autorizado" }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let actions;
  try {
    actions = await processActions(admin);
  } catch (actionError) {
    console.error("Falha ao reivindicar ações financeiras:", actionError);
    return jsonResponse({ error: "Falha ao processar ações financeiras" }, 500);
  }
  const { data, error } = await admin.rpc("claim_payment_events", { p_limit: 25 });
  if (error) return jsonResponse({ error: "Falha ao reivindicar eventos" }, 500);

  let processed = 0;
  let failed = 0;
  for (const row of (data ?? []) as EventRow[]) {
    try {
      await processEvent(admin, row);
      const { error: doneError } = await admin.from("payment_events").update({
        status: "PROCESSED",
        processed_at: new Date().toISOString(),
        locked_at: null,
        next_attempt_at: null,
        processing_error: null,
      }).eq("id", row.id);
      if (doneError) throw doneError;
      processed++;
    } catch (eventError) {
      failed++;
      const message = eventError instanceof Error ? eventError.message : String(eventError);
      const delay = retryDelaySeconds(row.attempts);
      await admin.from("payment_events").update({
        status: "ERROR",
        locked_at: null,
        processing_error: message.slice(0, 2000),
        next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
      }).eq("id", row.id);
      console.error(`Evento ${row.id} falhou:`, message);
    }
  }

  return jsonResponse({ events: { claimed: (data ?? []).length, processed, failed }, actions });
});
