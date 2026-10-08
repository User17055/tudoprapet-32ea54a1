import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { canAccessCheckout, optionalCheckoutUser } from "../_shared/checkout-access.ts";
import {
  type AsaasPayment,
  type AsaasPaymentInput,
  createAsaasPayment,
  CUSTOMER_FACING,
  deleteAsaasPayment,
  findAsaasPaymentByExternalReference,
  findOrCreateAsaasCustomer,
  getAsaasPayment,
  getAsaasPixQrCode,
  tokenizeAsaasCreditCard,
} from "../_shared/asaas.ts";
import { completeDraftOrder, shopifyAdminToken } from "../_shared/shopify.ts";
import { decryptPaymentToken, encryptPaymentToken } from "../_shared/token-crypto.ts";
import { mapAsaasPaymentStatus } from "../_shared/payment-events.ts";
import {
  belowMinimumChargeMessage,
  type InstallmentPlan,
  installmentPlan,
  isBelowMinimumChargeError,
  MAX_INSTALLMENTS,
  maxInstallmentsFor,
  MIN_CHARGE_VALUE,
  MIN_INSTALLMENT_VALUE,
} from "../_shared/pricing.ts";
import { taxCredentialGapMessage, writeCheckoutAttemptLog } from "../_shared/checkout-log.ts";
import {
  createOlistFranchiseOrder,
  ensureOlistOrderReceivable,
  getOlistReceivable,
  issueFranchiseInvoiceSafely,
  type OlistFranchiseOrderInput,
} from "../_shared/olist.ts";
import {
  franchisePaymentDueDate,
  type FranchisePaymentScheduleType,
} from "../_shared/franchise-payment.ts";
import { resolveFranchiseFiscalIdentity, validateFiscalSnapshot } from "../_shared/franchise-fiscal.ts";

const FRANCHISE_PAYMENT_TERM_DAYS = 7;

function dateInSaoPaulo(addDays = 0): string {
  const date = new Date(Date.now() + addDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function olistCustomer(
  customer: { name: string; email: string; cpfCnpj: string; mobilePhone: string; tradeName?: string; stateRegistration?: string },
  address: Record<string, string>,
) {
  return {
    name: customer.name,
    tradeName: customer.tradeName,
    stateRegistration: customer.stateRegistration,
    cpfCnpj: customer.cpfCnpj,
    email: customer.email,
    phone: customer.mobilePhone,
    address: String(address?.address1 || ""),
    number: String(address?.number || ""),
    complement: String(address?.address2 || ""),
    neighborhood: String(address?.neighborhood || ""),
    postalCode: String(address?.postalCode || ""),
    city: String(address?.city || ""),
    state: String(address?.provinceCode || ""),
  };
}

function safePaymentResponse(
  sessionId: string,
  paymentId: string,
  status: string,
  qr?: { encodedImage: string; payload: string; expirationDate: string } | null,
  invoiceUrl?: string | null,
  pixExpiresAt?: string | null,
) {
  return {
    sessionId,
    paymentId,
    status,
    pixQrCode: qr?.encodedImage ?? null,
    pixCopyPaste: qr?.payload ?? null,
    expiresAt: pixExpiresAt ?? null,
    providerExpiresAt: qr?.expirationDate ?? null,
    invoiceUrl: invoiceUrl ?? null,
  };
}

function clientIp(req: Request): string {
  return (req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0] || "").trim();
}

function parseCard(raw: unknown) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const number = String(value.number || "").replace(/\D/g, "");
  const holderName = String(value.holderName || "").trim().slice(0, 120);
  const expiryMonth = String(value.expiryMonth || "").replace(/\D/g, "").padStart(2, "0").slice(-2);
  const rawExpiryYear = String(value.expiryYear || "").replace(/\D/g, "").slice(-4);
  const expiryYear = rawExpiryYear.length === 2 ? `20${rawExpiryYear}` : rawExpiryYear;
  const ccv = String(value.ccv || "").replace(/\D/g, "").slice(0, 4);
  const expiryDate = Number(`${expiryYear}${expiryMonth}`);
  const now = new Date();
  const currentMonth = Number(
    `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
  );
  const validName = holderName.length >= 3 && (holderName.match(/\p{L}/gu)?.length ?? 0) >= 2 &&
    /^[\p{L}\s.'-]+$/u.test(holderName);
  let luhnSum = 0;
  let doubleDigit = false;
  for (let index = number.length - 1; index >= 0; index--) {
    let digit = Number(number[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    luhnSum += digit;
    doubleDigit = !doubleDigit;
  }
  const validNumber = number.length >= 13 && number.length <= 19 &&
    !/^(\d)\1+$/.test(number) && luhnSum % 10 === 0;
  const validCcv = /^3[47]/.test(number) ? /^\d{4}$/.test(ccv) : /^\d{3}$/.test(ccv);
  if (
    !validNumber || !validName ||
    !/^(0[1-9]|1[0-2])$/.test(expiryMonth) || !/^20\d{2}$/.test(expiryYear) ||
    expiryDate < currentMonth || !validCcv
  ) {
    throw new Error("Dados do cartão inválidos");
  }
  return { number, holderName, expiryMonth, expiryYear, ccv };
}

function wakeWorker(): void {
  const url = Deno.env.get("SUPABASE_URL");
  const token = Deno.env.get("PAYMENT_WORKER_TOKEN");
  if (!url || !token) return;
  const task = fetch(`${url}/functions/v1/asaas-process-events`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-payment-worker-token": token },
    body: JSON.stringify({ source: "checkout-payment" }),
  }).catch((error) => console.error("Falha ao acordar worker:", error));
  const runtime =
    (globalThis as unknown as { EdgeRuntime?: { waitUntil(value: Promise<unknown>): void } })
      .EdgeRuntime;
  runtime?.waitUntil(task);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);

  let requestedAction = "";
  let olistStage = "";
  let logAdmin: any = null;
  let logContext: {
    sessionId?: string;
    userId?: string | null;
    customerName?: string;
    customerEmail?: string;
    method: "pix" | "credit_card" | "debit_card" | "terms" | "unknown";
  } = { method: "unknown" };
  try {
    const auth = await optionalCheckoutUser(req);
    if (auth.invalidAuthorization) return errorResponse("Sessão inválida", 401);
    const body = await req.json() as Record<string, unknown>;
    requestedAction = typeof body.action === "string" ? body.action : "";
    logContext.method = body.method === "credit_card"
      ? "credit_card"
      : body.method === "debit_card"
      ? "debit_card"
      : body.method === "pix"
      ? "pix"
      : "unknown";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const accessToken = typeof body.accessToken === "string" ? body.accessToken : null;
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return errorResponse("Checkout inválido", 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    logAdmin = admin;
    const { data: session, error: sessionError } = await admin.from("checkout_sessions")
      .select("*").eq("id", sessionId).single();
    if (sessionError || !session) return errorResponse("Checkout não encontrado", 404);
    if (!(await canAccessCheckout(session, auth.user?.id ?? null, accessToken))) {
      return errorResponse("Acesso negado ao checkout", 403);
    }
    const serviceFee = Number(session.service_fee);
    const expectedTotal = Number((
      Number(session.subtotal) - Number(session.discount) +
      Number(session.shipping_amount) + serviceFee
    ).toFixed(2));
    // Aceita a taxa gravada na própria sessão para não quebrar checkouts antigos
    // que já foram preparados com R$ 3. Novas sessões são criadas com taxa zero.
    if (body.action !== "cancel_pix" && Number(session.total) !== expectedTotal) {
      return errorResponse(
        "O total deste checkout está desatualizado. Volte à sacola e tente novamente.",
        409,
      );
    }
    const logCustomer = session.customer_snapshot as { name?: string; email?: string } | null;
    logContext = {
      sessionId,
      userId: auth.user?.id ?? session.user_id ?? null,
      customerName: logCustomer?.name,
      customerEmail: logCustomer?.email,
      method: session.customer_type === "franchise" ? "terms" : logContext.method,
    };
    if (body.action === "cancel_pix" && session.status === "cancelled") {
      return jsonResponse({ sessionId, cancelled: true });
    }
    const cancellingExpiredPix = body.action === "cancel_pix" && session.status === "expired";
    if (
      !cancellingExpiredPix &&
      ["paid", "paid_pending_shopify", "shopify_created", "credit_approved", "cancelled", "expired"]
        .includes(session.status)
    ) {
      return jsonResponse({ sessionId, status: session.status, orderId: session.shopify_order_id });
    }
    // Sem rascunho na Shopify nao existe pedido para vincular ao pagamento.
    // Cobrar aqui criaria dinheiro sem venda: barre antes de tocar no Asaas.
    if (
      body.action !== "cancel_pix" &&
      (!session.shopify_draft_order_id || session.status === "failed")
    ) {
      return errorResponse(
        "Este checkout não foi concluído na loja. Volte à sacola e refaça o pedido — nada foi cobrado.",
        409,
      );
    }
    const requestedMethod = body.method === "credit_card"
      ? "credit_card"
      : body.method === "debit_card"
      ? "debit_card"
      : "pix";
    const method = session.customer_type === "franchise" ? "terms" : requestedMethod;
    const { data: active } = await admin.from("payments").select("*")
      .eq("checkout_session_id", sessionId)
      .eq("is_active", true)
      .in("status", ["pending", "processing", "cancellation_requested", "confirmed"])
      .order("attempt_number", { ascending: false }).limit(1).maybeSingle();

    // A reserva vencida so barra a PRIMEIRA cobranca deste checkout. Quem ja
    // tem cobranca ativa (Pix aberto, cartao recusado, retomada da sessao)
    // continua de onde parou: mandar refazer o pedido inteiro perdia a venda.
    if (body.action !== "cancel_pix" && !active) {
      const reservedUntil = Date.parse(String(session.inventory_reserved_until || ""));
      if (!Number.isFinite(reservedUntil) || reservedUntil <= Date.now()) {
        return errorResponse(
          "A reserva de estoque deste checkout venceu. Volte à sacola e refaça o pedido — nada foi cobrado.",
          409,
        );
      }
    }

    if (body.action === "cancel_pix") {
      if (!active) return jsonResponse({ sessionId, cancelled: true });
      if (active.method !== "pix") return errorResponse("A cobrança ativa não é Pix", 409);
      if (active.status === "confirmed") {
        return errorResponse("Este Pix já foi confirmado e não pode ser cancelado", 409);
      }
      if (active.provider_payment_id) {
        const providerPaymentId = active.provider_payment_id;
        const paidStatuses = ["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"];
        const registerPaidRace = async (remote: AsaasPayment, remoteStatus: string) => {
          const eventId = `cancel-race:${active.provider_payment_id}:${remoteStatus}`;
          await admin.from("payment_events").upsert({
            provider: "asaas",
            provider_event_id: eventId,
            provider_payment_id: active.provider_payment_id,
            event_type: `PAYMENT_${remoteStatus}`,
            payload: {
              id: eventId,
              event: `PAYMENT_${remoteStatus}`,
              payment: {
                id: active.provider_payment_id,
                status: remoteStatus,
                externalReference: remote.externalReference || active.external_reference,
              },
            },
          }, { onConflict: "provider,provider_event_id", ignoreDuplicates: true });
          wakeWorker();
          return errorResponse(
            "Este Pix acabou de ser confirmado e não pode mais ser cancelado",
            409,
          );
        };

        const remote = await getAsaasPayment(providerPaymentId, CUSTOMER_FACING);
        const remoteStatus = String(remote.status || "").toUpperCase();
        if (paidStatuses.includes(remoteStatus)) {
          return await registerPaidRace(remote, remoteStatus);
        }
        if (remote.deleted !== true && !["PENDING", "OVERDUE"].includes(remoteStatus)) {
          return errorResponse("O Pix mudou de status e não pode ser cancelado agora", 409);
        }

        if (remote.deleted !== true) {
          let deletionConfirmed = false;
          let deletionError: unknown = null;
          try {
            const deleted = await deleteAsaasPayment(providerPaymentId, CUSTOMER_FACING);
            deletionConfirmed = deleted.deleted === true;
          } catch (error) {
            deletionError = error;
            // Uma segunda tentativa pode receber 404 porque a primeira já excluiu
            // a cobrança. Como a consulta acima a encontrou, esse 404 confirma a
            // exclusão concorrente e deve ser tratado como sucesso idempotente.
            if ((error as Error & { status?: number }).status === 404) {
              deletionConfirmed = true;
            }
          }

          if (!deletionConfirmed) {
            try {
              const verified = await getAsaasPayment(providerPaymentId, CUSTOMER_FACING);
              const verifiedStatus = String(verified.status || "").toUpperCase();
              if (verified.deleted === true) {
                deletionConfirmed = true;
              } else if (paidStatuses.includes(verifiedStatus)) {
                return await registerPaidRace(verified, verifiedStatus);
              }
            } catch (verificationError) {
              // O Asaas documenta que uma cobrança já removida pode responder 404.
              // Isso também cobre o caso em que o DELETE funcionou, mas a resposta
              // se perdeu por timeout ou falha momentânea de rede.
              if ((verificationError as Error & { status?: number }).status === 404) {
                deletionConfirmed = true;
              } else if (deletionError) {
                throw deletionError;
              } else {
                throw verificationError;
              }
            }
          }

          if (!deletionConfirmed) {
            if (deletionError) throw deletionError;
            throw new Error("Asaas não confirmou o cancelamento do Pix");
          }
        }
      }
      const now = new Date().toISOString();
      const { error: cancelError } = await admin.from("payments").update({
        status: "cancelled",
        is_active: false,
        provider_deleted_at: now,
      }).eq("id", active.id).in("status", ["pending", "processing", "cancellation_requested"]);
      if (cancelError) throw cancelError;
      const { error: sessionCancelError } = await admin.from("checkout_sessions")
        .update({ status: "cancelled" }).eq("id", sessionId)
        .in("status", ["awaiting_payment", "payment_processing"]);
      if (sessionCancelError) throw sessionCancelError;
      return jsonResponse({ sessionId, paymentId: active.id, cancelled: true });
    }

    if (active && method !== "terms") {
      if (active.status === "cancellation_requested") {
        return jsonResponse({
          sessionId,
          paymentId: active.id,
          status: active.status,
          message: "A cobrança anterior ainda está sendo cancelada. Tente novamente em instantes.",
        }, 409);
      }
      if (active.method !== method) {
        return jsonResponse(
          { error: "Já existe uma cobrança ativa em outra forma de pagamento" },
          409,
        );
      }
      if (active.provider_payment_id && method === "pix" && active.status !== "confirmed") {
        const qr = await getAsaasPixQrCode(active.provider_payment_id, CUSTOMER_FACING);
        const pixExpiresAt = active.pix_expires_at ||
          new Date(Date.now() + 15 * 60 * 1000).toISOString();
        if (!active.pix_expires_at) {
          await admin.from("payments").update({ pix_expires_at: pixExpiresAt }).eq("id", active.id);
        }
        return jsonResponse(
          safePaymentResponse(sessionId, active.id, active.status, qr, null, pixExpiresAt),
        );
      }
      if (active.provider_payment_id && method === "debit_card" && active.status !== "confirmed") {
        const remote = await getAsaasPayment(active.provider_payment_id, CUSTOMER_FACING);
        return jsonResponse(safePaymentResponse(
          sessionId,
          active.id,
          active.status,
          null,
          typeof remote.invoiceUrl === "string" ? remote.invoiceUrl : null,
        ));
      }
      return jsonResponse(safePaymentResponse(sessionId, active.id, active.status, null));
    }

    const customer = session.customer_snapshot as {
      name: string;
      email: string;
      cpfCnpj: string;
      mobilePhone: string;
      legalName?: string;
      tradeName?: string;
      stateRegistration?: string;
      stateRegistrationIndicator?: string;
    };
    const customerAddress =
      (session.billing_address_snapshot && Object.keys(session.billing_address_snapshot).length
        ? session.billing_address_snapshot
        : session.address_snapshot) as Record<string, string>;
    let termDays = 0;
    let paymentScheduleType: FranchisePaymentScheduleType = "days_after_order";
    let paymentDueDay: number | null = null;
    if (session.customer_type === "franchise" && session.user_id) {
      const { data: credit } = await admin.from("franchise_credit_accounts")
        .select("manually_blocked,blocked_reason,payment_term_days,payment_schedule_type,payment_due_day")
        .eq("user_id", session.user_id).maybeSingle();
      if (credit?.manually_blocked) {
        return jsonResponse({ error: credit.blocked_reason || "Franquia bloqueada" }, 403);
      }
      const snapshotDays = Number(session.franchise_payment_term_days);
      const configuredDays = Number(credit?.payment_term_days);
      termDays = Number.isInteger(snapshotDays) && snapshotDays >= 1 && snapshotDays <= 365
        ? snapshotDays
        : Number.isInteger(configuredDays) && configuredDays >= 1 && configuredDays <= 365
        ? configuredDays
        : FRANCHISE_PAYMENT_TERM_DAYS;
      paymentScheduleType = session.franchise_payment_schedule_type === "fixed_day_next_month"
        ? "fixed_day_next_month"
        : session.franchise_payment_schedule_type === "days_after_order"
        ? "days_after_order"
        : credit?.payment_schedule_type === "fixed_day_next_month"
        ? "fixed_day_next_month"
        : "days_after_order";
      const snapshotDueDay = Number(session.franchise_payment_due_day);
      const configuredDueDay = Number(credit?.payment_due_day);
      paymentDueDay = Number.isInteger(snapshotDueDay) && snapshotDueDay >= 1 && snapshotDueDay <= 31
        ? snapshotDueDay
        : Number.isInteger(configuredDueDay) && configuredDueDay >= 1 && configuredDueDay <= 31
        ? configuredDueDay
        : null;
    }
    const invoicePurpose = session.invoice_purpose === "final_consumption"
      ? "final_consumption"
      : session.invoice_purpose === "resale"
      ? "resale"
      : null;
    if (session.customer_type === "franchise" && !invoicePurpose) {
      return errorResponse("Volte à sacola e escolha a finalidade da NF-e antes de confirmar", 409);
    }
    if (session.customer_type === "franchise") {
      if (session.user_id) {
        const { count: addressCount, error: addressError } = await admin.from("customer_addresses")
          .select("id", { count: "exact", head: true }).eq("user_id", session.user_id);
        if (addressError) throw addressError;
        if ((addressCount ?? 0) === 0) {
          return jsonResponse({ error: "Cadastre um endereço fiscal no perfil da franquia", profileRequired: true });
        }
      }
      let fiscalError = validateFiscalSnapshot(customer, invoicePurpose);
      if (fiscalError && session.user_id) {
        const { data: currentFiscalProfile, error: currentFiscalError } = await admin.from("profiles")
          .select("name,cpf,cnpj,company_legal_name,company_trade_name,state_registration,state_registration_indicator")
          .eq("user_id", session.user_id).maybeSingle();
        if (currentFiscalError) throw currentFiscalError;
        const resolved = resolveFranchiseFiscalIdentity(currentFiscalProfile, invoicePurpose);
        fiscalError = resolved.ok ? null : resolved.error;
        if (resolved.ok) {
          // Atualiza o snapshot; Olist, NF-e e Shopify leem só dele.
          Object.assign(customer, resolved.identity);
          const { error: snapshotError } = await admin.from("checkout_sessions")
            .update({ customer_snapshot: customer }).eq("id", sessionId);
          if (snapshotError) throw snapshotError;
        }
      }
      if (fiscalError) return jsonResponse({ error: fiscalError, profileRequired: true });
    }
    const dueDate = session.customer_type === "franchise"
      ? franchisePaymentDueDate({
        createdAt: session.created_at,
        scheduleType: paymentScheduleType,
        termDays,
        dueDay: paymentDueDay,
      })
      : dateInSaoPaulo(termDays);
    // `checkout-prepare` já barra o carrinho abaixo do piso, mas uma sessão
    // criada antes desta guarda ainda chega aqui. Recusar antes de abrir a
    // tentativa evita gravar uma tentativa que só pode falhar.
    if (Number(session.total) < MIN_CHARGE_VALUE) {
      return errorResponse(belowMinimumChargeMessage(Number(session.total)), 422);
    }
    let paymentAttempt = active;
    if (!paymentAttempt) {
      const { data: attempt, error: attemptError } = await admin.rpc("create_payment_attempt", {
        p_checkout_session_id: sessionId,
        p_provider: session.customer_type === "franchise" ? "olist" : "asaas",
        p_method: method,
        p_amount: session.total,
        p_due_date: dueDate,
      });
      if (attemptError) {
        if (attemptError.message?.includes("active_payment_attempt_exists")) {
          return jsonResponse({ error: "Já existe uma tentativa ativa; atualize a página" }, 409);
        }
        throw attemptError;
      }
      paymentAttempt = Array.isArray(attempt) ? attempt[0] : attempt;
    }
    if (!paymentAttempt?.id) throw new Error("Falha ao criar tentativa financeira");

    if (session.customer_type === "franchise") {
      olistStage = "configuration";
      const olistToken = Deno.env.get("OLIST_API_TOKEN") || Deno.env.get("TINY_API_TOKEN") || "";
      if (!olistToken) throw new Error("Olist não configurada para pedidos de franquia");
      const natureOperationId = invoicePurpose === "final_consumption"
        ? String(Deno.env.get("OLIST_FINAL_CONSUMPTION_NATURE_OPERATION_ID") || "").trim()
        : String(Deno.env.get("OLIST_RESALE_NATURE_OPERATION_ID") || "").trim();
      if (!natureOperationId) {
        throw new Error(
          invoicePurpose === "final_consumption"
            ? "Natureza de operação da Olist para consumo final não configurada"
            : "Natureza de operação da Olist para revenda não configurada",
        );
      }
      const billing = olistCustomer(customer, customerAddress);
      const deliveryAddress =
        session.address_snapshot && Object.keys(session.address_snapshot).length
          ? olistCustomer(customer, session.address_snapshot as Record<string, string>)
          : undefined;
      const items = (Array.isArray(session.items_snapshot) ? session.items_snapshot : []) as Array<
        Record<string, unknown>
      >;
      const olistInput: OlistFranchiseOrderInput = {
        externalReference: sessionId,
        customer: billing,
        deliveryAddress,
        items: items.map((item) => ({
          sku: String(item.sku || ""),
          description: [item.productTitle, item.variantTitle].filter(Boolean).join(" - "),
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
        })),
        shippingAmount: Number(session.shipping_amount),
        serviceFee: Number(session.service_fee),
        total: Number(session.total),
        // Nova tentativa reaproveita o vencimento original (7 dias da confirmação).
        dueDate: String(paymentAttempt.due_date || dueDate),
        shippingMethod: String(session.shipping_method || ""),
        paymentMethod: String(Deno.env.get("OLIST_FRANCHISE_PAYMENT_METHOD") || "boleto")
          .trim()
          .toLowerCase(),
        invoicePurpose: invoicePurpose!,
        natureOperationId,
      };

      let order = session.olist_order_id
        ? {
          id: String(session.olist_order_id),
          number: String(session.olist_order_number || session.olist_order_id),
        }
        : null;
      if (!order) {
        olistStage = "order";
        order = await createOlistFranchiseOrder(olistInput, olistToken);
        const { error: orderSaveError } = await admin.from("checkout_sessions").update({
          olist_order_id: order.id,
          olist_order_number: order.number,
        }).eq("id", sessionId);
        if (orderSaveError) throw orderSaveError;
      }

      olistStage = "receivable";
      const receivableReference = session.olist_receivable_id
        ? await getOlistReceivable(String(session.olist_receivable_id), olistToken)
        : await ensureOlistOrderReceivable(order.id, olistToken);
      const receivable = await getOlistReceivable(receivableReference.id, olistToken);
      const { error: receivableSaveError } = await admin.from("checkout_sessions")
        .update({ olist_receivable_id: receivable.id }).eq("id", sessionId);
      if (receivableSaveError) throw receivableSaveError;
      const { error: paymentSaveError } = await admin.from("payments").update({
        provider: "olist",
        provider_customer_id: order.id,
        provider_payment_id: receivable.id,
        // Nunca apaga um link já salvo quando a Olist ainda não devolveu o boleto.
        ...(receivable.boletoUrl ? { provider_payment_url: receivable.boletoUrl } : {}),
        raw_status: receivable.status,
        status: receivable.status === "pago" ? "received" : "pending",
        ...(receivable.status === "pago"
          ? { received_at: new Date().toISOString(), is_active: false }
          : {}),
      }).eq("id", paymentAttempt.id);
      if (paymentSaveError) throw paymentSaveError;

      // NF-e nunca bloqueia o pedido: só pedido/cobrança Olist e Shopify
      // interrompem o checkout. Rejeição fiscal vira alerta e reprocessamento.
      olistStage = "invoice";
      const invoiceOutcome = await issueFranchiseInvoiceSafely({
        orderId: order.id,
        token: olistToken,
        savedInvoice: session.olist_invoice_id
          ? {
            id: String(session.olist_invoice_id),
            number: String(session.olist_invoice_number || ""),
            issued: false,
          }
          : null,
        onInvoiceGenerated: async (generated) => {
          const { error: invoiceSaveError } = await admin.from("checkout_sessions").update({
            olist_invoice_id: generated.id,
            olist_invoice_number: generated.number,
          }).eq("id", sessionId);
          if (invoiceSaveError) throw invoiceSaveError;
        },
      });
      const invoice = invoiceOutcome.invoice;
      if (invoiceOutcome.status === "rejected") {
        console.warn(`checkout-payment: NF-e da sessão ${sessionId} pendente de correção:`, invoiceOutcome.error);
        await writeCheckoutAttemptLog(admin, {
          checkoutSessionId: sessionId,
          userId: logContext.userId,
          customerName: customer.name,
          customerEmail: customer.email,
          paymentMethod: "terms",
          stage: "payment",
          success: false,
          errorMessage: `Alerta NF-e (pedido seguiu para a Shopify): ${invoiceOutcome.error}`,
          metadata: {
            provider: "olist",
            olistStage: "invoice",
            alert: "olist_invoice_rejected",
            blocking: false,
            olistOrderId: order.id,
            olistInvoiceId: invoice?.id ?? null,
          },
        });
      }

      olistStage = "shopify";
      const shopifyToken = shopifyAdminToken();
      if (!shopifyToken || !session.shopify_draft_order_id) {
        throw new Error("Shopify não configurada para concluir pedido da franquia");
      }
      const completed = await completeDraftOrder(
        session.shopify_draft_order_id,
        shopifyToken,
        true,
        customer.cpfCnpj,
      );
      if (!completed.requestOk || !completed.orderId) {
        throw new Error("Falha ao concluir pedido com prazo na Shopify");
      }
      const { error: completedSaveError } = await admin.from("checkout_sessions").update({
        status: "credit_approved",
        shopify_order_id: completed.orderId,
        olist_invoice_status: invoiceOutcome.status,
        olist_invoice_checked_at: new Date().toISOString(),
        ...(invoice?.number ? { olist_invoice_number: invoice.number } : {}),
        ...(invoice?.accessUrl ? { olist_invoice_url: invoice.accessUrl } : {}),
      }).eq("id", sessionId);
      if (completedSaveError) throw completedSaveError;
      await writeCheckoutAttemptLog(admin, {
        checkoutSessionId: sessionId,
        userId: logContext.userId,
        customerName: customer.name,
        customerEmail: customer.email,
        paymentMethod: "terms",
        stage: "payment",
        success: true,
        providerPaymentId: receivable.id,
        metadata: {
          provider: "olist",
          olistOrderId: order.id,
          olistInvoiceId: invoice?.id ?? null,
          invoiceStatus: invoiceOutcome.status,
          dueDate,
          paymentTermDays: termDays,
          paymentScheduleType,
          paymentDueDay,
          invoicePurpose,
        },
      });
      olistStage = "complete";
      return jsonResponse(safePaymentResponse(
        sessionId,
        paymentAttempt.id,
        "credit_approved",
        null,
        receivable.boletoUrl || paymentAttempt.provider_payment_url || null,
      ));
    }

    const providerCustomerId = await findOrCreateAsaasCustomer({
      externalReference: auth.user?.id ? `tpp-user:${auth.user.id}` : `tpp-checkout:${sessionId}`,
      name: customer.name,
      cpfCnpj: customer.cpfCnpj,
      email: customer.email,
      mobilePhone: customer.mobilePhone,
      ...(customerAddress?.postalCode
        ? {
          address: customerAddress.address1,
          addressNumber: customerAddress.number,
          complement: customerAddress.address2 || undefined,
          province: customerAddress.neighborhood,
          postalCode: customerAddress.postalCode,
        }
        : {}),
    }, CUSTOMER_FACING);

    const createInput: AsaasPaymentInput = {
      customer: providerCustomerId,
      billingType: session.customer_type === "franchise"
        ? "UNDEFINED"
        : method === "debit_card"
        ? "CREDIT_CARD"
        : method === "credit_card"
        ? "CREDIT_CARD"
        : "PIX",
      value: Number(session.total),
      dueDate,
      description: `Pedido TudoPraPet ${sessionId.slice(0, 8)}`,
      externalReference: paymentAttempt.external_reference,
    };

    let cardPlan: InstallmentPlan | null = null;
    let submittedCard: ReturnType<typeof parseCard> | null = null;
    if (method === "credit_card") {
      const requested = Math.trunc(Number(body.installments ?? 1));
      if (!Number.isFinite(requested) || requested < 1 || requested > MAX_INSTALLMENTS) {
        return errorResponse(`Parcelamento inválido: escolha de 1x a ${MAX_INSTALLMENTS}x`, 400);
      }
      if (requested > maxInstallmentsFor(Number(session.total))) {
        return errorResponse(
          `Cada parcela precisa ser de no mínimo R$ ${MIN_INSTALLMENT_VALUE},00`,
          400,
        );
      }
      // Juros do parcelamento são do cliente: o valor cobrado é recalculado
      // aqui no servidor, nunca aceito do navegador.
      cardPlan = installmentPlan(Number(session.total), requested);
      createInput.value = cardPlan.installmentValue;
      if (cardPlan.installments > 1) {
        createInput.installmentCount = cardPlan.installments;
        createInput.totalValue = cardPlan.chargedTotal;
      }
      const ip = clientIp(req);
      if (!ip) throw new Error("Não foi possível identificar a origem do pagamento");
      createInput.remoteIp = ip;
      const savedMethodId = typeof body.savedPaymentMethodId === "string"
        ? body.savedPaymentMethodId
        : "";
      if (savedMethodId) {
        if (!auth.user) return errorResponse("Entre na conta para usar um cartão salvo", 401);
        const { data: saved } = await admin.from("customer_payment_methods")
          .select("token_ciphertext,token_iv,provider_customer_id")
          .eq("id", savedMethodId).eq("user_id", auth.user.id).is("revoked_at", null).single();
        if (!saved || saved.provider_customer_id !== providerCustomerId) {
          return errorResponse("Cartão salvo não está disponível", 409);
        }
        createInput.creditCardToken = await decryptPaymentToken(
          saved.token_ciphertext,
          saved.token_iv,
        );
      } else {
        submittedCard = parseCard(body.card);
        const billing = session.billing_address_snapshot as Record<string, string>;
        if (!billing?.postalCode || !billing?.number) {
          return errorResponse("Informe o endereço de cobrança", 400);
        }
        createInput.creditCard = submittedCard;
        createInput.creditCardHolderInfo = {
          name: customer.name,
          email: customer.email,
          cpfCnpj: customer.cpfCnpj,
          postalCode: billing.postalCode,
          addressNumber: billing.number,
          addressComplement: billing.address2 || null,
          mobilePhone: customer.mobilePhone,
        };
      }
    }

    let providerPayment: AsaasPayment | null = null;
    try {
      providerPayment = await createAsaasPayment(createInput, CUSTOMER_FACING);
    } catch (createError) {
      // A resposta pode ter se perdido depois da criação. Consultar antes de
      // permitir outra tentativa evita duas cobranças para o mesmo clique.
      try {
        providerPayment = await findAsaasPaymentByExternalReference(
          paymentAttempt.external_reference,
          CUSTOMER_FACING,
        );
      } catch {
        // Mantém o erro original, que possui o contexto mais útil.
      }
      if (!providerPayment) {
        await admin.from("payments").update({ status: "failed", is_active: false })
          .eq("id", paymentAttempt.id);
        throw createError;
      }
    }
    if (!providerPayment?.id) throw new Error("Asaas não retornou a cobrança");

    const directStatus = mapAsaasPaymentStatus("", providerPayment.status) ?? "pending";
    const { error: paymentUpdateError } = await admin.from("payments").update({
      provider_customer_id: providerCustomerId,
      provider_payment_id: providerPayment.id,
      raw_status: providerPayment.status,
      status: directStatus,
      ...(cardPlan ? { amount: cardPlan.chargedTotal } : {}),
      ...(directStatus === "confirmed" ? { confirmed_at: new Date().toISOString() } : {}),
      ...(directStatus === "received"
        ? { received_at: new Date().toISOString(), is_active: false }
        : {}),
    }).eq("id", paymentAttempt.id);
    if (paymentUpdateError) throw paymentUpdateError;
    await writeCheckoutAttemptLog(admin, {
      checkoutSessionId: sessionId,
      userId: logContext.userId,
      customerName: customer.name,
      customerEmail: customer.email,
      paymentMethod: method,
      stage: "payment",
      success: true,
      providerPaymentId: providerPayment.id,
      metadata: {
        status: directStatus,
        amount: cardPlan?.chargedTotal ?? Number(session.total),
        installments: cardPlan?.installments ?? 1,
      },
    });

    if (method === "credit_card") {
      let cardSaved = false;
      let providerToken = typeof providerPayment.creditCardToken === "string"
        ? providerPayment.creditCardToken
        : "";
      let tokenCardNumber = typeof providerPayment.creditCardNumber === "string"
        ? providerPayment.creditCardNumber
        : "";
      let tokenCardBrand = typeof providerPayment.creditCardBrand === "string"
        ? providerPayment.creditCardBrand
        : "";
      if (
        body.saveCard === true && auth.user && !providerToken && submittedCard &&
        createInput.creditCardHolderInfo && createInput.remoteIp
      ) {
        try {
          const tokenized = await tokenizeAsaasCreditCard({
            customer: providerCustomerId,
            creditCard: submittedCard,
            creditCardHolderInfo: createInput.creditCardHolderInfo,
            remoteIp: createInput.remoteIp,
          }, CUSTOMER_FACING);
          providerToken = typeof tokenized.creditCardToken === "string"
            ? tokenized.creditCardToken
            : "";
          tokenCardNumber = tokenized.creditCardNumber || tokenCardNumber;
          tokenCardBrand = tokenized.creditCardBrand || tokenCardBrand;
        } catch (tokenError) {
          console.error("Pagamento aprovado, mas a tokenização do cartão falhou:", tokenError);
        }
      }
      if (body.saveCard === true && auth.user && providerToken) {
        try {
          const encrypted = await encryptPaymentToken(providerToken);
          const returnedDigits = String(tokenCardNumber || submittedCard?.number || "").replace(
            /\D/g,
            "",
          );
          const lastFour = returnedDigits.slice(-4);
          if (/^\d{4}$/.test(lastFour)) {
            await admin.from("customer_payment_methods").update({ is_default: false })
              .eq("user_id", auth.user.id).is("revoked_at", null);
            const { error: saveError } = await admin.from("customer_payment_methods").insert({
              user_id: auth.user.id,
              provider_customer_id: providerCustomerId,
              token_ciphertext: encrypted.ciphertext,
              token_iv: encrypted.iv,
              brand: tokenCardBrand || null,
              last_four: lastFour,
              holder_name: submittedCard?.holderName || customer.name,
              is_default: true,
            });
            if (saveError) throw saveError;
            cardSaved = true;
          }
        } catch (saveError) {
          // A cobrança já aconteceu. Falhar ao guardar a conveniência nunca
          // pode responder como falha financeira e induzir uma nova tentativa.
          console.error("Pagamento aprovado, mas o token do cartão não foi salvo:", saveError);
        }
      }
      await admin.from("checkout_sessions").update({ status: "payment_processing" }).eq(
        "id",
        sessionId,
      );
      if (["confirmed", "received"].includes(directStatus)) {
        await admin.from("payment_events").upsert({
          provider: "asaas",
          provider_event_id: `direct:${providerPayment.id}:${providerPayment.status}`,
          provider_payment_id: providerPayment.id,
          event_type: `PAYMENT_${String(providerPayment.status).toUpperCase()}`,
          payload: {
            id: `direct:${providerPayment.id}:${providerPayment.status}`,
            event: `PAYMENT_${String(providerPayment.status).toUpperCase()}`,
            payment: {
              id: providerPayment.id,
              status: providerPayment.status,
              externalReference: providerPayment.externalReference ||
                paymentAttempt.external_reference,
            },
          },
        }, { onConflict: "provider,provider_event_id", ignoreDuplicates: true });

        // Cartao aprovado deve virar pedido Shopify ainda nesta requisicao. O
        // worker continua como retentativa, mas deixa de ser o unico caminho:
        // se o disparo em background falhar, a venda nao fica invisivel.
        const shopifyToken = shopifyAdminToken();
        if (shopifyToken && session.shopify_draft_order_id) {
          const completed = await completeDraftOrder(
            session.shopify_draft_order_id,
            shopifyToken,
            false,
            customer.cpfCnpj,
          );
          await writeCheckoutAttemptLog(admin, {
            checkoutSessionId: sessionId,
            userId: logContext.userId,
            customerName: customer.name,
            customerEmail: customer.email,
            paymentMethod: "credit_card",
            stage: "shopify_completion",
            success: completed.requestOk && Boolean(completed.orderId),
            errorMessage: completed.requestOk
              ? (completed.taxCredentialStored === false
                ? taxCredentialGapMessage(completed.taxCredentialError)
                : null)
              : completed.error,
            providerPaymentId: providerPayment.id,
            metadata: {
              ...(completed.orderId ? { shopifyOrderId: completed.orderId } : {}),
              taxCredentialStored: completed.taxCredentialStored ?? null,
            },
          });
          if (completed.requestOk && completed.orderId) {
            await admin.from("checkout_sessions").update({
              status: "shopify_created",
              shopify_order_id: completed.orderId,
            }).eq("id", sessionId).is("shopify_order_id", null);
          } else {
            await admin.from("checkout_sessions").update({ status: "paid_pending_shopify" })
              .eq("id", sessionId).is("shopify_order_id", null);
            wakeWorker();
          }
        } else {
          await admin.from("checkout_sessions").update({ status: "paid_pending_shopify" })
            .eq("id", sessionId).is("shopify_order_id", null);
          wakeWorker();
        }
      }
      return jsonResponse({
        ...safePaymentResponse(sessionId, paymentAttempt.id, directStatus, null),
        cardSaved,
        cardSaveRequested: body.saveCard === true && Boolean(auth.user) && Boolean(submittedCard),
        cardBrand: providerPayment.creditCardBrand || null,
        cardLastFour:
          String(providerPayment.creditCardNumber || submittedCard?.number || "").replace(/\D/g, "")
            .slice(-4) || null,
      });
    }
    if (method === "debit_card") {
      const invoiceUrl = typeof providerPayment.invoiceUrl === "string"
        ? providerPayment.invoiceUrl
        : null;
      if (!invoiceUrl) {
        await admin.from("payments").update({ status: "failed", is_active: false })
          .eq("id", paymentAttempt.id);
        throw new Error("Asaas não devolveu a página segura para pagamento no débito");
      }
      await admin.from("checkout_sessions").update({ status: "payment_processing" }).eq(
        "id",
        sessionId,
      );
      return jsonResponse(safePaymentResponse(
        sessionId,
        paymentAttempt.id,
        directStatus,
        null,
        invoiceUrl,
      ));
    }

    const qr = await getAsaasPixQrCode(providerPayment.id, CUSTOMER_FACING);
    const pixExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await Promise.all([
      admin.from("payments").update({
        provider_expires_at: qr.expirationDate,
        pix_expires_at: pixExpiresAt,
      }).eq("id", paymentAttempt.id),
      admin.from("checkout_sessions").update({ status: "payment_processing" }).eq("id", sessionId),
    ]);
    return jsonResponse(
      safePaymentResponse(sessionId, paymentAttempt.id, "pending", qr, null, pixExpiresAt),
    );
  } catch (error) {
    console.error("checkout-payment:", error);
    const message = error instanceof Error ? error.message : "";
    if (logAdmin && requestedAction !== "cancel_pix") {
      await writeCheckoutAttemptLog(logAdmin, {
        checkoutSessionId: logContext.sessionId,
        userId: logContext.userId,
        customerName: logContext.customerName,
        customerEmail: logContext.customerEmail,
        paymentMethod: logContext.method,
        stage: "payment",
        success: false,
        errorMessage: message || "Falha desconhecida ao iniciar pagamento.",
        metadata: logContext.method === "terms" ? { provider: "olist", olistStage } : {},
      });
    }
    if ((error as Error & { status?: number }).status === 429) {
      return errorResponse(
        "Pagamentos temporariamente indisponíveis. Aguarde alguns minutos e tente novamente.",
        503,
      );
    }
    if (requestedAction === "cancel_pix") {
      return errorResponse(
        "Não foi possível confirmar o cancelamento do Pix. Tente novamente.",
        502,
      );
    }
    if (logContext.method === "terms") {
      if (/Olist n.o configurada/i.test(message)) {
        return errorResponse(
          "A integração com a Olist ainda não está configurada. Cadastre OLIST_API_TOKEN no Supabase.",
          503,
        );
      }
      if (/olist_(order|receivable|invoice)|schema cache|column .* does not exist/i.test(message)) {
        return errorResponse(
          "A atualização do banco da Olist ainda não foi aplicada. Publique as migrations e tente novamente.",
          503,
        );
      }
      const stageMessage: Record<string, string> = {
        configuration: "validar a configuração da Olist",
        order: "criar o pedido na Olist",
        receivable: "gerar a cobrança na Olist",
        invoice: "emitir a nota fiscal na Olist",
        shopify: "concluir o pedido na loja",
      };
      return errorResponse(
        `Não foi possível ${
          stageMessage[olistStage] || "concluir o pedido da franquia"
        }. Nenhum pagamento foi confirmado.`,
        502,
      );
    }
    if (message.includes("Dados do cartão inválidos")) return errorResponse(message, 400);
    if (/Asaas 400:.*invalid_billingType/i.test(message)) {
      return errorResponse(
        "O pagamento por cartão ainda não está habilitado nesta conta. Use Pix ou fale com o atendimento.",
        503,
      );
    }
    if (/Asaas 400:.*invalid_creditCard/i.test(message)) {
      return errorResponse(
        "O banco não autorizou esta compra. Confira os dados, tente outro cartão ou escolha Pix ou débito.",
        402,
      );
    }
    // Sessão criada antes da guarda de piso, ou piso do Asaas alterado sem
    // aviso: o motivo é legítimo e o cliente consegue agir sobre ele.
    if (isBelowMinimumChargeError(message)) {
      return errorResponse(belowMinimumChargeMessage(), 422);
    }
    // Este é o balde genérico, o último 400 antes do fim. Ele afirmava cartão
    // para qualquer erro: quem pagava no Pix recebia "confira os dados do
    // cartão" sem nunca ter digitado um, e ia conferir um cartão que não
    // existia. O motivo real fica no log da tentativa, logo acima; aqui o que
    // não se pode é apontar a causa errada.
    if (/Asaas 400:/.test(message)) {
      return errorResponse(
        logContext.method === "credit_card"
          ? "Não foi possível validar o cartão e os dados do titular. Confira as informações e tente novamente."
          : logContext.method === "debit_card"
          ? "Não foi possível abrir o pagamento no débito. Tente novamente ou escolha Pix."
          : "Não foi possível gerar a cobrança. Tente novamente ou fale com o atendimento.",
        400,
      );
    }
    if (/Asaas 401:/.test(message)) {
      return errorResponse(
        "Pagamento temporariamente indisponível. Tente novamente mais tarde.",
        503,
      );
    }
    if (/Asaas 4\d\d:/.test(message)) {
      return errorResponse(
        "Pagamento recusado. Confira os dados ou use outra forma de pagamento.",
        402,
      );
    }
    return errorResponse("Não foi possível iniciar o pagamento", 500);
  }
});
