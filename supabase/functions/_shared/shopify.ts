// Chamadas à Shopify. Usa apenas fetch (padrão web), sem depender de Deno.

import {
  isAlreadyPickedUp,
  mergeNoteAttributes,
  type NoteAttribute,
  PICKUP_CODE_ATTRIBUTE,
  PICKUP_DONE_ATTRIBUTE,
} from "./pickup.ts";

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

/** Grava um note_attribute qualquer preservando os demais. */
async function setOrderNoteAttribute(opts: {
  shopDomain: string;
  adminToken: string;
  numericOrderId: string;
  name: string;
  value: string;
  existingNoteAttributes?: NoteAttribute[] | null;
}): Promise<boolean> {
  const orderUrl = `https://${opts.shopDomain}/admin/api/2025-07/orders/${opts.numericOrderId}.json`;
  let existing = opts.existingNoteAttributes;
  if (existing === undefined) {
    existing = (await fetchOrderPickupState(opts)).noteAttributes;
  }
  try {
    const upd = await fetch(orderUrl, {
      method: "PUT",
      headers: { "X-Shopify-Access-Token": opts.adminToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        order: {
          id: Number(opts.numericOrderId),
          note_attributes: mergeNoteAttributes(existing, opts.name, opts.value),
        },
      }),
    });
    if (!upd.ok) {
      console.error(`Failed to set ${opts.name} on order: ${upd.status} ${await upd.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`Failed to set ${opts.name}:`, e);
    return false;
  }
}

/** Marca o pedido como retirado (atributo lido por isAlreadyPickedUp). */
export function markOrderPickedUp(opts: {
  shopDomain: string;
  adminToken: string;
  numericOrderId: string;
  at?: string;
}): Promise<boolean> {
  return setOrderNoteAttribute({
    ...opts,
    name: PICKUP_DONE_ATTRIBUTE,
    value: opts.at ?? new Date().toISOString(),
  });
}

/**
 * Lê o estado de retirada do pedido: atributos + status de processamento.
 * Em caso de falha devolve `alreadyPickedUp: false` — preferimos avisar o
 * cliente a silenciar por causa de uma leitura que não deu certo.
 */
export async function fetchOrderPickupState(opts: {
  shopDomain: string;
  adminToken: string;
  numericOrderId: string;
}): Promise<{ noteAttributes: NoteAttribute[] | null; alreadyPickedUp: boolean }> {
  try {
    const read = await fetch(
      `https://${opts.shopDomain}/admin/api/2025-07/orders/${opts.numericOrderId}.json?fields=note_attributes,fulfillment_status`,
      { headers: { "X-Shopify-Access-Token": opts.adminToken } },
    );
    if (!read.ok) {
      console.warn(`Nao foi possivel ler o pedido ${opts.numericOrderId} (${read.status})`);
      return { noteAttributes: null, alreadyPickedUp: false };
    }
    const order = (await read.json())?.order ?? {};
    const noteAttributes: NoteAttribute[] = order.note_attributes ?? [];
    return {
      noteAttributes,
      alreadyPickedUp: isAlreadyPickedUp({
        noteAttributes,
        fulfillmentStatus: order.fulfillment_status,
      }),
    };
  } catch (e) {
    console.warn(`Falha ao ler o pedido ${opts.numericOrderId}:`, e);
    return { noteAttributes: null, alreadyPickedUp: false };
  }
}

export interface DraftOrderResult {
  /** false = a chamada à Shopify falhou. true + invoiceUrl null = respondeu sem invoice_url. */
  requestOk: boolean;
  invoiceUrl: string | null;
  draftOrderId: string | null;
}

export interface ShopifyVariantCheckoutDetail {
  id: string;
  numericId: number;
  productId: string;
  title: string;
  productTitle: string;
  price: number;
  availableForSale: boolean;
  quantityAvailable: number | null;
  imageUrl: string | null;
}

export async function fetchVariantCheckoutDetails(
  variantIds: string[],
  storefrontToken: string,
): Promise<Map<string, ShopifyVariantCheckoutDetail>> {
  const result = await fetch(STOREFRONT_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": storefrontToken },
    body: JSON.stringify({
      query: `query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant {
        id title availableForSale quantityAvailable price { amount }
        image { url }
        product { id title }
      } } }`,
      variables: { ids: variantIds },
    }),
  });
  if (!result.ok) throw new Error(`Falha ao consultar variantes Shopify (${result.status})`);
  const body = await result.json();
  if (body?.errors?.length) throw new Error("Shopify rejeitou a consulta de variantes");

  const details = new Map<string, ShopifyVariantCheckoutDetail>();
  for (const node of body?.data?.nodes ?? []) {
    const price = Number(node?.price?.amount);
    const numericId = Number(String(node?.id || "").split("/").pop());
    if (!node?.id || !node?.product?.id || !Number.isFinite(price) || !Number.isSafeInteger(numericId)) continue;
    details.set(node.id, {
      id: node.id,
      numericId,
      productId: String(node.product.id),
      title: String(node.title || ""),
      productTitle: String(node.product?.title || "Produto"),
      price,
      availableForSale: Boolean(node.availableForSale),
      quantityAvailable: Number.isFinite(Number(node.quantityAvailable)) ? Number(node.quantityAvailable) : null,
      imageUrl: node.image?.url || null,
    });
  }
  return details;
}

export interface ShopifyDeliveryOption {
  handle: string;
  code: string | null;
  title: string;
  description: string | null;
  deliveryMethodType: string;
  amount: number;
  currencyCode: string;
}

export async function fetchShopifyDraftDeliveryOptions(input: {
  items: Array<{ variantId: string; quantity: number }>;
  customerName: string;
  phone: string;
  address: {
    address1: string; number: string; address2?: string; neighborhood: string;
    city: string; provinceCode: string; postalCode: string;
  };
}, adminToken: string): Promise<ShopifyDeliveryOption[]> {
  const names = input.customerName.trim().split(/\s+/);
  const firstName = names.shift() || "Cliente";
  const response = await fetch(`${ADMIN_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": adminToken },
    body: JSON.stringify({
      query: `query DeliveryOptions($input: DraftOrderAvailableDeliveryOptionsInput!) {
        draftOrderAvailableDeliveryOptions(input: $input, localPickupCount: 1) {
          availableShippingRates { handle code title source price { amount currencyCode } }
          availableLocalDeliveryRates { handle code title source price { amount currencyCode } }
        }
      }`,
      variables: { input: {
        lineItems: input.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
        marketRegionCountryCode: "BR",
        shippingAddress: {
          firstName,
          lastName: names.join(" ") || firstName,
          address1: `${input.address.address1}, ${input.address.number}`,
          address2: [input.address.address2, input.address.neighborhood].filter(Boolean).join(" - ") || undefined,
          city: input.address.city,
          provinceCode: input.address.provinceCode,
          zip: input.address.postalCode,
          countryCode: "BR",
          phone: `+55${input.phone.replace(/\D/g, "")}`,
        },
      } },
    }),
  });
  if (!response.ok) throw new Error(`Falha ao calcular frete Shopify Admin (${response.status})`);
  const body = await response.json();
  if (body?.errors?.length) throw new Error(body.errors[0]?.message || "Shopify rejeitou o cálculo de frete");
  const result = body?.data?.draftOrderAvailableDeliveryOptions;
  const normalize = (rate: Record<string, unknown>, type: string): ShopifyDeliveryOption => ({
    handle: String(rate.handle || ""),
    code: typeof rate.code === "string" ? rate.code : null,
    title: String(rate.title || "Entrega"),
    description: typeof rate.source === "string" ? rate.source : null,
    deliveryMethodType: type,
    amount: Number((rate.price as { amount?: unknown })?.amount),
    currencyCode: String((rate.price as { currencyCode?: unknown })?.currencyCode || "BRL"),
  });
  return [
    ...(result?.availableShippingRates ?? []).map((rate: Record<string, unknown>) => normalize(rate, "SHIPPING")),
    ...(result?.availableLocalDeliveryRates ?? []).map((rate: Record<string, unknown>) => normalize(rate, "LOCAL")),
  ].filter((option: ShopifyDeliveryOption) => option.handle && Number.isFinite(option.amount));
}

export async function fetchShopifyDeliveryOptions(input: {
  items: Array<{ variantId: string; quantity: number }>;
  customerName: string;
  email: string;
  phone: string;
  address: {
    address1: string; number: string; address2?: string; neighborhood: string;
    city: string; provinceCode: string; postalCode: string;
  };
}, storefrontToken: string): Promise<ShopifyDeliveryOption[]> {
  const names = input.customerName.trim().split(/\s+/);
  const firstName = names.shift() || "Cliente";
  const lastName = names.join(" ") || firstName;
  const result = await fetch(STOREFRONT_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": storefrontToken },
    body: JSON.stringify({
      query: `mutation ShippingOptions($input: CartInput!) {
        cartCreate(input: $input) {
          cart {
            deliveryGroups(first: 10) { nodes {
              deliveryOptions { handle code title description deliveryMethodType estimatedCost { amount currencyCode } }
            } }
          }
          userErrors { field message }
          warnings { message }
        }
      }`,
      variables: {
        input: {
          lines: input.items.map((item) => ({ merchandiseId: item.variantId, quantity: item.quantity })),
          buyerIdentity: { countryCode: "BR", email: input.email },
          delivery: {
            addresses: [{
              selected: true,
              oneTimeUse: true,
              validationStrategy: "COUNTRY_CODE_ONLY",
              address: { deliveryAddress: {
                firstName,
                lastName,
                address1: `${input.address.address1}, ${input.address.number}`,
                address2: [input.address.address2, input.address.neighborhood].filter(Boolean).join(" - ") || undefined,
                city: input.address.city,
                provinceCode: input.address.provinceCode,
                zip: input.address.postalCode,
                countryCode: "BR",
                phone: `+55${input.phone.replace(/\D/g, "")}`,
              } },
            }],
          },
        },
      },
    }),
  });
  if (!result.ok) throw new Error(`Falha ao calcular frete Shopify (${result.status})`);
  const body = await result.json();
  const payload = body?.data?.cartCreate;
  if (body?.errors?.length || payload?.userErrors?.length) {
    throw new Error(payload?.userErrors?.[0]?.message || "Shopify rejeitou o endereço de entrega");
  }
  const options = (payload?.cart?.deliveryGroups?.nodes ?? [])
    .flatMap((group: { deliveryOptions?: unknown[] }) => group.deliveryOptions ?? [])
    .map((option: Record<string, unknown>) => ({
      handle: String(option.handle || ""),
      code: typeof option.code === "string" ? option.code : null,
      title: String(option.title || "Entrega"),
      description: typeof option.description === "string" ? option.description : null,
      deliveryMethodType: String(option.deliveryMethodType || "SHIPPING"),
      amount: Number((option.estimatedCost as { amount?: unknown })?.amount),
      currencyCode: String((option.estimatedCost as { currencyCode?: unknown })?.currencyCode || "BRL"),
    }))
    .filter((option: ShopifyDeliveryOption) => option.handle && Number.isFinite(option.amount));
  const unique = new Map<string, ShopifyDeliveryOption>();
  for (const option of options) unique.set(option.handle, option);
  return [...unique.values()];
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
    return { requestOk: false, invoiceUrl: null, draftOrderId: null };
  }

  const draftData = await draftRes.json();
  const draft = draftData?.draft_order;
  return {
    requestOk: true,
    invoiceUrl: draft?.invoice_url ?? null,
    draftOrderId: draft?.id ? String(draft.id) : null,
  };
}

export interface CompleteDraftOrderResult {
  requestOk: boolean;
  orderId: string | null;
  alreadyCompleted: boolean;
}

/** Conclui um draft já pago fora da Shopify, sem coletar novo pagamento. */
export async function completeDraftOrder(
  draftOrderId: string,
  token: string,
  paymentPending = false,
): Promise<CompleteDraftOrderResult> {
  const url = `${ADMIN_API}/draft_orders/${encodeURIComponent(draftOrderId)}/complete.json`;
  const completed = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ payment_pending: paymentPending }),
  });

  if (completed.ok) {
    const body = await completed.json();
    return {
      requestOk: true,
      orderId: body?.draft_order?.order_id ? String(body.draft_order.order_id) : null,
      alreadyCompleted: false,
    };
  }

  // Uma resposta pode ter se perdido depois de a Shopify concluir. Consulte o
  // draft antes de considerar uma nova mutação.
  const read = await fetch(`${ADMIN_API}/draft_orders/${encodeURIComponent(draftOrderId)}.json`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  if (read.ok) {
    const body = await read.json();
    const orderId = body?.draft_order?.order_id;
    if (orderId) {
      return { requestOk: true, orderId: String(orderId), alreadyCompleted: true };
    }
  }

  console.error(`Falha ao concluir Draft Order ${draftOrderId}:`, completed.status, await completed.text());
  return { requestOk: false, orderId: null, alreadyCompleted: false };
}
