import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { canAccessCheckout, optionalCheckoutUser } from "../_shared/checkout-access.ts";
import {
  createAsaasPayment,
  deleteAsaasPayment,
  findAsaasPaymentByExternalReference,
  findOrCreateAsaasCustomer,
  getAsaasPayment,
  getAsaasPixQrCode,
  type AsaasPayment, type AsaasPaymentInput,
} from "../_shared/asaas.ts";
import { completeDraftOrder, shopifyAdminToken } from "../_shared/shopify.ts";
import { decryptPaymentToken, encryptPaymentToken } from "../_shared/token-crypto.ts";
import { mapAsaasPaymentStatus } from "../_shared/payment-events.ts";
import {
  installmentPlan,
  MAX_INSTALLMENTS,
  maxInstallmentsFor,
  MIN_INSTALLMENT_VALUE,
  type InstallmentPlan,
} from "../_shared/pricing.ts";

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
  return (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0] || "").trim();
}

function parseCard(raw: unknown) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const number = String(value.number || "").replace(/\D/g, "");
  const holderName = String(value.holderName || "").trim().slice(0, 120);
  const expiryMonth = String(value.expiryMonth || "").replace(/\D/g, "").padStart(2, "0").slice(-2);
  const rawExpiryYear = String(value.expiryYear || "").replace(/\D/g, "").slice(-4);
  const expiryYear = rawExpiryYear.length === 2 ? `20${rawExpiryYear}` : rawExpiryYear;
  const ccv = String(value.ccv || "").replace(/\D/g, "").slice(0, 4);
  const expiryDate = Number(`${expiryYear}${expiryMonth}`);
  const now = new Date();
  const currentMonth = Number(`${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`);
  if (number.length < 13 || number.length > 19 || holderName.length < 2 ||
    !/^(0[1-9]|1[0-2])$/.test(expiryMonth) || !/^20\d{2}$/.test(expiryYear) ||
    expiryDate < currentMonth || !/^\d{3,4}$/.test(ccv)) {
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
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(value: Promise<unknown>): void } }).EdgeRuntime;
  runtime?.waitUntil(task);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);

  let requestedAction = "";
  try {
    const auth = await optionalCheckoutUser(req);
    if (auth.invalidAuthorization) return errorResponse("Sessão inválida", 401);
    const body = await req.json() as Record<string, unknown>;
    requestedAction = typeof body.action === "string" ? body.action : "";
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const accessToken = typeof body.accessToken === "string" ? body.accessToken : null;
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return errorResponse("Checkout inválido", 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
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
      return errorResponse("O total deste checkout está desatualizado. Volte à sacola e tente novamente.", 409);
    }
    if (body.action === "cancel_pix" && session.status === "cancelled") {
      return jsonResponse({ sessionId, cancelled: true });
    }
    const cancellingExpiredPix = body.action === "cancel_pix" && session.status === "expired";
    if (!cancellingExpiredPix && ["paid", "paid_pending_shopify", "shopify_created", "cancelled", "expired"].includes(session.status)) {
      return jsonResponse({ sessionId, status: session.status, orderId: session.shopify_order_id });
    }

    const requestedMethod = body.method === "credit_card" ? "credit_card" : "pix";
    const method = session.customer_type === "franchise" ? "terms" : requestedMethod;
    const { data: active } = await admin.from("payments").select("*")
      .eq("checkout_session_id", sessionId)
      .eq("is_active", true)
      .in("status", ["pending", "processing", "cancellation_requested", "confirmed"])
      .order("attempt_number", { ascending: false }).limit(1).maybeSingle();

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
          return errorResponse("Este Pix acabou de ser confirmado e não pode mais ser cancelado", 409);
        };

        const remote = await getAsaasPayment(providerPaymentId);
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
            const deleted = await deleteAsaasPayment(providerPaymentId);
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
              const verified = await getAsaasPayment(providerPaymentId);
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

    if (active) {
      if (active.status === "cancellation_requested") {
        return jsonResponse({
          sessionId,
          paymentId: active.id,
          status: active.status,
          message: "A cobrança anterior ainda está sendo cancelada. Tente novamente em instantes.",
        }, 409);
      }
      if (active.method !== method) {
        return jsonResponse({ error: "Já existe uma cobrança ativa em outra forma de pagamento" }, 409);
      }
      if (active.provider_payment_id && method === "pix" && active.status !== "confirmed") {
        const qr = await getAsaasPixQrCode(active.provider_payment_id);
        const pixExpiresAt = active.pix_expires_at || new Date(Date.now() + 15 * 60 * 1000).toISOString();
        if (!active.pix_expires_at) {
          await admin.from("payments").update({ pix_expires_at: pixExpiresAt }).eq("id", active.id);
        }
        return jsonResponse(safePaymentResponse(sessionId, active.id, active.status, qr, null, pixExpiresAt));
      }
      return jsonResponse(safePaymentResponse(sessionId, active.id, active.status, null));
    }

    const customer = session.customer_snapshot as {
      name: string; email: string; cpfCnpj: string; mobilePhone: string;
    };
    const customerAddress = (session.billing_address_snapshot && Object.keys(session.billing_address_snapshot).length
      ? session.billing_address_snapshot
      : session.address_snapshot) as Record<string, string>;
    const providerCustomerId = await findOrCreateAsaasCustomer({
      externalReference: auth.user?.id ? `tpp-user:${auth.user.id}` : `tpp-checkout:${sessionId}`,
      name: customer.name,
      cpfCnpj: customer.cpfCnpj,
      email: customer.email,
      mobilePhone: customer.mobilePhone,
      ...(customerAddress?.postalCode ? {
        address: customerAddress.address1,
        addressNumber: customerAddress.number,
        complement: customerAddress.address2 || undefined,
        province: customerAddress.neighborhood,
        postalCode: customerAddress.postalCode,
      } : {}),
    });

    let termDays = 0;
    if (session.customer_type === "franchise" && session.user_id) {
      const { data: credit } = await admin.from("franchise_credit_accounts")
        .select("payment_term_days,manually_blocked,blocked_reason")
        .eq("user_id", session.user_id).maybeSingle();
      if (credit?.manually_blocked) return jsonResponse({ error: credit.blocked_reason || "Franquia bloqueada" }, 403);
      termDays = credit?.payment_term_days ?? 7;
    }
    const dueDate = dateInSaoPaulo(termDays);
    const { data: attempt, error: attemptError } = await admin.rpc("create_payment_attempt", {
      p_checkout_session_id: sessionId,
      p_provider: "asaas",
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
    const paymentAttempt = Array.isArray(attempt) ? attempt[0] : attempt;
    if (!paymentAttempt?.id) throw new Error("Falha ao criar tentativa financeira");

    const createInput: AsaasPaymentInput = {
      customer: providerCustomerId,
      billingType: session.customer_type === "franchise" ? "UNDEFINED" : method === "credit_card" ? "CREDIT_CARD" : "PIX",
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
        return errorResponse(`Cada parcela precisa ser de no mínimo R$ ${MIN_INSTALLMENT_VALUE},00`, 400);
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
      const savedMethodId = typeof body.savedPaymentMethodId === "string" ? body.savedPaymentMethodId : "";
      if (savedMethodId) {
        if (!auth.user) return errorResponse("Entre na conta para usar um cartão salvo", 401);
        const { data: saved } = await admin.from("customer_payment_methods")
          .select("token_ciphertext,token_iv,provider_customer_id")
          .eq("id", savedMethodId).eq("user_id", auth.user.id).is("revoked_at", null).single();
        if (!saved || saved.provider_customer_id !== providerCustomerId) {
          return errorResponse("Cartão salvo não está disponível", 409);
        }
        createInput.creditCardToken = await decryptPaymentToken(saved.token_ciphertext, saved.token_iv);
      } else {
        submittedCard = parseCard(body.card);
        const billing = session.billing_address_snapshot as Record<string, string>;
        if (!billing?.postalCode || !billing?.number) return errorResponse("Informe o endereço de cobrança", 400);
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
      providerPayment = await createAsaasPayment(createInput);
    } catch (createError) {
      // A resposta pode ter se perdido depois da criação. Consultar antes de
      // permitir outra tentativa evita duas cobranças para o mesmo clique.
      try {
        providerPayment = await findAsaasPaymentByExternalReference(paymentAttempt.external_reference);
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
      ...(directStatus === "received" ? { received_at: new Date().toISOString(), is_active: false } : {}),
    }).eq("id", paymentAttempt.id);
    if (paymentUpdateError) throw paymentUpdateError;

    if (session.customer_type === "franchise") {
      const shopifyToken = shopifyAdminToken();
      if (!shopifyToken || !session.shopify_draft_order_id) {
        throw new Error("Shopify não configurada para concluir pedido da franquia");
      }
      const completed = await completeDraftOrder(session.shopify_draft_order_id, shopifyToken, true, customer.cpfCnpj);
      if (!completed.requestOk || !completed.orderId) {
        throw new Error("Falha ao concluir pedido com prazo na Shopify");
      }
      await admin.from("checkout_sessions").update({
        status: "credit_approved",
        shopify_order_id: completed.orderId,
      }).eq("id", sessionId);
      return jsonResponse(safePaymentResponse(
        sessionId,
        paymentAttempt.id,
        "credit_approved",
        null,
        typeof providerPayment.invoiceUrl === "string" ? providerPayment.invoiceUrl : null,
      ));
    }

    if (method === "credit_card") {
      let cardSaved = false;
      const providerToken = typeof providerPayment.creditCardToken === "string" ? providerPayment.creditCardToken : "";
      if (body.saveCard === true && auth.user && providerToken) {
        try {
          const encrypted = await encryptPaymentToken(providerToken);
          const returnedDigits = String(providerPayment.creditCardNumber || submittedCard?.number || "").replace(/\D/g, "");
          const lastFour = returnedDigits.slice(-4);
          if (/^\d{4}$/.test(lastFour)) {
            await admin.from("customer_payment_methods").update({ is_default: false })
              .eq("user_id", auth.user.id).is("revoked_at", null);
            const { error: saveError } = await admin.from("customer_payment_methods").insert({
              user_id: auth.user.id,
              provider_customer_id: providerCustomerId,
              token_ciphertext: encrypted.ciphertext,
              token_iv: encrypted.iv,
              brand: providerPayment.creditCardBrand || null,
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
      await admin.from("checkout_sessions").update({ status: "payment_processing" }).eq("id", sessionId);
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
              externalReference: providerPayment.externalReference || paymentAttempt.external_reference,
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
        cardBrand: providerPayment.creditCardBrand || null,
        cardLastFour: String(providerPayment.creditCardNumber || submittedCard?.number || "").replace(/\D/g, "").slice(-4) || null,
      });
    }

    const qr = await getAsaasPixQrCode(providerPayment.id);
    const pixExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await Promise.all([
      admin.from("payments").update({
        provider_expires_at: qr.expirationDate,
        pix_expires_at: pixExpiresAt,
      }).eq("id", paymentAttempt.id),
      admin.from("checkout_sessions").update({ status: "payment_processing" }).eq("id", sessionId),
    ]);
    return jsonResponse(safePaymentResponse(sessionId, paymentAttempt.id, "pending", qr, null, pixExpiresAt));
  } catch (error) {
    console.error("checkout-payment:", error);
    const message = error instanceof Error ? error.message : "";
    if (requestedAction === "cancel_pix") {
      return errorResponse("Não foi possível confirmar o cancelamento do Pix. Tente novamente.", 502);
    }
    if (message.includes("Dados do cartão inválidos")) return errorResponse(message, 400);
    if (/Asaas 400:.*invalid_billingType/i.test(message)) {
      return errorResponse("O pagamento por cartão ainda não está habilitado nesta conta. Use Pix ou fale com o atendimento.", 503);
    }
    if (/Asaas 400:.*invalid_creditCard/i.test(message)) {
      return errorResponse("Transação não autorizada. Confira os dados do cartão ou tente outro cartão.", 402);
    }
    if (/Asaas 400:/.test(message)) {
      return errorResponse("Não foi possível validar o cartão e os dados do titular. Confira as informações e tente novamente.", 400);
    }
    if (/Asaas 401:/.test(message)) {
      return errorResponse("Pagamento temporariamente indisponível. Tente novamente mais tarde.", 503);
    }
    if (/Asaas 4\d\d:/.test(message)) return errorResponse("Pagamento recusado. Confira os dados ou use outra forma de pagamento.", 402);
    return errorResponse("Não foi possível iniciar o pagamento", 500);
  }
});
