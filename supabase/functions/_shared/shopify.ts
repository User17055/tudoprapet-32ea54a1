// Chamadas à Shopify. Usa apenas fetch (padrão web), sem depender de Deno.

import {
  isAlreadyPickedUp,
  mergeNoteAttributes,
  type NoteAttribute,
  PICKUP_CODE_ATTRIBUTE,
  PICKUP_DONE_ATTRIBUTE,
} from "./pickup.ts";

export const SHOP_DOMAIN = "petjoy-deals-hb8r9.myshopify.com";

/** Mantém todas as Edge Functions usando o mesmo token Admin da Shopify. */
export function shopifyAdminToken(): string {
  return Deno.env.get("SHOPIFY_ACCESS_TOKEN") ||
    Deno.env.get("SHOPIFY_ONLINE_ACCESS_TOKEN:user:4HrJkQRl3KUXTrTOAgUkwQSkHWo2") ||
    "";
}
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

export interface FiscalDraftOrderResult extends DraftOrderResult {
  taxCredentialStored: boolean;
  error: string | null;
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

function graphqlAddress(address: Record<string, unknown> | null | undefined) {
  if (!address) return undefined;
  return {
    firstName: address.first_name,
    lastName: address.last_name,
    address1: address.address1,
    address2: address.address2 || undefined,
    city: address.city,
    zip: address.zip,
    phone: address.phone,
    provinceCode: address.province_code || undefined,
    countryCode: "BR",
  };
}

/**
 * Cria o draft e a credencial fiscal brasileira na mesma mutação.
 * A Shopify documenta localizedFields no draftOrderCreate; evitar a atualização
 * posterior também impede que drafts de retirada percam o contexto fiscal.
 */
export async function createFiscalDraftOrder(
  input: {
    lineItems: Record<string, unknown>[];
    customerId: string;
    email: string;
    cpfCnpj: string;
    shippingLine: { title: string; price: string };
    shippingAddress?: Record<string, unknown>;
    billingAddress?: Record<string, unknown>;
    tags: string[];
    note: string;
    customAttributes: Array<{ key: string; value: string }>;
  },
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

  // Diagnóstico confirmado em produção (2025-07): a Shopify ignora
  // localizedFields quando o draft não tem shippingAddress BR — sem erro algum.
  // Então criamos sempre com um endereço BR e, na retirada, limpamos o endereço
  // depois (a credencial fiscal continua gravada) restaurando a shippingLine.
  const isPickup = !input.shippingAddress;
  let creationShippingAddress = graphqlAddress(input.shippingAddress) ?? graphqlAddress(input.billingAddress);
  if (!creationShippingAddress) {
    const shopRes = await fetch(`${ADMIN_API}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({
        query: `{ shop { billingAddress { address1 city zip provinceCode countryCodeV2 } } }`,
      }),
    });
    const shopAddress = (await shopRes.json().catch(() => null))?.data?.shop?.billingAddress;
    creationShippingAddress = {
      firstName: "Retirada",
      lastName: "na loja",
      address1: shopAddress?.address1 || "Retirada na loja",
      city: shopAddress?.city || "Presidente Prudente",
      zip: shopAddress?.zip || "19010000",
      provinceCode: shopAddress?.provinceCode || "SP",
      countryCode: "BR",
    };
  }

  const shippingLineInput = {
    title: input.shippingLine.title,
    price: Number(input.shippingLine.price),
  };

  const response = await fetch(`${ADMIN_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `mutation CreateFiscalDraft($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder {
            id
            invoiceUrl
            localizedFields(first: 5) { nodes { key value } }
            lineItems(first: 100) { nodes { variant { id } quantity } }
          }
          userErrors { field message }
        }
      }`,
      variables: {
        input: {
          lineItems: input.lineItems,
          customerId: input.customerId,
          email: input.email,
          localizedFields: [{ key: "TAX_CREDENTIAL_BR", value }],
          shippingLine: shippingLineInput,
          shippingAddress: creationShippingAddress,
          billingAddress: graphqlAddress(input.billingAddress),
          useCustomerDefaultAddress: false,
          tags: input.tags,
          note: input.note,
          customAttributes: input.customAttributes,
        },
      },
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
  const rawErrors: any[] = body?.errors?.length ? body.errors : (payload?.userErrors ?? []);
  // O token Admin da loja pode nao ter read_products: nesse caso a Shopify
  // devolve ACCESS_DENIED apenas no subcampo lineItems.variant, sem impedir a
  // criacao do rascunho. Isso nao pode falhar o checkout.
  const accessDenied = rawErrors.filter((entry) =>
    entry?.extensions?.code === "ACCESS_DENIED" || /Access denied for/i.test(String(entry?.message || "")),
  );
  const errors = rawErrors.filter((entry) => !accessDenied.includes(entry));
  if (accessDenied.length) {
    console.warn("draftOrderCreate: leitura de campos bloqueada por escopo:", accessDenied.map((e) => e?.message).join("; "));
  }
  const draft = payload?.draftOrder;
  const draftOrderId = String(draft?.id || "").split("/").pop() || null;
  const stored = draft?.localizedFields?.nodes ?? [];
  const hasCredential = (nodes: any[]) => nodes.some(
    (node: { key?: string; value?: string }) => node?.key === "TAX_CREDENTIAL_BR" && String(node?.value || "").replace(/\D/g, "") === value,
  );
  let taxCredentialStored = hasCredential(stored);
  console.log(
    `draftOrderCreate: draft=${draftOrderId} camposLocalizados=[${stored.map((n: any) => n?.key).join(",")}] credencial=${taxCredentialStored}`,
  );
  // A mutação às vezes devolve localizedFields vazio mesmo tendo gravado. Uma
  // releitura confirma antes de liberar qualquer cobrança.
  if (draftOrderId && !taxCredentialStored) {
    const recheck = await fetch(`${ADMIN_API}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({
        query: `query CheckCredential($id: ID!) {
          draftOrder(id: $id) { localizedFields(first: 5) { nodes { key value } } }
        }`,
        variables: { id: `gid://shopify/DraftOrder/${draftOrderId}` },
      }),
    });
    const recheckBody = await recheck.json().catch(() => null);
    const recheckNodes = recheckBody?.data?.draftOrder?.localizedFields?.nodes ?? [];
    taxCredentialStored = hasCredential(recheckNodes);
    console.log(
      `draftOrderCreate releitura: draft=${draftOrderId} campos=[${recheckNodes.map((n: any) => n?.key).join(",")}] credencial=${taxCredentialStored}`,
    );
  }
  const returnedLines: any[] = draft?.lineItems?.nodes ?? [];
  const lineItemsHaveVariant = returnedLines.length === 0
    ? true
    : returnedLines.every((node) => Boolean(node?.variant?.id));
  if (returnedLines.length) {
    console.log(`draftOrderCreate linhas=${returnedLines.length} comVariante=${lineItemsHaveVariant}`);
  }

  if (!response.ok || errors.length || !draftOrderId || !taxCredentialStored) {
    const error = shopifyErrorMessage(
      errors.length ? errors : null,
      !taxCredentialStored
        ? "A Shopify nao gravou o CPF/CNPJ ao criar o rascunho (draftOrderCreate)."
        : `Shopify nao criou o rascunho (HTTP ${response.status}).`,
    );
    console.error("draftOrderCreate falhou:", error);
    return {
      requestOk: false,
      invoiceUrl: draft?.invoiceUrl ?? null,
      draftOrderId,
      taxCredentialStored,
      error,
    };
  }


  // Retirada: remove o endereço de entrega (evita fulfillment de envio) e
  // restaura a shippingLine "Retirada na loja", que a Shopify limpa junto.
  let invoiceUrl = draft.invoiceUrl ?? null;
  if (isPickup) {
    const clear = await fetch(`${ADMIN_API}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({
        query: `mutation ClearShipping($id: ID!, $input: DraftOrderInput!) {
          draftOrderUpdate(id: $id, input: $input) {
            draftOrder {
              invoiceUrl
              shippingAddress { countryCodeV2 }
              shippingLine { title }
              localizedFields(first: 5) { nodes { key value } }
            }
            userErrors { field message }
          }
        }`,
        variables: {
          id: `gid://shopify/DraftOrder/${draftOrderId}`,
          input: { shippingAddress: null, shippingLine: shippingLineInput },
        },
      }),
    });
    const clearBody = await clear.json().catch(() => null);
    const updated = clearBody?.data?.draftOrderUpdate?.draftOrder;
    const clearErrors = clearBody?.errors?.length
      ? clearBody.errors
      : (clearBody?.data?.draftOrderUpdate?.userErrors ?? []);
    const stillStored = hasCredential(updated?.localizedFields?.nodes ?? []);
    console.log(
      `retirada: endereco=${updated?.shippingAddress?.countryCodeV2 ?? "null"} frete=${updated?.shippingLine?.title ?? "null"} credencial=${stillStored} erros=${clearErrors.length}`,
    );
    if (!stillStored) {
      return {
        requestOk: false,
        invoiceUrl,
        draftOrderId,
        taxCredentialStored: false,
        error: "A credencial fiscal foi perdida ao ajustar o rascunho de retirada.",
      };
    }
    invoiceUrl = updated?.invoiceUrl ?? invoiceUrl;
  }

  return {
    requestOk: true,
    invoiceUrl,
    draftOrderId,
    taxCredentialStored: true,
    error: null,
  };

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

  const read = await fetch(`${ADMIN_API}/draft_orders/${encodeURIComponent(draftOrderId)}.json`, {
    headers: { "X-Shopify-Access-Token": token },
  });
  const draft = read.ok ? (await read.json())?.draft_order : null;
  if (!draft) {
    return { ok: false, error: `Shopify nao permitiu ler o rascunho (HTTP ${read.status}).` };
  }
  const brAddress = (address: Record<string, unknown> | null | undefined) => address
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

  // Leitura apenas diagnostica o conteúdo existente. A atualização abaixo não
  // reenvia os itens: alterar só os campos informados preserva produtos e descontos.
  const currentRes = await fetch(`${ADMIN_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `query DraftLines($id: ID!) {
        draftOrder(id: $id) {
          shippingLine { title originalPriceSet { shopMoney { amount } } }
          lineItems(first: 100) {
            nodes {
              quantity
              title
              requiresShipping
              taxable
              variant { id }
              originalUnitPriceSet { shopMoney { amount } }
              appliedDiscount { title description valueType value }
            }
          }
        }
      }`,
      variables: { id: `gid://shopify/DraftOrder/${draftOrderId}` },
    }),
  });
  const currentBody = currentRes.ok ? await currentRes.json() : null;
  const currentNodes = currentBody?.data?.draftOrder?.lineItems?.nodes as
    | Record<string, unknown>[]
    | undefined;
  if (!Array.isArray(currentNodes) || currentNodes.length === 0) {
    console.error(
      `Não foi possível ler as linhas do draft ${draftOrderId} — CPF/CNPJ não gravado para não apagar itens.`,
      currentRes.status,
      JSON.stringify(currentBody?.errors ?? null),
    );
  }

  const existingLineItems = (currentNodes || []).map((node) => {
    const discount = node.appliedDiscount as Record<string, unknown> | null;
    const appliedDiscount = discount
      ? {
        title: discount.title || undefined,
        description: discount.description || undefined,
        valueType: String(discount.valueType || "FIXED_AMOUNT").toUpperCase(),
        value: Number(discount.value) || 0,
      }
      : undefined;
    const quantity = Number(node.quantity) || 1;
    const variantId = (node.variant as { id?: string } | null)?.id;
    if (variantId) return { variantId, quantity, appliedDiscount };
    const unitPrice = (node.originalUnitPriceSet as
      | { shopMoney?: { amount?: string } }
      | undefined)?.shopMoney?.amount ?? "0";
    return {
      title: node.title,
      originalUnitPrice: String(unitPrice),
      quantity,
      requiresShipping: Boolean(node.requiresShipping),
      taxable: Boolean(node.taxable),
      appliedDiscount,
    };
  });

  const currentShipping = currentBody?.data?.draftOrder?.shippingLine as
    | { title?: string; originalPriceSet?: { shopMoney?: { amount?: string } } }
    | null;
  const shippingLine = currentShipping
    ? {
      title: currentShipping.title,
      price: String(currentShipping.originalPriceSet?.shopMoney?.amount ?? "0"),
    }
    : undefined;


  const response = await fetch(`${ADMIN_API}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({
      query: `mutation SetTaxCredential($id: ID!, $input: DraftOrderInput!) {
        draftOrderUpdate(id: $id, input: $input) {
          draftOrder { id localizedFields(first: 5) { nodes { key value } } lineItems(first: 50) { nodes { quantity title } } }
          userErrors { field message }
        }
      }`,
      variables: {
        id: `gid://shopify/DraftOrder/${draftOrderId}`,
        input: {
          marketRegionCountryCode: "BR",
          shippingAddress: brAddress(draft?.shipping_address),
          // Retirada não possui shipping_address. Ainda assim a credencial fiscal
          // brasileira precisa de um contexto BR; o país de cobrança é suficiente
          // e não transforma a retirada em envio.
          billingAddress: brAddress(draft?.billing_address) || { countryCode: "BR" },
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

  // Nunca conclua um pedido brasileiro sem confirmar que a credencial fiscal
  // persistiu. Continuar apesar da falha deixava a venda paga presa em Rascunhos.
  if (cpfCnpj) {
    const taxCredential = await setDraftOrderTaxCredential(draftOrderId, cpfCnpj, token);
    if (!taxCredential.ok) {
      console.error(`Draft ${draftOrderId} nao concluido:`, taxCredential.error);
      return { requestOk: false, orderId: null, alreadyCompleted: false, error: taxCredential.error };
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
