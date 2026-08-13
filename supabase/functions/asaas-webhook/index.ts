import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeadersWith } from "../_shared/cors.ts";
import { parseAsaasEvent } from "../_shared/payment-events.ts";
import { timingSafeEqual } from "../_shared/webhook.ts";

const headers = { ...corsHeadersWith("asaas-access-token"), "Content-Type": "application/json" };

function response(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function wakeWorker(): void {
  const url = Deno.env.get("SUPABASE_URL");
  const token = Deno.env.get("PAYMENT_WORKER_TOKEN");
  if (!url || !token) {
    console.error("Worker financeiro não configurado");
    return;
  }
  const task = fetch(`${url}/functions/v1/asaas-process-events`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-payment-worker-token": token },
    body: JSON.stringify({ source: "asaas-webhook" }),
  }).then(async (workerResponse) => {
    if (!workerResponse.ok) console.error("Worker financeiro respondeu", workerResponse.status);
  }).catch((error) => console.error("Falha ao acordar worker financeiro:", error));
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil(value: Promise<unknown>): void } }).EdgeRuntime;
  runtime?.waitUntil(task);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return response({ error: "Método não permitido" }, 405);

  const expectedToken = Deno.env.get("ASAAS_WEBHOOK_TOKEN") || "";
  const receivedToken = req.headers.get("asaas-access-token") || "";
  if (!expectedToken || !timingSafeEqual(expectedToken, receivedToken)) {
    return response({ error: "Webhook não autorizado" }, 401);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return response({ error: "JSON inválido" }, 400);
  }

  const event = parseAsaasEvent(raw);
  if (!event) return response({ error: "Evento inválido" }, 400);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await admin.from("payment_events").insert({
    provider: "asaas",
    provider_event_id: event.eventId,
    provider_payment_id: event.providerPaymentId,
    event_type: event.eventType,
    payload: event.payload,
  });

  // Entrega at-least-once: o mesmo ID persistido continua sendo sucesso.
  if (error?.code === "23505") {
    wakeWorker();
    return response({ received: true, duplicate: true }, 200);
  }
  if (error) {
    console.error("Falha ao persistir webhook Asaas:", error.code, error.message);
    return response({ error: "Falha ao persistir evento" }, 500);
  }

  // O disparo fica em background: o 200 não espera Shopify nem Asaas. O cron
  // de conciliação continua sendo a garantia para retentativas demoradas.
  wakeWorker();
  // O Asaas atualmente exige exatamente 200. Trabalho externo fica no worker.
  return response({ received: true }, 200);
});
