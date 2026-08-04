// Chamadas à Shopify. Usa apenas fetch (padrão web), sem depender de Deno.

import { mergeNoteAttributes, type NoteAttribute, PICKUP_CODE_ATTRIBUTE } from "./pickup.ts";

export const SHOP_DOMAIN = "petjoy-deals-hb8r9.myshopify.com";
export const ADMIN_API = `https://${SHOP_DOMAIN}/admin/api/2025-07`;
export const STOREFRONT_API = `https://${SHOP_DOMAIN}/api/2025-07/graphql.json`;

export async function findOrCreateCustomer(email: string, token: string): Promise<number | null> {
  const searchRes = await fetch(
    `${ADMIN_API}/customers/search.json?query=${encodeURIComponent(`email:${email}`)}`,
    { headers: { "X-Shopify-Access-Token": token } },
  );
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data?.customers?.[0]?.id) return data.customers[0].id;
  }
  const createRes = await fetch(`${ADMIN_API}/customers.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ customer: { email, accepts_marketing: false, send_email_invite: false } }),
  });
  if (!createRes.ok) {
    console.error("Customer create failed:", await createRes.text());
    return null;
  }
  const data = await createRes.json();
  return data?.customer?.id ?? null;
}

/** Preço atual de cada variante na Storefront API, indexado pelo GID. */
export async function fetchCurrentVariantPrices(
  variantIds: string[],
  storefrontToken: string,
): Promise<Map<string, number>> {
  const priceRes = await fetch(STOREFRONT_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": storefrontToken },
    body: JSON.stringify({
      query: `query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id price { amount } } } }`,
      variables: { ids: variantIds },
    }),
  });
  const priceData = await priceRes.json();
  const currentPriceMap = new Map<string, number>();
  for (const n of priceData?.data?.nodes || []) {
    const amt = Number(n?.price?.amount);
    if (n?.id && Number.isFinite(amt)) currentPriceMap.set(n.id, amt);
  }
  return currentPriceMap;
}

/**
 * Grava o código de retirada em note_attributes do pedido, para o e-mail nativo
 * da Shopify renderizar via {{ attributes["Codigo de retirada"] }}.
 *
 * Preserva os atributos que já existiam: o PUT da Admin API substitui o array
 * inteiro, então escrever só o código apagaria o resto.
 *
 * `existingNoteAttributes` evita uma chamada quando o chamador já tem o pedido
 * em mãos. Quando não é passado, buscamos apenas esse campo.
 */
export async function savePickupCodeOnOrder(opts: {
  shopDomain: string;
  adminToken: string;
  numericOrderId: string;
  pickupCode: string;
  existingNoteAttributes?: NoteAttribute[] | null;
}): Promise<boolean> {
  const { shopDomain, adminToken, numericOrderId, pickupCode } = opts;
  const orderUrl = `https://${shopDomain}/admin/api/2025-07/orders/${numericOrderId}.json`;

  let existing = opts.existingNoteAttributes;
  if (existing === undefined) {
    try {
      const read = await fetch(`${orderUrl}?fields=note_attributes`, {
        headers: { "X-Shopify-Access-Token": adminToken },
      });
      if (read.ok) {
        const body = await read.json();
        existing = body?.order?.note_attributes ?? [];
      } else {
        // Seguimos assim mesmo: ficar sem o código no pedido significa e-mail
        // sem código, que é a razão de existir desta gravação. O risco de
        // apagar outros atributos fica registrado.
        console.warn(
          `Nao foi possivel ler note_attributes do pedido ${numericOrderId} (${read.status}) — gravando apenas o codigo`,
        );
        existing = null;
      }
    } catch (e) {
      console.warn(`Falha ao ler note_attributes do pedido ${numericOrderId}:`, e);
      existing = null;
    }
  }

  try {
    const upd = await fetch(orderUrl, {
      method: "PUT",
      headers: { "X-Shopify-Access-Token": adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        order: {
          id: Number(numericOrderId),
          note_attributes: mergeNoteAttributes(existing, PICKUP_CODE_ATTRIBUTE, pickupCode),
        },
      }),
    });
    if (!upd.ok) {
      console.error(`Failed to save pickup code on order: ${upd.status} ${await upd.text()}`);
      return false;
    }
    console.log(`Pickup code ${pickupCode} saved on order ${numericOrderId}`);
    return true;
  } catch (e) {
    console.error("Failed to save pickup code:", e);
    return false;
  }
}

export interface DraftOrderResult {
  /** false = a chamada à Shopify falhou. true + invoiceUrl null = respondeu sem invoice_url. */
  requestOk: boolean;
  invoiceUrl: string | null;
}

export async function createDraftOrder(
  draftOrder: Record<string, unknown>,
  token: string,
): Promise<DraftOrderResult> {
  const draftRes = await fetch(`${ADMIN_API}/draft_orders.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ draft_order: draftOrder }),
  });

  if (!draftRes.ok) {
    const errText = await draftRes.text();
    console.error("Draft order failed:", errText);
    return { requestOk: false, invoiceUrl: null };
  }

  const draftData = await draftRes.json();
  return { requestOk: true, invoiceUrl: draftData?.draft_order?.invoice_url ?? null };
}
