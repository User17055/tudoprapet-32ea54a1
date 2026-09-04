// Remove o "Codigo de retirada" gravado indevidamente num pedido de ENTREGA,
// preservando todos os demais note_attributes. Não dispara mensagem alguma.
//
// Guarda-corpo: só remove se o pedido NÃO for de retirada (mesma regra do
// webhook). Para pedido de retirada, ou indeterminado, devolve o diagnóstico e
// não altera nada — a menos que `force: true` seja enviado explicitamente.
//
// `dry_run: true` só mostra o que seria feito.

import { corsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";
import { PICKUP_CODE_ATTRIBUTE } from "../_shared/pickup.ts";
import { removeOrderNoteAttribute, resolveOrderIsPickup } from "../_shared/shopify.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authResult = await requireAdmin(req);
  if (!authResult.ok) return authResult.response;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const shopDomain = Deno.env.get("SHOPIFY_SHOP_DOMAIN") || "petjoy-deals-hb8r9.myshopify.com";
    const adminToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
    if (!adminToken) return json({ error: "SHOPIFY_ACCESS_TOKEN ausente" }, 500);

    let body: { order_id?: string | number; order_name?: string; dry_run?: boolean; force?: boolean } = {};
    try { body = await req.json(); } catch { /* ignore */ }

    // Localiza o pedido por id numérico ou por nome (#1123).
    let order: any = null;
    if (body.order_id) {
      const numeric = String(body.order_id).replace(/\D/g, "");
      const r = await fetch(`https://${shopDomain}/admin/api/2025-07/orders/${numeric}.json`, {
        headers: { "X-Shopify-Access-Token": adminToken },
      });
      if (!r.ok) return json({ error: `Falha ao buscar pedido ${numeric}: ${r.status}` }, 502);
      order = (await r.json()).order;
    } else if (body.order_name) {
      const name = body.order_name.startsWith("#") ? body.order_name : `#${body.order_name}`;
      const r = await fetch(
        `https://${shopDomain}/admin/api/2025-07/orders.json?status=any&name=${encodeURIComponent(name)}&limit=5`,
        { headers: { "X-Shopify-Access-Token": adminToken } },
      );
      if (!r.ok) return json({ error: `Falha ao buscar pedido ${name}: ${r.status}` }, 502);
      order = ((await r.json()).orders || []).find((o: any) => o.name === name) ?? null;
    } else {
      return json({ error: "Informe order_id ou order_name" }, 400);
    }
    if (!order) return json({ error: "Pedido não encontrado" }, 404);

    const numericId = String(order.id).replace(/\D/g, "");
    const verdict = await resolveOrderIsPickup({ shopDomain, adminToken, numericOrderId: numericId, order });
    const currentCode = (order.note_attributes ?? []).find((a: any) => a?.name === PICKUP_CODE_ATTRIBUTE)?.value ?? null;

    const diagnostic = {
      order_number: order.name,
      order_id: numericId,
      customer: `${order.customer?.first_name ?? ""} ${order.customer?.last_name ?? ""}`.trim() || null,
      fulfillment_status: order.fulfillment_status,
      shipping_lines: (order.shipping_lines ?? []).map((s: any) => ({ title: s.title, code: s.code, source: s.source })),
      shipping_city: order.shipping_address?.city ?? null,
      tags: order.tags,
      is_pickup: verdict.isPickup,
      method_types: verdict.methodTypes,
      pickup_evidence: verdict.evidence,
      current_pickup_code: currentCode,
      note_attributes_before: order.note_attributes ?? [],
    };

    if (!currentCode) return json({ ...diagnostic, changed: false, reason: "pedido não tem Codigo de retirada" });

    if (verdict.isPickup !== false && !body.force) {
      return json({
        ...diagnostic, changed: false,
        reason: verdict.isPickup === true
          ? "pedido É de retirada — código mantido (use force para remover mesmo assim)"
          : "método de entrega indeterminado — nada alterado (use force para remover)",
      });
    }

    if (body.dry_run) {
      return json({
        ...diagnostic, changed: false, dry_run: true,
        note_attributes_after: (order.note_attributes ?? []).filter((a: any) => a?.name !== PICKUP_CODE_ATTRIBUTE),
      });
    }

    const result = await removeOrderNoteAttribute({ shopDomain, adminToken, numericOrderId: numericId, name: PICKUP_CODE_ATTRIBUTE });
    return json({
      ...diagnostic,
      changed: result.ok,
      note_attributes_after: result.after,
      error: result.ok ? undefined : "falha ao gravar na Shopify",
    }, result.ok ? 200 : 502);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
