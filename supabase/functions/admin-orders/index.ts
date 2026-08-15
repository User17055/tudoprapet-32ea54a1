import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, FUNCTIONS_VERSION, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { completeDraftOrder } from "../_shared/shopify.ts";

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

async function recoverPaidOrders(
  adminDb: any,
  shopifyToken: string,
): Promise<{
  recovered: number;
  pending: number;
  pendingSales: Array<{ id: string; customerName: string; total: number; createdAt: string }>;
}> {
  const { data: sessions, error: sessionsError } = await adminDb
    .from("checkout_sessions")
    .select("id,shopify_draft_order_id,customer_snapshot,total,created_at")
    .is("shopify_order_id", null)
    .in("status", ["payment_processing", "paid", "paid_pending_shopify"])
    .order("updated_at", { ascending: true })
    .limit(20);
  if (sessionsError) {
    console.error("Falha ao carregar vendas pagas sem pedido:", sessionsError);
    return { recovered: 0, pending: 0, pendingSales: [] };
  }

  const sessionIds = (sessions || []).map((row: any) => row.id);
  if (!sessionIds.length) return { recovered: 0, pending: 0, pendingSales: [] };
  const { data: paidPayments, error: paymentsError } = await adminDb
    .from("payments")
    .select("checkout_session_id")
    .in("checkout_session_id", sessionIds)
    .in("status", ["confirmed", "received"]);
  if (paymentsError) {
    console.error("Falha ao validar vendas pagas sem pedido:", paymentsError);
    return { recovered: 0, pending: 0, pendingSales: [] };
  }
  const paidSessionIds = new Set((paidPayments || []).map((row: any) => row.checkout_session_id));

  let recoveredThisRequest = 0;
  let pending = paidSessionIds.size;
  const recoveredSessionIds = new Set<string>();
  for (const session of sessions || []) {
    if (!paidSessionIds.has(session.id)) continue;
    // Nao deixe a recuperacao de um lote antigo atrasar o carregamento da tela.
    // O cron processa o restante e cada nova consulta recupera mais um lote.
    if (recoveredThisRequest >= 3) break;
    if (!session.shopify_draft_order_id) {
      console.error(`Venda paga ${session.id} esta sem Draft Order Shopify`);
      continue;
    }
    const cpfCnpj = session.customer_snapshot?.cpfCnpj || null;
    const completed = await completeDraftOrder(
      session.shopify_draft_order_id,
      shopifyToken,
      false,
      cpfCnpj,
    );
    if (!completed.requestOk || !completed.orderId) {
      await adminDb.from("checkout_sessions").update({ status: "paid_pending_shopify" })
        .eq("id", session.id).is("shopify_order_id", null);
      console.error(`Venda paga ${session.id} ainda nao pode ser concluida na Shopify`);
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

  let body: { action?: string; since?: string; limit?: number; orderId?: string; orderName?: string; zpl?: string; jobId?: string; status?: string; error?: string } = {};
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
    // Ao abrir Pedidos, recupera tambem vendas antigas cujo pagamento foi
    // confirmado mas cuja conclusao do Draft Order falhou anteriormente.
    const recovery = await recoverPaidOrders(adminDb, shopifyToken);

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
    return jsonResponse({ orders, count: orders.length, recovery, server_time: new Date().toISOString() });
  } catch (error) {
    console.error("admin-orders:", error);
    return errorResponse("Erro interno ao carregar pedidos", 500);
  }
});
