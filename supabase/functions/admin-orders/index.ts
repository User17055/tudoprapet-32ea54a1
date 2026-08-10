import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";

const SHOP = "petjoy-deals-hb8r9.myshopify.com";
const API = "2025-07";
const FIELDS = [
  "id", "name", "created_at", "cancelled_at", "cancel_reason", "total_price", "subtotal_price",
  "total_discounts", "currency", "financial_status", "fulfillment_status", "customer", "email", "phone",
  "shipping_address", "billing_address", "line_items", "shipping_lines", "note",
].join(",");

function nextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

function normalize(order: any) {
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
    const { data, error } = await adminDb.from("print_jobs").insert({ order_id: String(body.orderId), order_name: body.orderName, zpl: body.zpl, source: "manual" }).select("id").single();
    if (error) { console.error("queue_print:", error); return errorResponse("Falha ao colocar pedido na fila", 500); }
    return jsonResponse({ queued: true, job_id: data.id });
  }

  if (action === "print_jobs") {
    if (!isAgent) return errorResponse("Ação restrita ao agente", 403);
    const { data, error } = await adminDb.from("print_jobs").select("id,order_id,order_name,zpl,created_at").eq("status", "queued").order("created_at", { ascending: true }).limit(25);
    if (error) return errorResponse("Falha ao consultar fila", 500);
    return jsonResponse({ jobs: data || [], server_time: new Date().toISOString() });
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
    const since = body.since || url.searchParams.get("since") || "";
    const requestedLimit = Math.min(Math.max(Number(body.limit || url.searchParams.get("limit") || (isAgent ? 50 : 1000)), 1), 1000);
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

    const orders = all.slice(0, requestedLimit).map(normalize);
    return jsonResponse({ orders, count: orders.length, server_time: new Date().toISOString() });
  } catch (error) {
    console.error("admin-orders:", error);
    return errorResponse("Erro interno ao carregar pedidos", 500);
  }
});
