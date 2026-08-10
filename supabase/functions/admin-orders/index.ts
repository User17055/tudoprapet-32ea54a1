// Pedidos para o painel administrativo e para o agente de impressão.
//
// Duas identidades podem chamar:
//   1. Administrador logado  -> JWT no Authorization (checado via has_role)
//   2. Agente de impressão   -> header x-print-agent-token igual a PRINT_AGENT_TOKEN
//
// `verify_jwt = false` no config.toml porque o agente de impressão não tem JWT.
// A autorização é feita aqui dentro, nunca no gateway.

import { corsHeadersWith, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { ADMIN_API } from "../_shared/shopify.ts";
import { PICKUP_CODE_ATTRIBUTE, PICKUP_DONE_ATTRIBUTE } from "../_shared/pickup.ts";

const cors = corsHeadersWith("x-print-agent-token");

function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function attr(order: Record<string, unknown>, name: string): string | null {
  const list = (order?.note_attributes as { name?: string; value?: string }[] | undefined) || [];
  const found = list.find((a) => (a?.name || "").toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

function shape(order: Record<string, unknown>) {
  const o = order as any;
  return {
    id: o.id,
    name: o.name,
    order_number: o.order_number,
    created_at: o.created_at,
    processed_at: o.processed_at,
    cancelled_at: o.cancelled_at ?? null,
    closed_at: o.closed_at ?? null,
    financial_status: o.financial_status ?? null,
    fulfillment_status: o.fulfillment_status ?? null,
    total_price: Number(o.total_price ?? 0),
    currency: o.currency ?? "BRL",
    note: o.note ?? null,
    customer_name:
      [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") ||
      o.shipping_address?.name ||
      o.billing_address?.name ||
      "Cliente",
    customer_email: o.email ?? o.customer?.email ?? null,
    customer_phone:
      o.phone ?? o.customer?.phone ?? o.shipping_address?.phone ?? o.billing_address?.phone ?? null,
    shipping_address: o.shipping_address ?? null,
    pickup_code: attr(order, PICKUP_CODE_ATTRIBUTE),
    picked_up_at: attr(order, PICKUP_DONE_ATTRIBUTE),
    shipping_lines: (o.shipping_lines || []).map((s: any) => ({
      title: s?.title ?? null,
      code: s?.code ?? null,
      price: Number(s?.price ?? 0),
    })),
    line_items: (o.line_items || []).map((li: any) => ({
      id: li?.id,
      title: li?.title ?? "",
      variant_title: li?.variant_title ?? null,
      sku: li?.sku ?? null,
      quantity: Number(li?.quantity ?? 0),
      price: Number(li?.price ?? 0),
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  try {
    // --- autorização -------------------------------------------------------
    const agentToken = req.headers.get("x-print-agent-token");
    const expectedAgentToken = Deno.env.get("PRINT_AGENT_TOKEN");
    let caller: "agent" | "admin";

    if (agentToken) {
      if (!expectedAgentToken || agentToken !== expectedAgentToken) {
        return corsJson({ error: "Token do agente inválido" }, 401);
      }
      caller = "agent";
    } else {
      const authResult = await requireAdmin(req);
      if (!authResult.ok) {
        // requireAdmin devolve os headers padrão; refazemos com os headers desta function
        const body = await authResult.response.json().catch(() => ({ error: "Não autorizado" }));
        return corsJson(body, authResult.response.status);
      }
      caller = "admin";
    }

    // --- parâmetros --------------------------------------------------------
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const param = (key: string) => url.searchParams.get(key) ?? (body as any)?.[key] ?? null;

    const limit = Math.min(Number(param("limit") ?? 50) || 50, 250);
    // "any" garante que cancelados, encerrados e reembolsados também aparecem.
    const status = String(param("status") ?? "any");
    const financialStatus = param("financial_status");
    const fulfillmentStatus = param("fulfillment_status");
    const search = (param("search") || "").toString().trim().toLowerCase();
    const orderId = param("order_id");

    const shopifyToken =
      Deno.env.get("SHOPIFY_ACCESS_TOKEN") ||
      Deno.env.get("SHOPIFY_ONLINE_ACCESS_TOKEN:user:4HrJkQRl3KUXTrTOAgUkwQSkHWo2") ||
      "";
    if (!shopifyToken) return corsJson({ error: "SHOPIFY_ACCESS_TOKEN não configurado" }, 500);

    // --- um pedido específico ---------------------------------------------
    if (orderId) {
      const numeric = String(orderId).replace(/\D/g, "");
      const res = await fetch(`${ADMIN_API}/orders/${numeric}.json`, {
        headers: { "X-Shopify-Access-Token": shopifyToken },
      });
      if (!res.ok) {
        console.error("Shopify order error:", await res.text());
        return corsJson({ error: "Pedido não encontrado" }, 404);
      }
      const data = await res.json();
      return corsJson({ ok: true, caller, order: shape(data.order) });
    }

    // --- lista -------------------------------------------------------------
    const qs = new URLSearchParams({ status, limit: String(limit) });
    if (financialStatus) qs.set("financial_status", String(financialStatus));
    if (fulfillmentStatus) qs.set("fulfillment_status", String(fulfillmentStatus));

    const res = await fetch(`${ADMIN_API}/orders.json?${qs.toString()}`, {
      headers: { "X-Shopify-Access-Token": shopifyToken },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("Shopify orders error:", text);
      return corsJson({ error: "Falha ao buscar pedidos na Shopify" }, 502);
    }

    const data = await res.json();
    let orders = (data?.orders || []).map(shape);

    if (search) {
      orders = orders.filter((o: ReturnType<typeof shape>) =>
        [o.name, String(o.order_number), o.customer_name, o.customer_email, o.pickup_code]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(search)),
      );
    }

    return corsJson({ ok: true, caller, count: orders.length, orders });
  } catch (e) {
    console.error("admin-orders error:", e);
    return corsJson({ error: e instanceof Error ? e.message : "Erro interno" }, 500);
  }
});
