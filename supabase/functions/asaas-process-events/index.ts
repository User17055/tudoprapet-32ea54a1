import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeadersWith, jsonResponse } from "../_shared/cors.ts";
import {
  mapAsaasPaymentStatus,
  isPaidAsaasProviderStatus,
  isPaidPaymentStatus,
  parseAsaasEvent,
  retryDelaySeconds,
  shouldApplyPaymentStatus,
  type LocalPaymentStatus,
} from "../_shared/payment-events.ts";
import { completeDraftOrder, shopifyAdminToken } from "../_shared/shopify.ts";
import { timingSafeEqual } from "../_shared/webhook.ts";
import { deleteAsaasPayment, getAsaasPayment } from "../_shared/asaas.ts";

interface PaymentRow {
  id: string;
  checkout_session_id: string;
  status: LocalPaymentStatus;
  is_active: boolean;
  provider_payment_id: string | null;
  method: "pix" | "boleto" | "credit_card" | "terms";
  pix_expires_at?: string | null;
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
    .select("id,status,shopify_draft_order_id,shopify_order_id,customer_snapshot")
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
  const shopifyToken = shopifyAdminToken();
  if (!shopifyToken) throw new Error("SHOPIFY_ACCESS_TOKEN ausente");

  const cpfCnpj = (session.customer_snapshot as { cpfCnpj?: string } | null)?.cpfCnpj ?? null;
  const result = await completeDraftOrder(session.shopify_draft_order_id, shopifyToken, false, cpfCnpj);
  if (!result.requestOk || !result.orderId) throw new Error("Falha ao concluir Draft Order Shopify");


  const { error: completedError } = await admin.from("checkout_sessions").update({
    status: "shopify_created",
    shopify_order_id: result.orderId,
  }).eq("id", session.id).is("shopify_order_id", null);
  if (completedError) throw completedError;
}

async function recoverPaidCheckouts(admin: SupabaseClient) {
  const { data, error } = await admin.from("checkout_sessions")
    .select("id")
    .eq("status", "paid_pending_shopify")
    .is("shopify_order_id", null)
    .order("updated_at", { ascending: true })
    .limit(25);
  if (error) throw error;

  let recovered = 0;
  let skipped = 0;
  let failed = 0;
  for (const session of data ?? []) {
    try {
      const { data: payment, error: paymentError } = await admin.from("payments")
        .select("id,checkout_session_id,status,is_active,provider_payment_id,method,pix_expires_at")
        .eq("checkout_session_id", session.id)
        .not("provider_payment_id", "is", null)
        .order("attempt_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (paymentError) throw paymentError;
      if (!payment?.provider_payment_id) {
        skipped++;
        console.error(`Checkout ${session.id} sem cobrança Asaas para validar recuperação`);
        continue;
      }

      // Nunca confie apenas no estado local ao recuperar uma venda. O Asaas é a
      // autoridade financeira e pode ter recebido um estorno/chargeback enquanto
      // o worker estava indisponível.
      const remote = await getAsaasPayment(payment.provider_payment_id);
      const remoteStatus = String(remote.status || "").toUpperCase();
      if (!isPaidAsaasProviderStatus(remoteStatus)) {
        const remoteLocalStatus = mapAsaasPaymentStatus("", remoteStatus);
        if (remoteLocalStatus && ["refunded", "chargeback", "cancelled", "failed"].includes(remoteLocalStatus)) {
          const { error: paymentUpdateError } = await admin.from("payments").update({
            status: remoteLocalStatus,
            raw_status: remoteStatus,
            is_active: false,
          }).eq("id", payment.id);
          if (paymentUpdateError) throw paymentUpdateError;

          const sessionStatus = remoteLocalStatus === "failed" ? "failed" : "cancelled";
          const { error: sessionUpdateError } = await admin.from("checkout_sessions")
            .update({ status: sessionStatus })
            .eq("id", session.id)
            .is("shopify_order_id", null);
          if (sessionUpdateError) throw sessionUpdateError;
        }
        skipped++;
        console.error(
          `Recuperação bloqueada para checkout ${session.id}: Asaas ${remoteStatus || "SEM_STATUS"}`,
        );
        continue;
      }

      await finalizePaidCheckout(admin, payment as PaymentRow);
      recovered++;
    } catch (recoveryError) {
      failed++;
      console.error(`Falha ao recuperar checkout pago ${session.id}:`, recoveryError);
    }
  }
  return { checked: (data ?? []).length, recovered, skipped, failed };
}

async function reconcileOpenPixPayments(admin: SupabaseClient) {
  const { data, error } = await admin.from("payments")
    .select("id,checkout_session_id,status,is_active,provider_payment_id,method,pix_expires_at")
    .eq("is_active", true)
    // Tambem reconcilia cartoes: uma aprovacao pode ter sido persistida sem que
    // o disparo em background conseguisse concluir o draft na Shopify.
    .in("status", ["pending", "processing", "confirmed"])
    .not("provider_payment_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(25);
  if (error) throw error;

  let paid = 0;
  let pending = 0;
  let failed = 0;
  for (const row of (data ?? []) as PaymentRow[]) {
    try {
      const remote = await getAsaasPayment(row.provider_payment_id!);
      const remoteStatus = String(remote.status || "").toUpperCase();
      if (isPaidAsaasProviderStatus(remoteStatus)) {
        const localStatus = remoteStatus === "CONFIRMED" ? "confirmed" : "received";
        await settlePaidPayment(admin, row, localStatus, remoteStatus);
        paid++;
      } else {
        pending++;
      }
    } catch (reconciliationError) {
      failed++;
      console.error(`Falha ao conciliar Pix ${row.id}:`, reconciliationError);
    }
  }
  return { checked: (data ?? []).length, paid, pending, failed };
}

async function flagDuplicatePayment(admin: SupabaseClient, payment: PaymentRow) {
  const { data: another, error } = await admin.from("payments")
    .select("id")
    .eq("checkout_session_id", payment.checkout_session_id)
    .in("status", ["confirmed", "received"])
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

async function settlePaidPayment(
  admin: SupabaseClient,
  payment: PaymentRow,
  status: "confirmed" | "received",
  rawStatus: string,
) {
  const now = new Date().toISOString();
  const { error: updateError } = await admin.from("payments").update({
    status,
    raw_status: rawStatus,
    is_active: false,
    ...(status === "confirmed" ? { confirmed_at: now } : { received_at: now }),
  }).eq("id", payment.id);
  if (updateError) throw updateError;

  const paid = { ...payment, status, is_active: false };
  const duplicate = await flagDuplicatePayment(admin, paid);
  await enqueueCancellationOfOtherAttempts(admin, paid);
  if (!duplicate) await finalizePaidCheckout(admin, paid);
}

async function processCancellationAction(admin: SupabaseClient, action: ActionRow) {
  const { data: payment, error } = await admin.from("payments")
    .select("id,checkout_session_id,status,is_active,provider_payment_id,method,pix_expires_at")
    .eq("id", action.payment_id)
    .single();
  if (error) throw error;

  if (["received", "confirmed"].includes(payment.status)) {
    await settlePaidPayment(
      admin,
      payment as PaymentRow,
      payment.status as "confirmed" | "received",
      String(payment.status).toUpperCase(),
    );
    return;
  }
  if (["refunded", "chargeback"].includes(payment.status)) {
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
  if (isPaidAsaasProviderStatus(remoteStatus)) {
    const localStatus = remoteStatus === "RECEIVED" || remoteStatus === "RECEIVED_IN_CASH"
      ? "received"
      : "confirmed";
    await settlePaidPayment(admin, payment as PaymentRow, localStatus, remoteStatus);
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

async function expirePixPayments(admin: SupabaseClient) {
  const now = new Date().toISOString();
  const { data, error } = await admin.from("payments")
    .select("id,checkout_session_id,status,is_active,provider_payment_id,method,pix_expires_at")
    .eq("method", "pix")
    .eq("is_active", true)
    .in("status", ["pending", "processing"])
    .not("pix_expires_at", "is", null)
    .lte("pix_expires_at", now)
    .order("pix_expires_at", { ascending: true })
    .limit(25);
  if (error) throw error;

  let paid = 0;
  let queued = 0;
  let failed = 0;
  for (const row of (data ?? []) as PaymentRow[]) {
    try {
      if (!row.provider_payment_id) {
        await admin.from("payments").update({ status: "cancelled", is_active: false })
          .eq("id", row.id).in("status", ["pending", "processing"]);
        await admin.from("checkout_sessions").update({ status: "expired" })
          .eq("id", row.checkout_session_id).in("status", ["awaiting_payment", "payment_processing"]);
        queued++;
        continue;
      }

      const remote = await getAsaasPayment(row.provider_payment_id);
      const remoteStatus = String(remote.status || "").toUpperCase();
      if (isPaidAsaasProviderStatus(remoteStatus)) {
        const localStatus = remoteStatus === "CONFIRMED" ? "confirmed" : "received";
        const reconciliationId = `reconcile:${row.provider_payment_id}:${remoteStatus}`;
        const { error: eventError } = await admin.from("payment_events").upsert({
          provider: "asaas",
          provider_event_id: reconciliationId,
          provider_payment_id: row.provider_payment_id,
          event_type: `PAYMENT_${remoteStatus}`,
          payload: {
            id: reconciliationId,
            event: `PAYMENT_${remoteStatus}`,
            payment: {
              id: row.provider_payment_id,
              status: remoteStatus,
              externalReference: remote.externalReference || null,
            },
          },
        }, { onConflict: "provider,provider_event_id", ignoreDuplicates: true });
        if (eventError) throw eventError;
        await settlePaidPayment(admin, row, localStatus, remoteStatus);
        paid++;
        continue;
      }

      if (!["PENDING", "OVERDUE"].includes(remoteStatus)) {
        throw new Error(`Cobrança expirada com status inesperado: ${remoteStatus || "vazio"}`);
      }

      const { error: paymentError } = await admin.from("payments")
        .update({ status: "cancellation_requested" })
        .eq("id", row.id)
        .in("status", ["pending", "processing"]);
      if (paymentError) throw paymentError;
      const { error: sessionError } = await admin.from("checkout_sessions")
        .update({ status: "expired" })
        .eq("id", row.checkout_session_id)
        .in("status", ["awaiting_payment", "payment_processing"]);
      if (sessionError) throw sessionError;
      const { error: actionError } = await admin.from("payment_actions").upsert({
        payment_id: row.id,
        action_type: "cancel_provider_charge",
        status: "PENDING",
        next_attempt_at: now,
      }, { onConflict: "payment_id,action_type", ignoreDuplicates: true });
      if (actionError) throw actionError;
      queued++;
    } catch (expirationError) {
      failed++;
      console.error(`Falha ao expirar Pix ${row.id}:`, expirationError);
    }
  }
  return { claimed: (data ?? []).length, paid, queued, failed };
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

  if (isPaidPaymentStatus(next) && !["refunded", "chargeback"].includes(payment.status)) {
    await settlePaidPayment(
      admin,
      payment,
      next,
      parsed.providerStatus || parsed.eventType,
    );
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersWith("x-payment-worker-token") });
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido" }, 405);

  const expected = Deno.env.get("PAYMENT_WORKER_TOKEN") || "";
  const received = req.headers.get("x-payment-worker-token") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const workerAuthorized = Boolean(expected && timingSafeEqual(expected, received));
  const cronAuthorized = Boolean(serviceRole && timingSafeEqual(serviceRole, bearer));
  if (!workerAuthorized && !cronAuthorized) {
    return jsonResponse({ error: "Não autorizado" }, 401);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let expirations;
  try {
    expirations = await expirePixPayments(admin);
  } catch (expirationError) {
    console.error("Falha ao expirar cobranças Pix:", expirationError);
    return jsonResponse({ error: "Falha ao expirar cobranças Pix" }, 500);
  }
  let actions;
  try {
    actions = await processActions(admin);
  } catch (actionError) {
    console.error("Falha ao reivindicar ações financeiras:", actionError);
      return jsonResponse({ error: "Falha ao processar ações financeiras" }, 500);
  }
  let reconciliation;
  let recovery;
  try {
    reconciliation = await reconcileOpenPixPayments(admin);
    recovery = await recoverPaidCheckouts(admin);
  } catch (reconciliationError) {
    console.error("Falha na conciliação financeira:", reconciliationError);
    return jsonResponse({ error: "Falha na conciliação financeira" }, 500);
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

  return jsonResponse({
    events: { claimed: (data ?? []).length, processed, failed },
    actions,
    expirations,
    reconciliation,
    recovery,
  });
});
