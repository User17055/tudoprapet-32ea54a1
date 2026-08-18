// Chamadas à Shopify. Usa apenas fetch (padrão web), sem depender de Deno.

import {
  isAlreadyPickedUp,
  mergeNoteAttributes,
  type NoteAttribute,
  PICKUP_CODE_ATTRIBUTE,
  PICKUP_DONE_ATTRIBUTE,
} from "./pickup.ts";
import { toGraphqlDraftLineItems } from "./pricing.ts";

export const SHOP_DOMAIN = "petjoy-deals-hb8r9.myshopify.com";

/** Mantém todas as Edge Functions usando o mesmo token Admin da Shopify. */
export function shopifyAdminToken(): string {
  return Deno.env.get("SHOPIFY_ACCESS_TOKEN") ||
    Deno.env.get("SHOPIFY_ONLINE_ACCESS_TOKEN:user:4HrJkQRl3KUXTrTOAgUkwQSkHWo2") ||
    "";
}
export const ADMIN_API = `https://${SHOP_DOMAIN}/admin/api/2025-07`;
export const STOREFRONT_API = `https://${SHOP_DOMAIN}/api/2025-07/graphql.json`;

export interface ShopifyCustomerDetails {
  name?: string;
  phone?: string;
  address?: Record<string, unknown>;
}

function customerNames(name = ""): { first_name?: string; last_name?: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  return {
    first_name: parts.shift(),
    last_name: parts.join(" ") || undefined,
  };
}

function customerAddress(address?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!address) return undefined;
  return {
    first_name: address.first_name,
    last_name: address.last_name,
    address1: address.address1,
    address2: address.address2 || undefined,
    city: address.city,
    province_code: address.province_code || undefined,
    zip: address.zip,
    country_code: "BR",
    phone: address.phone || undefined,
  };
}

function brazilPhone(value?: string): string | undefined {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
  return digits ? `+55${digits}` : undefined;
}

export async function findOrCreateCustomer(
  email: string,
  token: string,
  details: ShopifyCustomerDetails = {},
): Promise<number | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const names = customerNames(details.name);
  const phone = brazilPhone(details.phone);
  const searchRes = await fetch(
    `${ADMIN_API}/customers/search.json?query=${encodeURIComponent(`email:${normalizedEmail}`)}`,
    { headers: { "X-Shopify-Access-Token": token } },
  );
  if (searchRes.ok) {
    const data = await searchRes.json();
    const existing = data?.customers?.[0];
    if (existing?.id) {
      // O pedido precisa ficar ligado a um Customer real para nome e contato
      // aparecerem no Admin. Uma falha ao enriquecer um cadastro antigo nao
      // deve impedir o checkout: o draft ainda recebe os mesmos dados abaixo.
      const missingDefaultAddress = !existing.default_address ? customerAddress(details.address) : undefined;
      if (names.first_name || names.last_name || phone || missingDefaultAddress) {
        let updateRes = await fetch(`${ADMIN_API}/customers/${existing.id}.json`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
          body: JSON.stringify({ customer: {
            id: existing.id,
            ...names,
            ...(phone ? { phone } : {}),
            ...(missingDefaultAddress ? { addresses: [missingDefaultAddress] } : {}),
          } }),
        });
        // Telefone e unico na Shopify. Se ele ja pertencer a outro cadastro,
        // preserve pelo menos o nome em vez de rejeitar o enriquecimento todo.
        if (!updateRes.ok && phone && (names.first_name || names.last_name)) {
          console.warn("Customer update with phone failed:", await updateRes.text());
          updateRes = await fetch(`${ADMIN_API}/customers/${existing.id}.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
            body: JSON.stringify({ customer: {
              id: existing.id,
              ...names,
              ...(missingDefaultAddress ? { addresses: [missingDefaultAddress] } : {}),
            } }),
          });
        }
        if (!updateRes.ok) console.warn("Customer update failed:", await updateRes.text());
      }
      return existing.id;
    }
  }
  const address = customerAddress(details.address);
  let createRes = await fetch(`${ADMIN_API}/customers.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ customer: {
      email: normalizedEmail,
      ...names,
      ...(phone ? { phone } : {}),
      ...(address ? { addresses: [address] } : {}),
      accepts_marketing: false,
      send_email_invite: false,
    } }),
  });
  if (!createRes.ok && phone) {
    console.warn("Customer create with phone failed:", await createRes.text());
    createRes = await fetch(`${ADMIN_API}/customers.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ customer: {
        email: normalizedEmail,
        ...names,
        ...(address ? { addresses: [address] } : {}),
        accepts_marketing: false,
        send_email_invite: false,
      } }),
    });
  }
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

export interface FiscalDraftOrderResult extends DraftOrderResult {
  taxCredentialStored: boolean;
  error: string | null;
}

export interface FiscalDraftOrderInput {
  lineItems: Record<string, unknown>[];
  email: string;
  customerName?: string;
  phone?: string;
  cpfCnpj: string;
  shippingLine: { title: string; price: string; shippingRateHandle?: string };
  shippingAddress?: Record<string, unknown>;
  billingAddress?: Record<string, unknown>;
  tags: string[];
  note: string;
  customAttributes: Array<{ key: string; value: string }>;
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
  const buildQuery = (withInventory: boolean) => `query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant {
        id title availableForSale ${withInventory ? "quantityAvailable" : ""} price { amount }
        image { url }
        product { id title }
      } } }`;

  const request = async (withInventory: boolean) => {
    const result = await fetch(STOREFRONT_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": storefrontToken },
      body: JSON.stringify({ query: buildQuery(withInventory), variables: { ids: variantIds } }),
    });
    if (!result.ok) throw new Error(`Falha ao consultar variantes Shopify (${result.status})`);
    return await result.json();
  };

  let body = await request(true);
  // O token Storefront pode não ter unauthenticated_read_product_inventory. Nesse
  // caso seguimos apenas com availableForSale em vez de derrubar o checkout.
  const inventoryDenied = (body?.errors ?? []).some((e: { message?: string }) =>
    String(e?.message || "").includes("quantityAvailable")
  );
  if (inventoryDenied) {
    console.warn("Storefront sem acesso a quantityAvailable; usando apenas availableForSale");
    body = await request(false);
  }
  if (body?.errors?.length) {
    console.error("Storefront variantes:", JSON.stringify(body.errors).slice(0, 800));
    throw new Error("Shopify rejeitou a consulta de variantes");
  }

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

/** Cria o draft por GraphQL com variantes reais e CPF/CNPJ na mesma mutacao. */
export async function createFiscalDraftOrder(
  input: FiscalDraftOrderInput,
  token: string,
): Promise<FiscalDraftOrderResult> {
  const value = String(input.cpfCnpj || "").replace(/\D/g, "");
  if (value.length !== 11 && value.length !== 14) {
    return {
      requestOk: false,
      invoiceUrl: null,
      draftOrderId: null,
      taxCredentialStored: false,
      error: "CPF/CNPJ ausente ou com quantidade de digitos invalida.",
    };
  }

  const graphqlAddress = (address?: Record<string, unknown>) => address
    ? {
      firstName: address.first_name,
      lastName: address.last_name,
      address1: address.address1,
      address2: address.address2 || undefined,
      city: address.city,
      zip: address.zip,
      phone: address.phone,
      provinceCode: address.province_code || undefined,
      countryCode: "BR",
    }
    : undefined;
  const expectedVariantIds = input.lineItems
    .map((line) => String(line.variant_id || "").split("/").pop())
    .sort();
  const customerId = await findOrCreateCustomer(input.email, token, {
    name: input.customerName,
    phone: input.phone,
    address: input.shippingAddress || input.billingAddress,
  });
  if (!customerId) {
    return {
      requestOk: false,
      invoiceUrl: null,
      draftOrderId: null,
      taxCredentialStored: false,
      error: "Shopify nao criou ou localizou o cliente do pedido.",
    };
  }
  const normalizedPhone = brazilPhone(input.phone);
  const response = await fetch(`${ADMIN_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `mutation CreateFiscalDraft($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id legacyResourceId invoiceUrl
            customer { id }
            shippingAddress { address1 zip }
            billingAddress { address1 zip }
            shippingLine { title shippingRateHandle custom }
            lineItems(first: 100) { nodes { variant { id } quantity } }
          }
          userErrors { field message }
        }
      }`,
      variables: { input: {
        lineItems: toGraphqlDraftLineItems(input.lineItems),
        email: input.email,
        phone: normalizedPhone,
        purchasingEntity: { customerId: `gid://shopify/Customer/${customerId}` },
        shippingLine: input.shippingLine.shippingRateHandle
          ? { shippingRateHandle: input.shippingLine.shippingRateHandle }
          : { title: input.shippingLine.title, price: Number(input.shippingLine.price) },
        shippingAddress: graphqlAddress(input.shippingAddress),
        billingAddress: graphqlAddress(input.billingAddress),
        useCustomerDefaultAddress: false,
        tags: input.tags,
        note: input.note,
        customAttributes: [
          ...input.customAttributes.filter((attribute) =>
            attribute.key !== "checkout_draft_format" && attribute.key !== "CPF/CNPJ"
          ),
          { key: "CPF/CNPJ", value },
          { key: "checkout_draft_format", value: "graphql_v2" },
        ],
      } },
    }),
  });


  const responseText = await response.text();
  let body: any = null;
  try {
    body = responseText ? JSON.parse(responseText) : null;
  } catch {
    body = null;
  }
  const payload = body?.data?.draftOrderCreate;
  const draft = payload?.draftOrder;
  const draftOrderId: string | null = draft?.legacyResourceId
    ? String(draft.legacyResourceId)
    : (draft?.id ? (String(draft.id).split("/").pop() ?? null) : null);
  const invoiceUrl = draft?.invoiceUrl ?? null;

  const creationErrors = body?.errors?.length ? body.errors : (payload?.userErrors ?? []);
  if (!response.ok || !draftOrderId || creationErrors.length) {
    const error = shopifyErrorMessage(creationErrors, `Shopify nao criou o rascunho (HTTP ${response.status}).`);
    console.error("Criacao GraphQL do rascunho falhou:", error);
    if (draftOrderId) await deleteDraftOrder(draftOrderId, token);
    return {
      requestOk: false,
      invoiceUrl,
      draftOrderId: null,
      taxCredentialStored: false,
      error,
    };
  }

  const actualVariantIds = (draft?.lineItems?.nodes || [])
    .map((line: { variant?: { id?: string } | null }) => String(line.variant?.id || "").split("/").pop())
    .filter(Boolean)
    .sort();
  const variantsLinked = expectedVariantIds.length === actualVariantIds.length &&
    expectedVariantIds.every((variantId, index) => variantId === actualVariantIds[index]);
  if (!variantsLinked) {
    console.error(
      `Rascunho ${draftOrderId} criado sem vinculo das variantes; esperado=${expectedVariantIds.join(",")} recebido=${actualVariantIds.join(",")}`,
    );
    await fetch(`${ADMIN_API}/draft_orders/${encodeURIComponent(draftOrderId)}.json`, {
      method: "DELETE",
      headers: { "X-Shopify-Access-Token": token },
    }).catch(() => null);
    return {
      requestOk: false,
      invoiceUrl: null,
      draftOrderId: null,
      taxCredentialStored: false,
      error: "A criacao GraphQL nao vinculou as variantes.",
    };
  }

  const linkedCustomerId = String(draft?.customer?.id || "").split("/").pop();
  const selectedHandle = input.shippingLine.shippingRateHandle;
  const persistedHandle = String(draft?.shippingLine?.shippingRateHandle || "");
  const customerLinked = linkedCustomerId === String(customerId);
  const shippingAddressStored = !input.shippingAddress || Boolean(draft?.shippingAddress?.address1 && draft?.shippingAddress?.zip);
  const billingAddressStored = !input.billingAddress || Boolean(draft?.billingAddress?.address1 && draft?.billingAddress?.zip);
  const deliveryStored = !selectedHandle || persistedHandle === selectedHandle;
  if (!customerLinked || !shippingAddressStored || !billingAddressStored || !deliveryStored) {
    console.error(`Rascunho ${draftOrderId} perdeu dados obrigatorios`, {
      customerLinked, shippingAddressStored, billingAddressStored, deliveryStored,
    });
    await deleteDraftOrder(draftOrderId, token);
    return {
      requestOk: false,
      invoiceUrl: null,
      draftOrderId: null,
      taxCredentialStored: false,
      error: "A Shopify nao preservou cliente, enderecos ou modalidade de entrega no rascunho.",
    };
  }

  // O rascunho nativo ja existe com cliente, enderecos e modalidade corretos.
  // A credencial fiscal e acrescentada separadamente para uma rejeicao fiscal
  // nunca trocar a retirada GraphQL por um rascunho REST incompleto.
  const credential = await setDraftOrderTaxCredential(draftOrderId, value, token);
  return {
    requestOk: true,
    invoiceUrl,
    draftOrderId,
    taxCredentialStored: credential.ok,
    error: credential.error,
  };

}

export interface ShopifyLocalPickupOption {
  handle: string;
  code: string | null;
  title: string;
  locationId: string;
  locationName: string | null;
  address: string | null;
  instructions: string | null;
}

/** Usa a retirada configurada na loja para habilitar o fluxo nativo no Admin. */
export async function fetchShopifyDraftPickupOptions(
  input: {
    items: Array<{ variantId: string; quantity: number }>;
    customerName: string;
    email: string;
    phone: string;
    address: {
      address1: string; number: string; address2?: string; neighborhood: string;
      city: string; provinceCode: string; postalCode: string;
    };
  },
  adminToken: string,
): Promise<ShopifyLocalPickupOption[]> {
  const customerAddress = {
    first_name: input.customerName.trim().split(/\s+/)[0] || "Cliente",
    last_name: input.customerName.trim().split(/\s+/).slice(1).join(" ") || undefined,
    address1: `${input.address.address1}, ${input.address.number}`,
    address2: [input.address.address2, input.address.neighborhood].filter(Boolean).join(" - ") || undefined,
    city: input.address.city,
    province_code: input.address.provinceCode,
    zip: input.address.postalCode,
    phone: brazilPhone(input.phone),
  };
  const customerId = await findOrCreateCustomer(input.email, adminToken, {
    name: input.customerName,
    phone: input.phone,
    address: customerAddress,
  });
  if (!customerId) throw new Error("Shopify nao criou ou localizou o cliente da retirada");
  const response = await fetch(`${ADMIN_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": adminToken },
    body: JSON.stringify({
      query: `query PickupOptions($input: DraftOrderAvailableDeliveryOptionsInput!) {
        draftOrderAvailableDeliveryOptions(input: $input, localPickupCount: 10) {
          availableLocalPickupOptions { handle code title locationId instructions }
        }
      }`,
      variables: { input: {
        lineItems: input.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
        marketRegionCountryCode: "BR",
        purchasingEntity: { customerId: `gid://shopify/Customer/${customerId}` },
        shippingAddress: {
          firstName: customerAddress.first_name,
          lastName: customerAddress.last_name,
          address1: customerAddress.address1,
          address2: customerAddress.address2,
          city: customerAddress.city,
          provinceCode: customerAddress.province_code,
          zip: customerAddress.zip,
          countryCode: "BR",
          phone: customerAddress.phone,
        },
      } },
    }),
  });
  if (!response.ok) throw new Error(`Falha ao consultar retirada Shopify (${response.status})`);
  const body = await response.json();
  if (body?.errors?.length) {
    throw new Error(body.errors[0]?.message || "Shopify rejeitou a consulta de retirada");
  }
  const options = (body?.data?.draftOrderAvailableDeliveryOptions?.availableLocalPickupOptions ?? [])
    .map((option: Record<string, unknown>) => ({
      handle: String(option.handle || ""),
      code: typeof option.code === "string" ? option.code : null,
      title: String(option.title || "Retirada na loja"),
      locationId: String(option.locationId || ""),
      locationName: null,
      address: null,
      instructions: typeof option.instructions === "string" ? option.instructions : null,
    }))
    .filter((option: ShopifyLocalPickupOption) => option.handle && option.locationId);

  const locationIds = [...new Set(options.map((option: ShopifyLocalPickupOption) => option.locationId))];
  if (!locationIds.length) return options;

  const locations = new Map<string, { name: string | null; address: string | null }>();
  try {
    const locationsResponse = await fetch(`${ADMIN_API}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": adminToken },
      body: JSON.stringify({
        query: `query PickupLocations($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Location { id name address { formatted } }
          }
        }`,
        variables: { ids: locationIds },
      }),
    });
    if (!locationsResponse.ok) {
      throw new Error(`HTTP ${locationsResponse.status}`);
    }
    const locationsBody = await locationsResponse.json();
    if (locationsBody?.errors?.length) {
      throw new Error(locationsBody.errors[0]?.message || "consulta rejeitada");
    }
    for (const location of locationsBody?.data?.nodes ?? []) {
      if (!location?.id) continue;
      const formatted = Array.isArray(location.address?.formatted)
        ? location.address.formatted.map(String).map((line: string) => line.trim()).filter(Boolean).join(", ")
        : "";
      locations.set(String(location.id), {
        name: typeof location.name === "string" ? location.name : null,
        address: formatted || null,
      });
    }
  } catch (error) {
    // O token pode não ter read_locations. Endereço é informativo e jamais
    // pode impedir a criação do pedido ou da cobrança no Asaas.
    console.warn("Endereco da localizacao de retirada indisponivel:", error);
  }

  return options.map((option: ShopifyLocalPickupOption) => ({
    ...option,
    locationName: locations.get(option.locationId)?.name ?? null,
    address: locations.get(option.locationId)?.address ?? null,
  }));
}

/**
 * Recria um draft legado no formato GraphQL. Usado somente depois de confirmar
 * o pagamento, quando a Shopify nao aceita persistir o CPF/CNPJ no draft REST.
 */
export async function cloneLegacyFiscalDraftOrder(
  draftOrderId: string,
  cpfCnpj: string,
  token: string,
): Promise<FiscalDraftOrderResult> {
  const response = await fetch(`${ADMIN_API}/draft_orders/${encodeURIComponent(draftOrderId)}.json`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  const draft = response.ok ? (await response.json())?.draft_order : null;
  if (!draft) {
    return {
      requestOk: false,
      invoiceUrl: null,
      draftOrderId: null,
      taxCredentialStored: false,
      error: `Shopify nao permitiu ler o rascunho legado (HTTP ${response.status}).`,
    };
  }

  const attributes = (draft.note_attributes ?? []).map((attribute: Record<string, unknown>) => ({
    key: String(attribute.name || ""),
    value: String(attribute.value || ""),
  })).filter((attribute: { key: string }) => attribute.key);
  if (attributes.some((attribute: { key: string; value: string }) =>
    attribute.key === "checkout_draft_format" && attribute.value === "graphql_v2"
  )) {
    return {
      requestOk: false,
      invoiceUrl: draft.invoice_url ?? null,
      draftOrderId: String(draft.id),
      taxCredentialStored: false,
      error: "O rascunho ja usa o formato fiscal novo e nao sera duplicado.",
    };
  }

  const lineItems = (draft.line_items ?? []).map((line: Record<string, unknown>) => ({
    variant_id: line.variant_id,
    quantity: Number(line.quantity) || 1,
    ...(line.applied_discount ? { applied_discount: line.applied_discount } : {}),
  }));
  if (!lineItems.length || lineItems.some((line: Record<string, unknown>) => !line.variant_id)) {
    return {
      requestOk: false,
      invoiceUrl: draft.invoice_url ?? null,
      draftOrderId: String(draft.id),
      taxCredentialStored: false,
      error: "O rascunho antigo possui item sem variante Shopify e nao pode ser recriado automaticamente.",
    };
  }

  const shippingLine = draft.shipping_line as Record<string, unknown> | null;
  return createFiscalDraftOrder({
    lineItems,
    email: String(draft.email || draft.customer?.email || ""),
    customerName: [
      draft.shipping_address?.first_name || draft.billing_address?.first_name || draft.customer?.first_name,
      draft.shipping_address?.last_name || draft.billing_address?.last_name || draft.customer?.last_name,
    ].filter(Boolean).join(" "),
    phone: String(draft.phone || draft.shipping_address?.phone || draft.billing_address?.phone || draft.customer?.phone || ""),
    cpfCnpj,
    shippingLine: {
      title: String(shippingLine?.title || "Retirada na loja"),
      price: Number(shippingLine?.price || 0).toFixed(2),
    },
    shippingAddress: draft.shipping_address || undefined,
    billingAddress: draft.billing_address || undefined,
    tags: String(draft.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
    note: String(draft.note || ""),
    customAttributes: attributes,
  }, token);
}

export async function deleteDraftOrder(draftOrderId: string, token: string): Promise<boolean> {
  const response = await fetch(`${ADMIN_API}/draft_orders/${encodeURIComponent(draftOrderId)}.json`, {
    method: "DELETE",
    headers: { "X-Shopify-Access-Token": token },
  });
  if (!response.ok && response.status !== 404) {
    console.error(`Nao foi possivel remover o rascunho legado ${draftOrderId}: HTTP ${response.status}`);
  }
  return response.ok || response.status === 404;
}

export interface CompleteDraftOrderResult {
  requestOk: boolean;
  orderId: string | null;
  alreadyCompleted: boolean;
  error: string | null;
}

export interface TaxCredentialResult {
  ok: boolean;
  error: string | null;
}

function shopifyErrorMessage(value: unknown, fallback: string): string {
  if (!value) return fallback;
  const entries = Array.isArray(value) ? value : [value];
  const messages = entries.map((entry) => {
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object") {
      const item = entry as { message?: unknown; field?: unknown };
      const message = typeof item.message === "string" ? item.message : "";
      const field = Array.isArray(item.field) ? item.field.join(".") : String(item.field || "");
      return [field, message].filter(Boolean).join(": ");
    }
    return "";
  }).filter(Boolean);
  return (messages.join("; ") || fallback)
    .replace(/\b\d{11,14}\b/g, "[documento protegido]")
    .slice(0, 500);
}

/**
 * O mercado Brasil da Shopify exige o CPF/CNPJ como credencial fiscal do pedido.
 * A credencial só é aceita quando os endereços do draft têm país BR — sem isso a
 * conclusão falha com "Enter a valid CPF/CNPJ".
 */
export async function setDraftOrderTaxCredential(
  draftOrderId: string,
  cpfCnpj: string,
  token: string,
): Promise<TaxCredentialResult> {
  const value = String(cpfCnpj || "").replace(/\D/g, "");
  if (value.length !== 11 && value.length !== 14) {
    return { ok: false, error: "CPF/CNPJ ausente ou com quantidade de digitos invalida." };
  }

  // Leitura apenas diagnostica o conteúdo existente. A atualização abaixo não
  // reenvia os itens: alterar só os campos informados preserva produtos e descontos.
  const currentRes = await fetch(`${ADMIN_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `query DraftTaxCredential($id: ID!) {
        draftOrder(id: $id) {
          localizedFields(first: 5) { nodes { key value } }
        }
      }`,
      variables: { id: `gid://shopify/DraftOrder/${draftOrderId}` },
    }),
  });
  const currentBody = await currentRes.json().catch(() => null);
  if (!currentRes.ok || currentBody?.errors?.length || !currentBody?.data?.draftOrder) {
    return {
      ok: false,
      error: shopifyErrorMessage(
        currentBody?.errors,
        `Shopify nao permitiu ler o rascunho (HTTP ${currentRes.status}).`,
      ),
    };
  }
  const currentLocalizedFields = currentBody?.data?.draftOrder?.localizedFields?.nodes ?? [];
  const credentialAlreadyStored = currentLocalizedFields.some(
    (node: { key?: string; value?: string }) =>
      node?.key === "TAX_CREDENTIAL_BR" && String(node?.value || "").replace(/\D/g, "") === value,
  );
  // A criação do rascunho já grava a credencial. Não repita um
  // draftOrderUpdate depois do pagamento: além de desnecessário, uma segunda
  // atualização pode ser rejeitada e deixar uma venda paga presa em Rascunhos.
  if (credentialAlreadyStored) {
    return { ok: true, error: null };
  }

  const response = await fetch(`${ADMIN_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `mutation SetTaxCredential($id: ID!, $input: DraftOrderInput!) {
        draftOrderUpdate(id: $id, input: $input) {
          draftOrder { id localizedFields(first: 5) { nodes { key value } } }
          userErrors { field message }
        }
      }`,
      variables: {
        id: `gid://shopify/DraftOrder/${draftOrderId}`,
        input: {
          localizedFields: [{ key: "TAX_CREDENTIAL_BR", value }],
        },
      },
    }),
  });


  if (!response.ok) {
    const responseText = await response.text();
    console.error(`Falha ao gravar CPF/CNPJ no draft ${draftOrderId}:`, response.status, responseText);
    return {
      ok: false,
      error: shopifyErrorMessage(responseText, `Shopify rejeitou o CPF/CNPJ (HTTP ${response.status}).`),
    };
  }
  const body = await response.json();
  const errors = body?.data?.draftOrderUpdate?.userErrors ?? [];
  if (body?.errors || errors.length) {
    console.error(`CPF/CNPJ rejeitado no draft ${draftOrderId}:`, JSON.stringify(body?.errors ?? errors));
    return {
      ok: false,
      error: shopifyErrorMessage(body?.errors ?? errors, "Shopify rejeitou o CPF/CNPJ do rascunho."),
    };
  }
  const stored = body?.data?.draftOrderUpdate?.draftOrder?.localizedFields?.nodes ?? [];
  const persisted = stored.some((node: { key?: string; value?: string }) => node?.value === value);
  if (!persisted) {
    console.error(`CPF/CNPJ não persistiu no draft ${draftOrderId}`);
    return { ok: false, error: "A Shopify aceitou a atualizacao, mas nao gravou o CPF/CNPJ no rascunho." };
  }
  return { ok: true, error: null };

}


/** Conclui um draft já pago fora da Shopify, sem coletar novo pagamento. */
export async function completeDraftOrder(
  draftOrderId: string,
  token: string,
  paymentPending = false,
  cpfCnpj?: string | null,
): Promise<CompleteDraftOrderResult> {
  // Idempotencia vem antes da atualizacao fiscal: um draft ja concluido nao
  // aceita draftOrderUpdate, mas ainda deve devolver o pedido existente.
  const existing = await fetch(`${ADMIN_API}/draft_orders/${encodeURIComponent(draftOrderId)}.json`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  if (existing.ok) {
    const body = await existing.json();
    const existingOrderId = body?.draft_order?.order_id;
    if (existingOrderId) {
      return { requestOk: true, orderId: String(existingOrderId), alreadyCompleted: true, error: null };
    }
  }

  // A extensao fiscal da Shopify e inconsistente para alguns CPFs validos. O
  // documento tambem fica nos atributos do pedido; nao prenda uma venda ja paga
  // como rascunho apenas porque a extensao localizada foi rejeitada.
  if (cpfCnpj) {
    const taxCredential = await setDraftOrderTaxCredential(draftOrderId, cpfCnpj, token);
    if (!taxCredential.ok) {
      console.warn(`Draft ${draftOrderId}: credencial fiscal nao persistiu; concluindo com CPF/CNPJ nos atributos.`, taxCredential.error);
    }
  }

  const completed = await fetch(`${ADMIN_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `mutation CompleteDraft($id: ID!, $paymentPending: Boolean) {
        draftOrderComplete(id: $id, paymentPending: $paymentPending) {
          draftOrder { id order { id legacyResourceId } }
          userErrors { field message }
        }
      }`,
      variables: {
        id: `gid://shopify/DraftOrder/${draftOrderId}`,
        paymentPending,
      },
    }),
  });

  const completionText = await completed.text();
  let completionBody: any = null;
  try {
    completionBody = completionText ? JSON.parse(completionText) : null;
  } catch {
    completionBody = null;
  }
  const completionPayload = completionBody?.data?.draftOrderComplete;
  const completedOrder = completionPayload?.draftOrder?.order;
  const completedOrderId = completedOrder?.legacyResourceId || String(completedOrder?.id || "").split("/").pop();
  const completionErrors = completionBody?.errors || completionPayload?.userErrors || [];
  if (completed.ok && completedOrderId && !completionErrors.length) {
    return {
      requestOk: true,
      orderId: String(completedOrderId),
      alreadyCompleted: false,
      error: null,
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
      return { requestOk: true, orderId: String(orderId), alreadyCompleted: true, error: null };
    }
  }

  console.error(`Falha ao concluir Draft Order ${draftOrderId}:`, completed.status, completionText);
  return {
    requestOk: false,
    orderId: null,
    alreadyCompleted: false,
    error: shopifyErrorMessage(
      completionErrors.length ? completionErrors : completionText,
      `Shopify nao concluiu o rascunho (HTTP ${completed.status}).`,
    ),
  };
}
