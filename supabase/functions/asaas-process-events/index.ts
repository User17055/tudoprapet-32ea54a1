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
import { taxCredentialGapMessage, writeCheckoutAttemptLog } from "../_shared/checkout-log.ts";
import { timingSafeEqual } from "../_shared/webhook.ts";
import {
  type AsaasBudget,
  AsaasBudgetExhausted,
  asaasCallsUsed,
  createAsaasBudget,
  deleteAsaasPayment,
  getAsaasPayment,
  isAsaasBudgetExhausted,
} from "../_shared/asaas.ts";

// Nome do lease em worker_leases. Cobre so o bloco agendado (expiracao,
// conciliacao e recuperacao): fila de eventos e de acoes ja tem trava por linha
// via claim_payment_events/claim_payment_actions e precisa continuar respondendo
// a webhook sem esperar ninguem.
const RECONCILIATION_LEASE = "asaas-reconciliation";
// Acima do tempo que uma rodada leva, abaixo do intervalo do cron: se o worker
// morrer no meio, o lease expira antes da proxima batida.
const RECONCILIATION_LEASE_SECONDS = 300;
// Intervalo minimo entre duas conciliacoes, qualquer que seja a origem. O cron
// roda a cada 10 min, entao isto nunca recusa uma batida legitima -- serve para
// uma rajada de `manual` nao virar rajada de chamadas ao Asaas.
const RECONCILIATION_COOLDOWN_SECONDS = 60;

// Teto de chamadas ao Asaas por execucao do worker.
//
// As tres varreduras juntas podem querer ate 75; o que passar do teto fica para
// a proxima rodada, porque a fila e duravel e nada se perde -- so distribui.
//
// ATENCAO ao ler isto como teto da conta, porque nao e. So o caminho agendado
// tem frequencia conhecida, e so nele o teto vira taxa:
//
//   conciliacao agendada  cron */10 -> 6 execucoes/h x 40 = 240 chamadas/h
//
//   fila de acoes         acordada por webhook, frequencia ditada pelo volume
//                         de pagamentos. Cada execucao respeita o teto de 40,
//                         mas o numero de execucoes por hora nao tem teto --
//                         o que limita na pratica e existirem acoes pendentes.
//
//   checkout              createAsaasPayment, getAsaasPixQrCode e
//                         findOrCreateAsaasCustomer nao recebem orcamento e
//                         estao fora desta conta de proposito: sao cliente real
//                         esperando na tela.
//
// Ou seja, 240/h e o piso garantido de consumo do agendado, nao o total da
// conta. Para saber o total e preciso somar checkout e acoes, que dependem do
// volume de vendas -- e o `asaas.calls` que a resposta devolve existe para isso.
const ASAAS_CALL_BUDGET = 40;

// Idade minima para conciliar uma cobranca em aberto. O webhook e o caminho
// principal e chega em segundos; consultar uma cobranca criada agora e gastar
// requisicao para confirmar o que ja esta a caminho. A conciliacao so existe
// para o caso em que o webhook falhou, e isso so se sabe depois de esperar.
const RECONCILE_MIN_AGE_MS = 3 * 60_000;

function isBudgetError(error: unknown): boolean {
  return error instanceof AsaasBudgetExhausted;
}

// So a funcao inexistente pode passar batido, e so durante o rollout. Erro de
// permissao, timeout ou banco fora tem de cancelar a varredura: sao situacoes
// desconhecidas, e varrer sem exclusao mutua e o cenario caro.
//
// PGRST202 e o PostgREST nao achando a funcao no cache de schema; 42883 e o
// undefined_function do proprio Postgres. A checagem por mensagem existe porque
// nem toda versao devolve codigo, e exige o nome da funcao para nao engolir um
// "does not exist" de outra coisa.
function isMissingRpc(error: { code?: string; message?: string }, fnName: string): boolean {
  if (error.code === "PGRST202" || error.code === "42883") return true;
  const message = (error.message ?? "").toLowerCase();
  if (!message.includes(fnName.toLowerCase())) return false;
  return message.includes("could not find") ||
    message.includes("does not exist") ||
    message.includes("nao existe");
}

interface PaymentRow {
  id: string;
  checkout_session_id: string;
  status: LocalPaymentStatus;
  is_active: boolean;
  provider_payment_id: string | null;
  method: "pix" | "boleto" | "credit_card" | "debit_card" | "terms";
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

function providerRetryDelay(error: unknown, attempt: number): number {
  const retryAfter = (error as { retryAfterSeconds?: number } | null)?.retryAfterSeconds;
  return typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.ceil(retryAfter)
    : retryDelaySeconds(attempt);
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

  // Este é o caminho dominante do Pix: quem confirma é o webhook, não a tela.
  // Medir só pelo checkout-payment mediria a porta errada.
  if (result.taxCredentialStored === false) {
    await writeCheckoutAttemptLog(admin, {
      checkoutSessionId: session.id,
      stage: "shopify_completion",
      success: true,
      errorMessage: taxCredentialGapMessage(result.taxCredentialError),
      metadata: { shopifyOrderId: result.orderId, taxCredentialStored: false },
    });
  }


  const { error: completedError } = await admin.from("checkout_sessions").update({
    status: "shopify_created",
    shopify_order_id: result.orderId,
  }).eq("id", session.id).is("shopify_order_id", null);
  if (completedError) throw completedError;
}

async function recoverPaidCheckouts(admin: SupabaseClient, budget: AsaasBudget) {
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
  let budgetExhausted = false;
  for (const session of data ?? []) {
    if (isAsaasBudgetExhausted(budget)) {
      budgetExhausted = true;
      break;
    }
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
      const remote = await getAsaasPayment(payment.provider_payment_id, budget);
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
      if (isBudgetError(recoveryError)) {
        budgetExhausted = true;
        break;
      }
      failed++;
      console.error(`Falha ao recuperar checkout pago ${session.id}:`, recoveryError);
    }
  }
  return { checked: (data ?? []).length, recovered, skipped, failed, budgetExhausted };
}

async function reconcileOpenPixPayments(admin: SupabaseClient, budget: AsaasBudget) {
  const { data, error } = await admin.from("payments")
    .select("id,checkout_session_id,status,is_active,provider_payment_id,method,pix_expires_at")
    .eq("is_active", true)
    // Tambem reconcilia cartoes: uma aprovacao pode ter sido persistida sem que
    // o disparo em background conseguisse concluir o draft na Shopify.
    .in("status", ["pending", "processing", "confirmed"])
    .not("provider_payment_id", "is", null)
    // Cobranca recem-criada nao entra: o webhook chega antes e consultar aqui
    // seria gastar requisicao para confirmar o que ja esta a caminho.
    .lt("created_at", new Date(Date.now() - RECONCILE_MIN_AGE_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(25);
  if (error) throw error;

  let paid = 0;
  let pending = 0;
  let failed = 0;
  let budgetExhausted = false;
  for (const row of (data ?? []) as PaymentRow[]) {
    if (isAsaasBudgetExhausted(budget)) {
      budgetExhausted = true;
      break;
    }
    try {
      const remote = await getAsaasPayment(row.provider_payment_id!, budget);
      const remoteStatus = String(remote.status || "").toUpperCase();
      if (isPaidAsaasProviderStatus(remoteStatus)) {
        const localStatus = remoteStatus === "CONFIRMED" ? "confirmed" : "received";
        await settlePaidPayment(admin, row, localStatus, remoteStatus);
        paid++;
      } else {
        pending++;
      }
    } catch (reconciliationError) {
      if (isBudgetError(reconciliationError)) {
        budgetExhausted = true;
        break;
      }
      failed++;
      console.error(`Falha ao conciliar Pix ${row.id}:`, reconciliationError);
    }
  }
  return { checked: (data ?? []).length, paid, pending, failed, budgetExhausted };
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

async function processCancellationAction(admin: SupabaseClient, action: ActionRow, budget: AsaasBudget) {
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

  const remote = await getAsaasPayment(payment.provider_payment_id, budget);
  const remoteStatus = String(remote.status || "").toUpperCase();
  if (isPaidAsaasProviderStatus(remoteStatus)) {
    const localStatus = remoteStatus === "RECEIVED" || remoteStatus === "RECEIVED_IN_CASH"
      ? "received"
      : "confirmed";
    await settlePaidPayment(admin, payment as PaymentRow, localStatus, remoteStatus);
    return;
  }

  const deleted = await deleteAsaasPayment(payment.provider_payment_id, budget);
  if (!deleted.deleted) throw new Error("Asaas não confirmou exclusão da cobrança");
  const { error: cancelledError } = await admin.from("payments").update({
    status: "cancelled",
    is_active: false,
    provider_deleted_at: new Date().toISOString(),
  }).eq("id", payment.id);
  if (cancelledError) throw cancelledError;
}

async function expirePixPayments(admin: SupabaseClient, budget: AsaasBudget) {
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
  let budgetExhausted = false;
  for (const row of (data ?? []) as PaymentRow[]) {
    if (isAsaasBudgetExhausted(budget)) {
      budgetExhausted = true;
      break;
    }
    try {
      if (!row.provider_payment_id) {
        await admin.from("payments").update({ status: "cancelled", is_active: false })
          .eq("id", row.id).in("status", ["pending", "processing"]);
        await admin.from("checkout_sessions").update({ status: "expired" })
          .eq("id", row.checkout_session_id).in("status", ["awaiting_payment", "payment_processing"]);
        queued++;
        continue;
      }

      const remote = await getAsaasPayment(row.provider_payment_id, budget);
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
      if (isBudgetError(expirationError)) {
        budgetExhausted = true;
        break;
      }
      failed++;
      console.error(`Falha ao expirar Pix ${row.id}:`, expirationError);
    }
  }
  return { claimed: (data ?? []).length, paid, queued, failed, budgetExhausted };
}

async function processActions(admin: SupabaseClient, budget: AsaasBudget) {
  const { data, error } = await admin.rpc("claim_payment_actions", { p_limit: 25 });
  if (error) throw error;
  let processed = 0;
  let failed = 0;
  let budgetExhausted = false;

  for (const action of (data ?? []) as ActionRow[]) {
    if (isAsaasBudgetExhausted(budget)) {
      // O que ja foi reivindicado e nao coube no orcamento volta para a fila
      // agora, em vez de esperar a janela de reivindicacao de linha travada.
      budgetExhausted = true;
      await admin.from("payment_actions").update({
        status: "PENDING",
        locked_at: null,
      }).eq("id", action.id).eq("status", "PROCESSING");
      continue;
    }
    try {
      if (action.action_type === "cancel_provider_charge") {
        await processCancellationAction(admin, action, budget);
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
      if (isBudgetError(actionError)) {
        // Nao conta como falha nem incrementa a espera: nao foi a acao que deu
        // errado, foi a rodada que acabou.
        budgetExhausted = true;
        await admin.from("payment_actions").update({
          status: "PENDING",
          locked_at: null,
        }).eq("id", action.id).eq("status", "PROCESSING");
        continue;
      }
      failed++;
      const message = actionError instanceof Error ? actionError.message : String(actionError);
      const delay = providerRetryDelay(actionError, action.attempts);
      await admin.from("payment_actions").update({
        status: "ERROR",
        locked_at: null,
        processing_error: message.slice(0, 2000),
        next_attempt_at: new Date(Date.now() + delay * 1000).toISOString(),
      }).eq("id", action.id);
    }
  }
  return { claimed: (data ?? []).length, processed, failed, budgetExhausted };
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

  const requestBody = await req.json().catch(() => ({})) as Record<string, unknown>;
  const source = typeof requestBody.source === "string" ? requestBody.source : "unknown";
  const runScheduledReconciliation = source === "pg_cron" || source === "manual";

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Um orcamento por requisicao, criado aqui e passado adiante. Nao pode ser
  // estado de modulo: duas requisicoes no mesmo isolate zerariam o contador uma
  // da outra.
  const budget = createAsaasBudget(ASAAS_CALL_BUDGET);

  // Exclusao mutua so para o bloco agendado, que e o unico que varre tabelas
  // inteiras. Fila de eventos e de acoes tem trava por linha e segue livre, para
  // que um webhook nao fique esperando uma conciliacao terminar.
  let leaseRunId: string | null = null;
  let leaseBusy = false;
  let leaseFailed = false;
  if (runScheduledReconciliation) {
    const { data: claimed, error: leaseError } = await admin.rpc("claim_worker_lease", {
      p_name: RECONCILIATION_LEASE,
      p_lease_seconds: RECONCILIATION_LEASE_SECONDS,
      p_cooldown_seconds: RECONCILIATION_COOLDOWN_SECONDS,
    });
    if (leaseError && isMissingRpc(leaseError, "claim_worker_lease")) {
      // Unica falha que passa: a janela do rollout, entre o deploy da funcao e o
      // da migration. Aqui seguir sem lease e seguro porque e o comportamento
      // que ja estava em producao, e a janela e curta e conhecida.
      console.warn(
        "claim_worker_lease ainda nao existe (rollout em andamento); conciliacao segue sem exclusao mutua",
      );
    } else if (leaseError) {
      // Qualquer outro erro -- permissao, timeout, banco indisponivel -- e
      // desconhecido, e varrer sem exclusao mutua e o cenario que multiplica
      // chamadas ao Asaas. Cancela a varredura e alerta. As filas de eventos e
      // de acoes seguem, porque nao dependem do lease.
      leaseFailed = true;
      console.error(
        `ALERTA lease do worker falhou (${leaseError.code ?? "sem codigo"}): varredura agendada cancelada nesta rodada -`,
        leaseError,
      );
    } else {
      leaseRunId = typeof claimed === "string" ? claimed : null;
      leaseBusy = leaseRunId === null;
    }
  }
  const runScheduled = runScheduledReconciliation && !leaseBusy && !leaseFailed;

  let expirations = { claimed: 0, paid: 0, queued: 0, failed: 0, budgetExhausted: false };
  let reconciliation = { checked: 0, paid: 0, pending: 0, failed: 0, budgetExhausted: false };
  let recovery = { checked: 0, recovered: 0, skipped: 0, failed: 0, budgetExhausted: false };
  let actions;
  try {
    if (runScheduled) {
      try {
        expirations = await expirePixPayments(admin, budget);
      } catch (expirationError) {
        console.error("Falha ao expirar cobranças Pix:", expirationError);
        return jsonResponse({ error: "Falha ao expirar cobranças Pix" }, 500);
      }
    }
    try {
      actions = await processActions(admin, budget);
    } catch (actionError) {
      console.error("Falha ao reivindicar ações financeiras:", actionError);
      return jsonResponse({ error: "Falha ao processar ações financeiras" }, 500);
    }
    if (runScheduled) {
      try {
        reconciliation = await reconcileOpenPixPayments(admin, budget);
        recovery = await recoverPaidCheckouts(admin, budget);
      } catch (reconciliationError) {
        console.error("Falha na conciliação financeira:", reconciliationError);
        return jsonResponse({ error: "Falha na conciliação financeira" }, 500);
      }
    }
  } finally {
    // Devolve antes da hora para o proximo gatilho nao esperar o lease inteiro.
    // Se esta linha nao rodar -- worker morto, timeout da funcao -- o lease
    // expira sozinho, que e a razao de ser lease e nao lock.
    if (leaseRunId) {
      const { error: releaseError } = await admin.rpc("release_worker_lease", {
        p_name: RECONCILIATION_LEASE,
        p_run_id: leaseRunId,
      });
      if (releaseError) console.error("Falha ao liberar lease:", releaseError);
    }
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

  const asaasCalls = asaasCallsUsed(budget);
  const budgetExhausted = asaasCalls >= ASAAS_CALL_BUDGET;
  if (budgetExhausted) {
    // Uma rodada que estoura e normal e nao perde nada -- a fila e duravel e o
    // resto sai na proxima. Varias seguidas significam acumulo, e e esse o
    // alarme que faltava: em 17/08/2026 o primeiro aviso de volume veio por
    // e-mail do Asaas, quando o consumo ja estava alto havia horas.
    console.error(
      `ALERTA orcamento Asaas esgotado: ${asaasCalls}/${ASAAS_CALL_BUDGET} chamadas em uma execucao (source=${source})`,
    );
  }

  return jsonResponse({
    source,
    scheduledReconciliation: runScheduled,
    // `true` quando outra execucao ja estava conciliando e esta so cuidou das
    // filas. Nao e erro; e a exclusao mutua funcionando.
    reconciliationSkippedByLease: leaseBusy,
    // `true` quando o lease falhou por motivo desconhecido e a varredura foi
    // cancelada. Diferente de leaseBusy: aqui algo esta errado e ha alerta no log.
    reconciliationCancelledByLeaseError: leaseFailed,
    asaas: { calls: asaasCalls, budget: ASAAS_CALL_BUDGET, exhausted: budgetExhausted },
    events: { claimed: (data ?? []).length, processed, failed },
    actions,
    expirations,
    reconciliation,
    recovery,
  });
});
