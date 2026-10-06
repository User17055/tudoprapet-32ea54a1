import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";
import { requireUser } from "../_shared/auth.ts";
import { corsHeaders, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { hasSufficientFranchiseInventory } from "../_shared/inventory.ts";
import {
  deleteDraftOrder,
  fetchVariantCheckoutDetails,
  saveReservedDraftOrder,
  shopifyAdminToken,
} from "../_shared/shopify.ts";

type OrderItem = {
  variantId: string;
  quantity: number;
  title: string;
  variantTitle: string;
  imageUrl: string | null;
  unitPrice: number;
};

const RESERVATION_HOURS = Math.max(1, Math.min(168, Number(Deno.env.get("FRANCHISE_OPEN_ORDER_RESERVATION_HOURS")) || 72));

function parseItems(value: unknown): Array<{ variantId: string; quantity: number }> | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return null;
  const items = value.map((raw) => {
    const item = raw as Record<string, unknown>;
    return { variantId: String(item?.variantId || ""), quantity: Number(item?.quantity) };
  });
  return items.every((item) => /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(item.variantId) && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 999)
    ? items
    : null;
}

function mergeItems(current: OrderItem[], incoming: Array<{ variantId: string; quantity: number }>): Array<{ variantId: string; quantity: number }> {
  const quantities = new Map(current.map((item) => [item.variantId, item.quantity]));
  for (const item of incoming) quantities.set(item.variantId, (quantities.get(item.variantId) || 0) + item.quantity);
  return [...quantities].map(([variantId, quantity]) => ({ variantId, quantity }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return errorResponse("Método não permitido", 405);
  const authResult = await requireUser(req);
  if (!authResult.ok) return authResult.response;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "get");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const userId = authResult.auth.userId;
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("is_franchisee").eq("user_id", userId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.is_franchisee) return errorResponse("Recurso exclusivo para franqueados", 403);

    const { data: existing, error: existingError } = await admin.from("franchise_open_orders")
      .select("*").eq("user_id", userId).eq("status", "open").maybeSingle();
    if (existingError) throw existingError;
    const token = shopifyAdminToken();
    if (!token) return errorResponse("Loja temporariamente indisponível", 503);

    if (existing && Date.parse(existing.reserved_until) <= Date.now()) {
      await deleteDraftOrder(existing.shopify_draft_order_id, token);
      await admin.from("franchise_open_orders").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", existing.id);
      if (action === "get") return jsonResponse({ order: null, expired: true });
      return errorResponse("A reserva anterior venceu. Atualize a página e salve o carrinho novamente.", 409);
    }

    if (action === "get") return jsonResponse({ order: existing || null });

    if (action === "cancel") {
      if (!existing) return jsonResponse({ ok: true, order: null });
      const deleted = await deleteDraftOrder(existing.shopify_draft_order_id, token);
      if (!deleted) return errorResponse("Não foi possível liberar a reserva", 502);
      const { error } = await admin.from("franchise_open_orders")
        .update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", existing.id);
      if (error) throw error;
      return jsonResponse({ ok: true, order: null });
    }

    const requested = parseItems(body.items);
    if (!requested) return errorResponse("Itens inválidos", 400);
    let combined = action === "add" && existing
      ? mergeItems((existing.items || []) as OrderItem[], requested)
      : requested;
    if (action === "replace" && !existing) return errorResponse("Pedido em aberto não encontrado", 404);
    if (action === "add" && !existing) combined = requested;
    if (!["save", "add", "replace"].includes(action)) return errorResponse("Ação inválida", 400);

    const storefrontToken = Deno.env.get("SHOPIFY_STOREFRONT_ACCESS_TOKEN") || Deno.env.get("SHOPIFY_STOREFRONT_TOKEN") || "";
    const details = await fetchVariantCheckoutDetails(combined.map((item) => item.variantId), storefrontToken, token);
    const previousByVariant = new Map<string, number>(((existing?.items || []) as OrderItem[]).map((item) => [item.variantId, item.quantity]));
    for (const item of combined) {
      const detail = details.get(item.variantId);
      if (!detail) return errorResponse("Um produto não está mais disponível", 409);
      const ownReservation = previousByVariant.get(item.variantId) || 0;
      const adjusted = {
        ...detail,
        availableForSale: detail.availableForSale || ownReservation > 0,
        quantityAvailable: detail.quantityAvailable === null ? null : detail.quantityAvailable + ownReservation,
      };
      if (!hasSufficientFranchiseInventory(adjusted, item.quantity)) {
        return errorResponse(`Estoque insuficiente para ${detail.productTitle}`, 409);
      }
    }

    const productIds = [...new Set([...details.values()].map((detail) => detail.productId))];
    const { data: audienceRows, error: audienceError } = await admin.from("product_audience")
      .select("shopify_product_id,audience").in("shopify_product_id", productIds);
    if (audienceError) throw audienceError;
    const audience = new Map((audienceRows || []).map((row) => [row.shopify_product_id, row.audience]));
    if ([...details.values()].some((detail) => !["franquia", "ambos"].includes(audience.get(detail.productId) || ""))) {
      return errorResponse("Um produto não está disponível para franquia", 409);
    }

    const variantIds = combined.map((item) => item.variantId);
    const { data: prices, error: priceError } = await admin.from("franchise_prices")
      .select("shopify_variant_id,price").in("shopify_variant_id", variantIds);
    if (priceError) throw priceError;
    const priceMap = new Map((prices || []).map((row) => [row.shopify_variant_id, Number(row.price)]));
    const snapshot: OrderItem[] = combined.map((item) => {
      const detail = details.get(item.variantId)!;
      return {
        ...item,
        title: detail.productTitle,
        variantTitle: detail.title,
        imageUrl: detail.imageUrl,
        unitPrice: priceMap.get(item.variantId) || detail.price,
      };
    });
    const reservedUntil = new Date(Date.now() + RESERVATION_HOURS * 60 * 60 * 1000).toISOString();
    const savedDraft = await saveReservedDraftOrder({
      draftOrderId: existing?.shopify_draft_order_id,
      items: combined,
      reserveInventoryUntil: reservedUntil,
      userId,
    }, token);
    if (!savedDraft.ok || !savedDraft.draftOrderId || !savedDraft.reservedUntil) {
      return errorResponse(savedDraft.error || "Não foi possível reservar o estoque", 502);
    }

    const payload = {
      user_id: userId,
      status: "open",
      shopify_draft_order_id: savedDraft.draftOrderId,
      items: snapshot,
      reserved_until: savedDraft.reservedUntil,
      updated_at: new Date().toISOString(),
    };
    const result = existing
      ? await admin.from("franchise_open_orders").update(payload).eq("id", existing.id).select("*").single()
      : await admin.from("franchise_open_orders").insert(payload).select("*").single();
    if (result.error) {
      if (!existing) await deleteDraftOrder(savedDraft.draftOrderId, token);
      throw result.error;
    }
    return jsonResponse({ ok: true, order: result.data });
  } catch (error) {
    console.error("franchise-open-order:", error);
    return errorResponse("Não foi possível atualizar o pedido em aberto", 500);
  }
});
