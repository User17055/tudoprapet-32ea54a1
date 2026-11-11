import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { errorResponse, jsonResponse } from "../_shared/cors.ts";
import { parseWebhookBody, processOlistWebhookEvent } from "../_shared/olist-sales.ts";

/**
 * Recebe os webhooks da Olist (situação de pedido e NF-e autorizada).
 *
 * A Olist não assina os avisos: a URL cadastrada leva um segredo longo
 * (`?secret=...`, OLIST_WEBHOOK_SECRET) e o conteúdo do aviso nunca é usado
 * como verdade — o processamento relê pedido e nota na própria API.
 *
 * Responde 200 logo depois de gravar o aviso (a Olist espera até 30 s e
 * reenvia poucas vezes). O processamento roda em segundo plano; se falhar, a
 * sincronização (olist-sales-sync) reprocessa o aviso gravado.
 */

function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) diff |= left[index] ^ right[index];
  return diff === 0;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);
  const secret = Deno.env.get("OLIST_WEBHOOK_SECRET") || "";
  if (secret.length < 24) return errorResponse("Webhook Olist não configurado", 503);
  const provided = new URL(req.url).searchParams.get("secret") || "";
  if (!safeEqual(provided, secret)) return errorResponse("Não autorizado", 401);

  const raw = await req.text();
  if (raw.length > 1_000_000) return errorResponse("Aviso grande demais", 413);
  const payload = parseWebhookBody(raw);
  if (!payload || typeof payload !== "object") return errorResponse("Aviso inválido", 400);
  const event = String(payload.evento || payload.tipo || "desconhecido").trim().slice(0, 80);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const dedupeKey = await sha256(raw);
  const { data: inserted, error } = await admin.from("olist_webhook_events")
    .upsert(
      { event, dedupe_key: dedupeKey, payload },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    )
    .select("id,attempts");
  if (error) {
    console.error("olist-webhook gravar aviso:", error);
    // 500 faz a Olist reenviar: o aviso não pode se perder.
    return errorResponse("Falha ao registrar aviso", 500);
  }
  const record = inserted?.[0];
  // Reenvio de um aviso já gravado: nada a fazer, a fila cuida dele.
  if (!record) return jsonResponse({ ok: true, duplicate: true });

  const token = Deno.env.get("OLIST_API_TOKEN") || Deno.env.get("TINY_API_TOKEN") || "";
  if (token) {
    const task = (async () => {
      try {
        await processOlistWebhookEvent(admin, event, payload, token);
        await admin.from("olist_webhook_events").update({
          processed_at: new Date().toISOString(),
          attempts: record.attempts + 1,
        }).eq("id", record.id);
      } catch (processError) {
        console.error(`olist-webhook ${event}:`, processError);
        await admin.from("olist_webhook_events").update({
          attempts: record.attempts + 1,
          last_error: (processError instanceof Error ? processError.message : String(processError))
            .slice(0, 2000),
        }).eq("id", record.id);
      }
    })();
    const runtime = (globalThis as unknown as {
      EdgeRuntime?: { waitUntil(value: Promise<unknown>): void };
    }).EdgeRuntime;
    if (runtime) runtime.waitUntil(task);
    else await task;
  }
  return jsonResponse({ ok: true });
});
