import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, FUNCTIONS_VERSION, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { cloneLegacyFiscalDraftOrder, completeDraftOrder, deleteDraftOrder } from "../_shared/shopify.ts";
import {
  type AsaasBudget,
  AsaasBudgetExhausted,
  createAsaasBudget,
  getAsaasPayment,
  isAsaasBudgetExhausted,
} from "../_shared/asaas.ts";
import { isPaidAsaasProviderStatus, mapAsaasPaymentStatus } from "../_shared/payment-events.ts";

// Teto de chamadas ao Asaas por requisicao desta funcao.
//
// A varredura le ate 100 sessoes sem pedido Shopify e, ate 19/08/2026,
// consultava TODAS elas no Asaas sem teto nenhum. Como sessoes `expired`,
// `cancelled` e `failed` nunca ganham `shopify_order_id`, elas ficavam na
// consulta para sempre: o conjunto so crescia e era reconsultado inteiro a cada
// chamada. Com o agente de impressao batendo aqui a cada 20s, deu ~216.000
// requisicoes em 12h e derrubou a cota da conta pela segunda vez.
//
// 15 por requisicao nao conclui a fila de uma vez, e nao precisa: a varredura e
// uma rede de seguranca e cada nova chamada avanca mais um pedaco.
const ASAAS_CALL_BUDGET = 15;

// Intervalo minimo entre duas varreduras, contando todos os chamadores juntos
// (aba Pedidos, impressao de etiqueta, qualquer gatilho futuro). Reusa o mesmo
// `claim_worker_lease` do worker: a tabela e generica, uma linha por nome.
//
// 3 minutos, e nao 10: com o agente de impressao ja fora, isto e backstop contra
// repeticao patologica -- um F5 nervoso, ou um gatilho novo que alguem adicione
// sem saber deste custo. Segurar o admin por 10 min para proteger de um caso que
// o orcamento ja limita seria pagar fricção real por risco pequeno. No pior caso
// sao 20 rodadas/h x 15 = 300 chamadas/h.
//
// `release_worker_lease` nao mexe em `last_run_at` de proposito, entao devolver o
// lease no fim da rodada NAO encurta este intervalo -- so libera a exclusao mutua.
const RECOVERY_LEASE = "admin-orders-recovery";
const RECOVERY_LEASE_SECONDS = 120;
const RECOVERY_COOLDOWN_SECONDS = 180;

const SHOP = "petjoy-deals-hb8r9.myshopify.com";
const API = "2025-07";
const FIELDS = [
  "id", "name", "created_at", "cancelled_at", "cancel_reason", "total_price", "subtotal_price",
  "total_discounts", "currency", "financial_status", "fulfillment_status", "customer", "email", "phone",
  "shipping_address", "billing_address", "line_items", "shipping_lines", "note", "tags", "note_attributes",
].join(",");

function deliveryLabel(order: any): { label: string; method: string } {
  const line = order.shipping_lines?.[0] || {};
  const method = [line.title, line.code, line.source]
    .filter(Boolean)
    .join(" ")
    .trim();
  const searchable = method.toLowerCase();
  if (/retirada|retire|pickup|pick_up|local pickup|shop location/.test(searchable)) return { label: "RETIRADA", method: "Retirada na loja" };
  if (/\bpac\b|correios pac/.test(searchable)) return { label: "PAC", method: method || "PAC" };
  if (/sedex/.test(searchable)) return { label: "SEDEX", method };
  if (/moto|motoboy|entrega local/.test(searchable)) return { label: "MOTOBOY", method };
  const label = method.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/gi, " ").trim().slice(0, 18).toUpperCase();
  return { label: label || "ENVIO", method: method || "Envio" };
}

async function resolvedDeliveryLabel(order: any, shopifyToken: string): Promise<{ label: string; method: string }> {
  const preliminary = deliveryLabel(order);
  const attributes = (order.note_attributes || []).map((item: any) => `${item?.name || ""} ${item?.value || ""}`).join(" ");
  const pickupEvidence = `${order.tags || ""} ${attributes}`.toLowerCase();
  if (/codigo de retirada|pronto[- ]retirada|ready-for-pickup|\bretirada\b|\bpick[_ -]?up\b/.test(pickupEvidence)) {
    return { label: "RETIRADA", method: "Retirada na loja" };
  }
  if (preliminary.label !== "ENVIO") return preliminary;

  try {
    const response = await fetch(`https://${SHOP}/admin/api/${API}/orders/${order.id}/fulfillment_orders.json`, {
      headers: { "X-Shopify-Access-Token": shopifyToken },
    });
    if (!response.ok) {
      console.error(`Shopify fulfillment_orders ${order.id}:`, response.status);
      return preliminary;
    }
    const data = await response.json();
    const methods = (data.fulfillment_orders || []).map((item: any) => String(item?.delivery_method?.method_type || "").toLowerCase());
    if (methods.some((method: string) => method.replace(/[-\s]+/g, "_") === "pick_up")) {
      return { label: "RETIRADA", method: "Retirada na loja" };
    }
  } catch (error) {
    console.error(`Shopify fulfillment_orders ${order.id}:`, error);
  }
  return preliminary;
}

function nextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

type FulfillmentOrderForAction = {
  id: string;
  status: string;
  deliveryMethod?: { methodType?: string | null } | null;
};

async function shopifyGraphql(
  shopifyToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<any> {
  const response = await fetch(`https://${SHOP}/admin/api/${API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyToken },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.errors?.length) {
    const message = body?.errors?.map((item: { message?: string }) => item.message).filter(Boolean).join("; ")
      || `Shopify respondeu HTTP ${response.status}`;
    throw new Error(message);
  }
  return body?.data;
}

async function openFulfillmentOrders(orderId: string, shopifyToken: string): Promise<FulfillmentOrderForAction[]> {
  const numericOrderId = orderId.replace(/\D/g, "");
  if (!numericOrderId) throw new Error("Pedido inválido");
  const data = await shopifyGraphql(shopifyToken, `query OrderFulfillmentActions($id: ID!) {
    order(id: $id) {
      fulfillmentOrders(first: 20, query: "status:open OR status:in_progress") {
        nodes { id status deliveryMethod { methodType } }
      }
    }
  }`, { id: `gid://shopify/Order/${numericOrderId}` });
  if (!data?.order) throw new Error("Pedido não encontrado na Shopify");
  return (data.order.fulfillmentOrders?.nodes || []).filter((item: FulfillmentOrderForAction) =>
    ["OPEN", "IN_PROGRESS"].includes(String(item.status || "").toUpperCase())
  );
}

function isPickupFulfillmentOrder(order: FulfillmentOrderForAction): boolean {
  return /pick[_ -]?up/.test(String(order.deliveryMethod?.methodType || "").toLowerCase());
}

async function fulfillShipment(
  orderId: string,
  tracking: { number: string; company?: string; url?: string },
  shopifyToken: string,
): Promise<number> {
  const fulfillmentOrders = (await openFulfillmentOrders(orderId, shopifyToken)).filter((item) => !isPickupFulfillmentOrder(item));
  if (!fulfillmentOrders.length) throw new Error("Este pedido não possui um envio aberto na Shopify");
  let created = 0;
  // A Shopify exige um fulfillment por local de estoque. Processar cada ordem
  // separadamente tambem torna uma nova tentativa segura apos falha parcial.
  for (const fulfillmentOrder of fulfillmentOrders) {
    const data = await shopifyGraphql(shopifyToken, `mutation FulfillShipment($fulfillment: FulfillmentInput!) {
      fulfillmentCreate(fulfillment: $fulfillment) {
        fulfillment { id status }
        userErrors { field message }
      }
    }`, {
      fulfillment: {
        lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: fulfillmentOrder.id }],
        notifyCustomer: true,
        trackingInfo: {
          number: tracking.number,
          ...(tracking.company ? { company: tracking.company } : {}),
          ...(tracking.url ? { url: tracking.url } : {}),
        },
      },
    });
    const errors = data?.fulfillmentCreate?.userErrors || [];
    if (errors.length) throw new Error(errors.map((item: { message?: string }) => item.message).filter(Boolean).join("; "));
    if (!data?.fulfillmentCreate?.fulfillment?.id) throw new Error("A Shopify não confirmou o envio");
    created++;
  }
  return created;
}

async function recoverPaidOrders(
  adminDb: any,
  shopifyToken: string,
  budget: AsaasBudget,
): Promise<{
  recovered: number;
  pending: number;
  pendingSales: Array<{ id: string; customerName: string; total: number; createdAt: string; error?: string }>;
}> {
  const { data: sessions, error: sessionsError } = await adminDb
    .from("checkout_sessions")
    .select("id,user_id,shopify_draft_order_id,customer_snapshot,total,created_at")
    .is("shopify_order_id", null)
    // Inclui awaiting_payment porque a cobranca pode ter sido criada no Asaas
    // antes de uma falha ao atualizar o estado local. O status remoto continua
    // sendo a autoridade antes de qualquer recuperacao.
    .in("status", ["awaiting_payment", "payment_processing", "paid", "paid_pending_shopify", "expired", "cancelled", "failed"])
    .order("updated_at", { ascending: false })
    .limit(100);
  if (sessionsError) {
    console.error("Falha ao carregar vendas pagas sem pedido:", sessionsError);
    return { recovered: 0, pending: 0, pendingSales: [] };
  }

  // Sessões antigas podem não ter o CPF no snapshot. Quando a compra pertence
  // a uma conta, recupere-o do perfil salvo para também reparar esses drafts.
  const profileCpfByUser = new Map<string, string>();
  const userIdsMissingCpf = [...new Set((sessions || [])
    .filter((row: any) => row.user_id && !row.customer_snapshot?.cpfCnpj)
    .map((row: any) => String(row.user_id)))];
  if (userIdsMissingCpf.length) {
    const { data: profiles, error: profilesError } = await adminDb
      .from("checkout_customer_profiles")
      .select("user_id,cpf_cnpj")
      .in("user_id", userIdsMissingCpf);
    if (profilesError) console.error("Falha ao recuperar CPF de perfis antigos:", profilesError);
    for (const profile of profiles || []) {
      if (profile.user_id && profile.cpf_cnpj) profileCpfByUser.set(String(profile.user_id), String(profile.cpf_cnpj));
    }
  }

  const sessionIds = (sessions || []).map((row: any) => row.id);
  if (!sessionIds.length) return { recovered: 0, pending: 0, pendingSales: [] };
  const { data: paidPayments, error: paymentsError } = await adminDb
    .from("payments")
    .select("id,checkout_session_id,attempt_number,status,provider_payment_id")
    .in("checkout_session_id", sessionIds)
    .not("provider_payment_id", "is", null)
    .order("attempt_number", { ascending: false });
  if (paymentsError) {
    console.error("Falha ao validar vendas pagas sem pedido:", paymentsError);
    return { recovered: 0, pending: 0, pendingSales: [] };
  }
  // Um webhook perdido pode deixar o pagamento local como pending apesar de o
  // Asaas ja ter confirmado. Consulte a fonte financeira antes de decidir se o
  // Draft Order pode virar pedido Shopify. Tambem evita recuperar uma cobranca
  // que depois foi estornada.
  const latestPaymentBySession = new Map<string, any>();
  for (const payment of paidPayments || []) {
    if (!latestPaymentBySession.has(payment.checkout_session_id)) {
      latestPaymentBySession.set(payment.checkout_session_id, payment);
    }
  }
  const paidSessionIds = new Set<string>();
  const candidates = [...latestPaymentBySession.values()];
  for (let start = 0; start < candidates.length; start += 5) {
    // O teto e conferido entre lotes, e nao so dentro de `asaasRequest`: assim a
    // varredura para de vez em vez de disparar mais 5 chamadas que ja nascem
    // condenadas a AsaasBudgetExhausted.
    if (isAsaasBudgetExhausted(budget)) break;
    const batch = candidates.slice(start, start + 5);
    await Promise.all(batch.map(async (payment: any) => {
      try {
        const remote = await getAsaasPayment(payment.provider_payment_id, budget);
        const remoteStatus = String(remote.status || "").toUpperCase();
        if (!isPaidAsaasProviderStatus(remoteStatus)) return;
        const localStatus = mapAsaasPaymentStatus("", remoteStatus);
        if (!localStatus || !["confirmed", "received"].includes(localStatus)) return;
        const now = new Date().toISOString();
        const { error: paymentUpdateError } = await adminDb.from("payments").update({
          status: localStatus,
          raw_status: remoteStatus,
          is_active: false,
          ...(localStatus === "confirmed" ? { confirmed_at: now } : { received_at: now }),
        }).eq("id", payment.id);
        if (paymentUpdateError) throw paymentUpdateError;
        paidSessionIds.add(payment.checkout_session_id);
      } catch (error) {
        // Teto atingido nao e falha desta cobranca, e o fim da rodada: o resto
        // sai na proxima chamada. Registrar como erro poluiria o log justamente
        // quando ha fila, que e quando o log precisa estar legivel.
        if (error instanceof AsaasBudgetExhausted) return;
        console.error(`Falha ao conferir pagamento Asaas ${payment.provider_payment_id}:`, error);
      }
    }));
  }

  let recoveredThisRequest = 0;
  let pending = paidSessionIds.size;
  const recoveredSessionIds = new Set<string>();
  const pendingErrors = new Map<string, string>();
  for (const session of sessions || []) {
    if (!paidSessionIds.has(session.id)) continue;
    // Nao deixe a recuperacao de um lote antigo atrasar o carregamento da tela.
    // O cron processa o restante e cada nova consulta recupera mais um lote.
    if (recoveredThisRequest >= 3) break;
    if (!session.shopify_draft_order_id) {
      console.error(`Venda paga ${session.id} esta sem Draft Order Shopify`);
      pendingErrors.set(session.id, "Esta venda paga nao possui um rascunho vinculado na Shopify.");
      continue;
    }
    const cpfCnpj = session.customer_snapshot?.cpfCnpj || profileCpfByUser.get(String(session.user_id || "")) || null;
    const legacyDraftOrderId = String(session.shopify_draft_order_id);
    let activeDraftOrderId = legacyDraftOrderId;
    let completed = await completeDraftOrder(
      session.shopify_draft_order_id,
      shopifyToken,
      false,
      cpfCnpj,
    );
    const fiscalFailure = /CPF|CNPJ|credencial fiscal|imposto duplicado/i.test(completed.error || "");
    if ((!completed.requestOk || !completed.orderId) && fiscalFailure && cpfCnpj) {
      const replacement = await cloneLegacyFiscalDraftOrder(legacyDraftOrderId, cpfCnpj, shopifyToken);
      if (replacement.requestOk && replacement.draftOrderId) {
        const { data: relinked, error: relinkError } = await adminDb.from("checkout_sessions")
          .update({ shopify_draft_order_id: replacement.draftOrderId })
          .eq("id", session.id)
          .eq("shopify_draft_order_id", legacyDraftOrderId)
          .is("shopify_order_id", null)
          .select("id")
          .maybeSingle();
        if (relinkError || !relinked) {
          console.error(`Nao foi possivel vincular o draft substituto da venda ${session.id}:`, relinkError);
          await deleteDraftOrder(replacement.draftOrderId, shopifyToken);
        } else {
          activeDraftOrderId = replacement.draftOrderId;
          completed = await completeDraftOrder(activeDraftOrderId, shopifyToken, false, cpfCnpj);
          if (completed.requestOk && completed.orderId) {
            await deleteDraftOrder(legacyDraftOrderId, shopifyToken);
          }
        }
      } else if (replacement.error) {
        completed = { ...completed, error: replacement.error };
      }
    }
    if (!completed.requestOk || !completed.orderId) {
      await adminDb.from("checkout_sessions").update({ status: "paid_pending_shopify" })
        .eq("id", session.id).is("shopify_order_id", null);
      console.error(`Venda paga ${session.id} ainda nao pode ser concluida na Shopify`);
      pendingErrors.set(session.id, completed.error || "A Shopify ainda nao permitiu concluir este rascunho.");
      continue;
    }
    const { error: updateError } = await adminDb.from("checkout_sessions").update({
      status: "shopify_created",
      shopify_order_id: completed.orderId,
    }).eq("id", session.id).is("shopify_order_id", null);
    if (updateError) {
      console.error(`Pedido Shopify ${completed.orderId} criado, mas a sessao ${session.id} nao foi atualizada:`, updateError);
      continue;
    }
    recoveredThisRequest++;
    pending--;
    recoveredSessionIds.add(session.id);
  }
  const pendingSales = (sessions || [])
    .filter((session: any) => paidSessionIds.has(session.id) && !recoveredSessionIds.has(session.id))
    .map((session: any) => ({
      id: session.id,
      customerName: String(session.customer_snapshot?.name || "Cliente não identificado"),
      total: Number(session.total || 0),
      createdAt: String(session.created_at || ""),
      error: pendingErrors.get(session.id),
    }));
  return { recovered: recoveredThisRequest, pending: Math.max(0, pending), pendingSales };
}

function normalize(order: any, delivery = deliveryLabel(order)) {
  const address = order.shipping_address || order.billing_address;
  const addressText = address ? [
    address.address1, address.address2, address.neighborhood,
    [address.city, address.province_code].filter(Boolean).join("/"), address.zip,
  ].filter(Boolean).join(", ") : null;
  const customerName = [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ")
    || address?.name || "Cliente não identificado";
  const pickupReadyByCode = (order.note_attributes || []).some((item: { name?: string; value?: string }) =>
    /codigo de retirada/i.test(String(item?.name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")) &&
    String(item?.value || "").trim().length > 0
  );
  const pickupReady = pickupReadyByCode || /pronto[- ]retirada|ready-for-pickup/i.test(String(order.tags || ""));
  return {
    id: order.id,
    name: order.name || `#${order.id}`,
    created_at: order.created_at,
    cancelled_at: order.cancelled_at || null,
    cancel_reason: order.cancel_reason || null,
    total_price: Number(order.total_price || 0),
    subtotal_price: Number(order.subtotal_price || 0),
    total_discounts: Number(order.total_discounts || 0),
    shipping_price: Number(order.shipping_lines?.[0]?.price || 0),
    shipping_method: delivery.method,
    delivery_label: delivery.label,
    currency: order.currency || "BRL",
    financial_status: order.financial_status || "pending",
    fulfillment_status: order.fulfillment_status || null,
    pickup_ready: pickupReady,
    customer_name: customerName,
    email: order.email || order.customer?.email || null,
    phone: order.phone || order.customer?.phone || address?.phone || null,
    address: addressText,
    note: order.note || null,
    line_items: (order.line_items || []).map((item: any) => ({
      title: item.title || item.name || "Produto",
      variant_title: item.variant_title || null,
      sku: item.sku || null,
      quantity: Number(item.quantity || 0),
      price: Number(item.price || 0),
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const configuredAgentToken = Deno.env.get("PRINT_AGENT_TOKEN") || "";
  const suppliedAgentToken = req.headers.get("x-print-agent-token") || "";
  const isAgent = configuredAgentToken.length >= 24 && suppliedAgentToken === configuredAgentToken;
  if (!isAgent) {
    const auth = await requireAdmin(req);
    if (!auth.ok) return auth.response;
  }

  let body: {
    action?: string; since?: string; limit?: number; orderId?: string; orderName?: string;
    zpl?: string; jobId?: string; status?: string; error?: string;
    trackingNumber?: string; trackingCompany?: string; trackingUrl?: string;
  } = {};
  if (req.method !== "GET") body = await req.json().catch(() => ({}));
  const url = new URL(req.url);
  const action = body.action || url.searchParams.get("action") || "list";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminDb = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  if (action === "queue_print") {
    if (isAgent) return errorResponse("Ação restrita ao administrador", 403);
    if (!body.orderId || !body.orderName || !body.zpl?.startsWith("^XA") || !body.zpl.trimEnd().endsWith("^XZ") || body.zpl.length > 1_000_000) {
      return errorResponse("Pedido ou código ZPL inválido", 400);
    }
    const { data: existing } = await adminDb
      .from("print_jobs")
      .select("id")
      .eq("order_id", String(body.orderId))
      .eq("status", "queued")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return jsonResponse({ queued: true, job_id: existing.id, already_queued: true, functions_version: FUNCTIONS_VERSION });

    const { data, error } = await adminDb.from("print_jobs").insert({ order_id: String(body.orderId), order_name: body.orderName, zpl: body.zpl, source: "manual" }).select("id").single();
    if (error) { console.error("queue_print:", error); return errorResponse("Falha ao colocar pedido na fila", 500); }
    return jsonResponse({ queued: true, job_id: data.id, functions_version: FUNCTIONS_VERSION });
  }

  if (action === "print_jobs") {
    if (!isAgent) return errorResponse("Ação restrita ao agente", 403);
    const { data, error } = await adminDb.from("print_jobs").select("id,order_id,order_name,zpl,created_at").eq("status", "queued").order("created_at", { ascending: true }).limit(25);
    if (error) return errorResponse("Falha ao consultar fila", 500);
    return jsonResponse({ jobs: data || [], server_time: new Date().toISOString() });
  }

  if (action === "print_status") {
    if (isAgent || !body.jobId) return errorResponse("Consulta inválida", 400);
    const { data, error } = await adminDb
      .from("print_jobs")
      .select("id,status,error_message,created_at,printed_at")
      .eq("id", body.jobId)
      .maybeSingle();
    if (error) return errorResponse("Falha ao consultar impressão", 500);
    if (!data) return errorResponse("Impressão não encontrada", 404);
    return jsonResponse({ job: data });
  }

  if (action === "ack_print") {
    if (!isAgent || !body.jobId || !["printed", "error"].includes(body.status || "")) return errorResponse("Confirmação inválida", 400);
    const update = body.status === "printed"
      ? { status: "printed", printed_at: new Date().toISOString(), error_message: null }
      : { status: "error", error_message: String(body.error || "Falha na impressora").slice(0, 500) };
    const { error } = await adminDb.from("print_jobs").update(update).eq("id", body.jobId).eq("status", "queued");
    if (error) return errorResponse("Falha ao confirmar impressão", 500);
    return jsonResponse({ ok: true });
  }

  const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  if (!shopifyToken) return errorResponse("SHOPIFY_ACCESS_TOKEN não configurado", 500);

  try {
    if (action === "fulfill_with_tracking") {
      if (isAgent) return errorResponse("Ação restrita ao administrador", 403);
      if (!body.orderId) return errorResponse("Pedido inválido", 400);
      const trackingNumber = String(body.trackingNumber || "").trim().slice(0, 100);
      const trackingCompany = String(body.trackingCompany || "").trim().slice(0, 100);
      const trackingUrl = String(body.trackingUrl || "").trim().slice(0, 500);
      if (trackingNumber.length < 3) return errorResponse("Informe um código de rastreio válido", 400);
      if (trackingUrl) {
        try {
          const parsed = new URL(trackingUrl);
          if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
        } catch {
          return errorResponse("Informe uma URL de rastreio válida", 400);
        }
      }
      const count = await fulfillShipment(body.orderId, {
        number: trackingNumber,
        ...(trackingCompany ? { company: trackingCompany } : {}),
        ...(trackingUrl ? { url: trackingUrl } : {}),
      }, shopifyToken);
      return jsonResponse({ ok: true, fulfillments: count });
    }

    // Ao abrir Pedidos, recupera tambem vendas antigas cujo pagamento foi
    // confirmado mas cuja conclusao do Draft Order falhou anteriormente.
    //
    // O agente de impressao NAO entra aqui. Ele chama esta funcao sem `action`,
    // o que cai no default "list", e faz isso a cada 20s para sempre: era ele
    // sozinho consumindo a cota do Asaas da conta inteira. O agente imprime
    // etiqueta e le apenas `orders` e `server_time` da resposta -- conciliacao
    // financeira nunca foi trabalho dele.
    //
    // Sobre a cobertura que isso reduz: a varredura passa a rodar quando um
    // admin abre Pedidos, e nao a cada 20s. E a troca certa. O worker ja concilia
    // `paid_pending_shopify` a cada 10 min pelo cron; o que so esta varredura
    // pega e o caso raro de sessao terminal localmente mas paga no Asaas. Com a
    // cota estourada, `createAsaasPayment` passa a falhar e o checkout para de
    // vender -- muito pior que uma conciliacao atrasada.
    let recovery = { recovered: 0, pending: 0, pendingSales: [] as Array<Record<string, unknown>> };
    let recoveryThrottled = true;
    if (!isAgent) {
      // O lease so decide SE a rodada acontece. Quem garante o teto e o
      // orcamento, entao qualquer falha aqui segue em frente: a tela do admin
      // nao pode quebrar por causa de um controle de custo, e o gasto continua
      // limitado a ASAAS_CALL_BUDGET de qualquer jeito.
      let leaseRunId: string | null = null;
      const { data: claimed, error: leaseError } = await adminDb.rpc("claim_worker_lease", {
        p_name: RECOVERY_LEASE,
        p_lease_seconds: RECOVERY_LEASE_SECONDS,
        p_cooldown_seconds: RECOVERY_COOLDOWN_SECONDS,
      });
      if (leaseError) {
        console.warn("Lease da recuperacao indisponivel; seguindo com o teto de orcamento:", leaseError);
        recoveryThrottled = false;
      } else {
        leaseRunId = typeof claimed === "string" ? claimed : null;
        recoveryThrottled = leaseRunId === null;
      }
      if (!recoveryThrottled) {
        const budget = createAsaasBudget(ASAAS_CALL_BUDGET);
        try {
          recovery = await recoverPaidOrders(adminDb, shopifyToken, budget);
        } finally {
          if (leaseRunId) {
            const { error: releaseError } = await adminDb.rpc("release_worker_lease", {
              p_name: RECOVERY_LEASE,
              p_run_id: leaseRunId,
            });
            if (releaseError) console.error("Falha ao liberar lease da recuperacao:", releaseError);
          }
        }
      }
    }

    const since = body.since || url.searchParams.get("since") || "";
    const requestedLimit = Math.min(Math.max(Number(body.limit || url.searchParams.get("limit") || (isAgent ? 50 : 100)), 1), 250);
    const query = new URLSearchParams({ status: "any", limit: String(Math.min(requestedLimit, 250)), order: "created_at desc", fields: FIELDS });
    if (since) query.set("created_at_min", since);

    let next: string | null = `https://${SHOP}/admin/api/${API}/orders.json?${query}`;
    const all: any[] = [];
    while (next && all.length < requestedLimit) {
      const response = await fetch(next, { headers: { "X-Shopify-Access-Token": shopifyToken } });
      if (!response.ok) {
        console.error("Shopify orders:", response.status, await response.text());
        return errorResponse("Falha ao buscar pedidos na Shopify", 502);
      }
      const data = await response.json();
      all.push(...(data.orders || []));
      next = nextLink(response.headers.get("link"));
    }

    const selected = all.slice(0, requestedLimit);
    // Em lotes pequenos: 1 requisição extra por pedido em paralelo estourava o
    // limite da Shopify e o tempo da function.
    const orders: any[] = [];
    for (let start = 0; start < selected.length; start += 5) {
      const batch = selected.slice(start, start + 5);
      orders.push(...await Promise.all(batch.map(async (order: any) => normalize(order, await resolvedDeliveryLabel(order, shopifyToken)))));
    }
    const { data: checkoutLogs, error: checkoutLogsError } = await adminDb
      .from("checkout_attempt_logs")
      .select("id,created_at,checkout_session_id,customer_name,customer_email,payment_method,stage,success,error_message,provider_payment_id,metadata")
      .order("created_at", { ascending: false })
      .limit(100);
    if (checkoutLogsError) {
      // Mantem Pedidos funcionando durante a janela entre deploy e migration.
      console.error("Falha ao carregar logs de checkout:", checkoutLogsError.message);
    }
    const loggedSessionIds = [...new Set((checkoutLogs || [])
      .map((entry) => entry.checkout_session_id)
      .filter((id): id is string => Boolean(id)))];
    const paymentBySession = new Map<string, any>();
    if (loggedSessionIds.length) {
      const { data: generatedPayments, error: generatedPaymentsError } = await adminDb
        .from("payments")
        .select("checkout_session_id,method,amount,status,provider_payment_id,created_at")
        .in("checkout_session_id", loggedSessionIds)
        .order("created_at", { ascending: false });
      if (generatedPaymentsError) {
        console.error("Falha ao carregar pagamentos dos logs:", generatedPaymentsError.message);
      } else {
        for (const payment of generatedPayments || []) {
          if (!paymentBySession.has(payment.checkout_session_id)) {
            paymentBySession.set(payment.checkout_session_id, payment);
          }
        }
      }
    }
    const enrichedCheckoutLogs = (checkoutLogs || []).map((entry) => {
      const payment = entry.checkout_session_id
        ? paymentBySession.get(entry.checkout_session_id)
        : null;
      const metadata = entry.metadata && typeof entry.metadata === "object"
        ? entry.metadata as Record<string, unknown>
        : {};
      const metadataAmount = Number(metadata.amount ?? metadata.total);
      return {
        ...entry,
        generated_payment_method: payment?.method || entry.payment_method,
        generated_amount: payment
          ? Number(payment.amount)
          : (Number.isFinite(metadataAmount) ? metadataAmount : null),
        generated_payment_status: payment?.status || null,
        provider_payment_id: payment?.provider_payment_id || entry.provider_payment_id,
      };
    });
    return jsonResponse({
      orders,
      count: orders.length,
      recovery,
      // `true` quando esta resposta nao verificou nada no Asaas -- agente de
      // impressao, ou outra chamada dentro do intervalo minimo. Sem isto a tela
      // mostraria "0 vendas pendentes" achando que conferiu, quando na verdade
      // nem olhou. O front usa este campo para preservar o aviso anterior.
      recoveryThrottled,
      checkoutLogs: enrichedCheckoutLogs,
      functions_version: FUNCTIONS_VERSION,
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    console.error("admin-orders:", error);
    if (action === "fulfill_with_tracking") {
      return errorResponse(error instanceof Error ? error.message : "Falha ao atualizar o pedido", 502);
    }
    return errorResponse("Erro interno ao carregar pedidos", 500);
  }
});
