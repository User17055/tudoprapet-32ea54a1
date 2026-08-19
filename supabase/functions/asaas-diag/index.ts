import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeadersWith, jsonResponse } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/webhook.ts";
import {
  createAsaasBudget,
  createAsaasPayment,
  deleteAsaasPayment,
  findOrCreateAsaasCustomer,
  getAsaasPayment,
  getAsaasPixQrCode,
} from "../_shared/asaas.ts";

// Diagnostico e ferramenta de operador, nao cliente: pode ser recusado. O teto e
// folgado para as sondas (cliente + cobranca + QR + exclusao = 4) e existe so
// para que um laco acidental sobre este endpoint nao consuma a cota da conta.
const DIAG_CALL_BUDGET = 10;


// Diagnóstico temporário do Pix no ambiente Sandbox. Protegido pelo token do worker.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeadersWith("x-payment-worker-token") });
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido" }, 405);

  const expected = Deno.env.get("PAYMENT_WORKER_TOKEN") || "";
  const received = req.headers.get("x-payment-worker-token") || "";
  const diagOpen = Deno.env.get("ASAAS_DIAG_OPEN") === "true";
  if (!diagOpen && (!expected || !timingSafeEqual(expected, received))) {
    return jsonResponse({ error: "Não autorizado" }, 401);
  }

  const baseUrl = (Deno.env.get("ASAAS_API_URL") || "https://api-sandbox.asaas.com/v3").replace(/\/$/, "");
  const environment = baseUrl.includes("sandbox") ? "sandbox" : "production";
  const budget = createAsaasBudget(DIAG_CALL_BUDGET);

  let requestedId: string | null = null;
  let probePix = false;
  let probeFees = false;
  try {
    const body = await req.json();
    if (body && typeof body.paymentId === "string" && body.paymentId.trim()) requestedId = body.paymentId.trim();
    if (body && body.probePix === true) probePix = true;
    if (body && body.probeFees === true) probeFees = true;
  } catch { requestedId = null; }

  // Sonda de tarifas: mostra as taxas da conta, inclusive as de parcelamento no cartão.
  if (probeFees) {
    const apiKey = Deno.env.get("ASAAS_API_KEY")?.trim() || "";
    const paths = ["/myAccount/fees", "/myAccount/paymentCheckoutConfig", "/installments?limit=1"];
    const results: Record<string, unknown> = {};
    for (const path of paths) {
      try {
        const probe = await fetch(`${baseUrl}${path}`, {
          headers: { access_token: apiKey, "Content-Type": "application/json" },
        });
        const text = await probe.text();
        results[path] = { httpStatus: probe.status, body: text.slice(0, 8000) };
      } catch (error) {
        results[path] = { error: error instanceof Error ? error.message : String(error) };
      }
    }
    return jsonResponse({ baseUrl, environment, fees: results });
  }


  // Sonda Pix: cria e apaga uma cobrança de R$ 1 para validar a chave Pix da conta.
  if (probePix) {
    const reference = `diag-pix-${Date.now()}`;
    try {
      const customer = await findOrCreateAsaasCustomer({
        externalReference: "diag-pix-customer",
        name: "Diagnostico TudoPraPet",
        cpfCnpj: "24971563792",
        email: "diagnostico@tudoprapet.com.br",
      }, budget);
      const payment = await createAsaasPayment({
        customer,
        billingType: "PIX",
        value: 1,
        dueDate: new Date().toISOString().slice(0, 10),
        description: "Diagnostico Pix",
        externalReference: reference,
      }, budget);
      let qrOk = false;
      let qrPrefix = "";
      let probeQrError: string | null = null;
      try {
        const qr = await getAsaasPixQrCode(payment.id, budget);
        qrOk = (qr.payload || "").startsWith("000201");
        qrPrefix = (qr.payload || "").slice(0, 40);
      } catch (error) {
        probeQrError = error instanceof Error ? error.message : String(error);
      }
      let deleted = false;
      try {
        deleted = (await deleteAsaasPayment(payment.id, budget)).deleted;
      } catch { deleted = false; }
      return jsonResponse({
        baseUrl,
        environment,
        probePix: { ok: qrOk, paymentId: payment.id, status: payment.status, qrPrefix, probeQrError, deleted },
      });
    } catch (error) {
      return jsonResponse({
        baseUrl,
        environment,
        probePix: { ok: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }


  // Sonda de credencial: confirma que a chave atual responde no ambiente configurado.
  let account: Record<string, unknown> | null = null;
  let accountError: string | null = null;
  try {
    const apiKey = Deno.env.get("ASAAS_API_KEY")?.trim() || "";
    const probe = await fetch(`${baseUrl}/myAccount`, {
      headers: { access_token: apiKey, "Content-Type": "application/json" },
    });
    const text = await probe.text();
    account = {
      httpStatus: probe.status,
      ok: probe.ok,
      snippet: text.slice(0, 300),
    };
  } catch (error) {
    accountError = error instanceof Error ? error.message : String(error);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const baseQuery = admin.from("payments")
    .select("id,provider_payment_id,status,amount,checkout_session_id,created_at");
  const { data: payment } = requestedId
    ? await baseQuery.eq("provider_payment_id", requestedId).maybeSingle()
    : await baseQuery.eq("method", "pix").not("provider_payment_id", "is", null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

  if (!payment?.provider_payment_id) {
    return jsonResponse({ baseUrl, environment, account, accountError, payment: null });
  }


  let remote: Record<string, unknown> = {};
  let remoteError: string | null = null;
  try {
    remote = await getAsaasPayment(payment.provider_payment_id, budget) as Record<string, unknown>;
  } catch (error) {
    remoteError = error instanceof Error ? error.message : String(error);
  }

  let qr: { encodedImage?: string; payload?: string; expirationDate?: string } = {};
  let qrError: string | null = null;
  try {
    qr = await getAsaasPixQrCode(payment.provider_payment_id, budget);
  } catch (error) {
    qrError = error instanceof Error ? error.message : String(error);
  }
  let pngValid = false;
  try {
    const bytes = Uint8Array.from(atob(qr.encodedImage ?? ""), (c) => c.charCodeAt(0));
    pngValid = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  } catch {
    pngValid = false;
  }

  return jsonResponse({
    baseUrl,
    environment,
    account,
    accountError,
    remoteError,
    payment: {
      localId: payment.id,
      providerPaymentId: payment.provider_payment_id,
      localStatus: payment.status,
      remoteStatus: remote.status ?? null,
      amount: payment.amount,
      dueDate: remote.dueDate ?? null,
      invoiceUrl: remote.invoiceUrl ?? null,
      createdAt: payment.created_at,
      checkoutSessionId: payment.checkout_session_id,
    },

    qrError,
    qr: {
      encodedImageLength: qr.encodedImage?.length ?? 0,
      pngValid,
      payloadLength: qr.payload?.length ?? 0,
      payloadPrefix: (qr.payload || "").slice(0, 40),
      payloadStartsWith000201: (qr.payload || "").startsWith("000201"),
      expirationDate: qr.expirationDate,
    },
  });
});
