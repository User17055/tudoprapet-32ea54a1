import { toast } from "sonner";

const SHOPIFY_API_VERSION = '2025-07';
const SHOPIFY_STORE_PERMANENT_DOMAIN = 'petjoy-deals-hb8r9.myshopify.com';
const SHOPIFY_STOREFRONT_URL = `https://${SHOPIFY_STORE_PERMANENT_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`;
const SHOPIFY_STOREFRONT_TOKEN = '66b7b618d388aa97942b3ac0c15a2315';
const SHOPIFY_CACHE_TTL = 5 * 60 * 1000;

interface TimedCacheEntry<T> {
  data: T | null;
  expiresAt: number;
  pending: Promise<T> | null;
}

const queryCache = new Map<
  string,
  TimedCacheEntry<Awaited<ReturnType<typeof storefrontApiRequest>>>
>();
const productListCache = new Map<string, TimedCacheEntry<ShopifyProduct[]>>();
const productByHandleCache = new Map<string, ShopifyProduct>();

export interface ShopifyProduct {
  node: {
    id: string;
    title: string;
    description: string;
    handle: string;
    vendor?: string;
    tags?: string[];
    productType?: string;
    priceRange: {
      minVariantPrice: {
        amount: string;
        currencyCode: string;
      };
    };
    images: {
      edges: Array<{
        node: {
          url: string;
          altText: string | null;
        };
      }>;
    };
    variants: {
      edges: Array<{
        node: {
          id: string;
          title: string;
          price: {
            amount: string;
            currencyCode: string;
          };
          compareAtPrice?: {
            amount: string;
            currencyCode: string;
          } | null;
          availableForSale: boolean;
          selectedOptions: Array<{
            name: string;
            value: string;
          }>;
        };
      }>;
    };
    options: Array<{
      name: string;
      values: string[];
    }>;
  };
}

export async function storefrontApiRequest(query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(SHOPIFY_STOREFRONT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 402) {
    toast.error("Shopify: Pagamento necessário", {
      description: "A API do Shopify requer um plano de pagamento ativo.",
    });
    return;
  }

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  if (data.errors) {
    throw new Error(`Shopify error: ${data.errors.map((e: { message: string }) => e.message).join(', ')}`);
  }
  return data;
}

export async function cachedStorefrontApiRequest(
  query: string,
  variables: Record<string, unknown> = {},
  ttl = SHOPIFY_CACHE_TTL,
) {
  const key = `${query}|${JSON.stringify(variables)}`;
  const now = Date.now();
  const cached = queryCache.get(key);
  if (cached?.data && cached.expiresAt > now) return cached.data;
  if (cached?.pending) return cached.pending;

  const pending = storefrontApiRequest(query, variables)
    .then((data) => {
      queryCache.set(key, { data, expiresAt: Date.now() + ttl, pending: null });
      return data;
    })
    .catch((error) => {
      queryCache.delete(key);
      throw error;
    });
  queryCache.set(key, {
    data: cached?.data ?? null,
    expiresAt: cached?.expiresAt ?? 0,
    pending,
  });
  return pending;
}

export const PRODUCTS_QUERY = `
  query GetProducts($first: Int!, $query: String, $after: String) {
    products(first: $first, query: $query, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          description
          handle
          vendor
          tags
          productType
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          images(first: 5) {
            edges {
              node {
                url
                altText
              }
            }
          }
          variants(first: 10) {
            edges {
              node {
                id
                title
                price {
                  amount
                  currencyCode
                }
                compareAtPrice {
                  amount
                  currencyCode
                }
                availableForSale
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
          options {
            name
            values
          }
        }
      }
    }
  }
`;

/**
 * Busca TODOS os produtos da loja paginando via cursor (250 por página).
 * Necessário porque `first: 100` deixava produtos de fora quando o catálogo cresce.
 */
export async function fetchAllShopifyProducts(searchQuery?: string): Promise<ShopifyProduct[]> {
  const cacheKey = searchQuery?.trim().toLowerCase() || "__all__";
  const now = Date.now();
  const cached = productListCache.get(cacheKey);
  if (cached?.data && cached.expiresAt > now) return cached.data;
  if (cached?.pending) return cached.pending;

  const pending = fetchAllShopifyProductsUncached(searchQuery)
    .then((products) => {
      products.forEach((product) => productByHandleCache.set(product.node.handle, product));
      productListCache.set(cacheKey, {
        data: products,
        expiresAt: Date.now() + SHOPIFY_CACHE_TTL,
        pending: null,
      });
      return products;
    })
    .catch((error) => {
      productListCache.delete(cacheKey);
      throw error;
    });
  productListCache.set(cacheKey, {
    data: cached?.data ?? null,
    expiresAt: cached?.expiresAt ?? 0,
    pending,
  });
  return pending;
}

export async function searchShopifyProducts(
  searchQuery: string,
  first = 8,
): Promise<ShopifyProduct[]> {
  const term = searchQuery.trim();
  if (term.length < 2) return [];

  const data = await cachedStorefrontApiRequest(PRODUCTS_QUERY, {
    first,
    query: term,
    after: null,
  });
  const products = (data?.data?.products?.edges || []) as ShopifyProduct[];
  products.forEach((product) => productByHandleCache.set(product.node.handle, product));
  return products;
}

async function fetchAllShopifyProductsUncached(searchQuery?: string): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  let after: string | null = null;
  for (let i = 0; i < 20; i++) {
    const data = await storefrontApiRequest(PRODUCTS_QUERY, {
      first: 250,
      query: searchQuery,
      after,
    });
    const conn = data?.data?.products;
    if (!conn) break;
    all.push(...conn.edges);
    if (!conn.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return all;
}

export function getCachedShopifyProductByHandle(handle?: string) {
  return handle ? productByHandleCache.get(handle) ?? null : null;
}

export async function fetchShopifyProductByHandle(
  handle: string,
  preferListCache = true,
): Promise<ShopifyProduct | null> {
  const cached = getCachedShopifyProductByHandle(handle);
  if (preferListCache && cached) return cached;
  const data = await cachedStorefrontApiRequest(PRODUCT_BY_HANDLE_QUERY, { handle });
  const node = data?.data?.productByHandle;
  if (!node) return null;
  const product = { node } as ShopifyProduct;
  productByHandleCache.set(handle, product);
  return product;
}

export const BEST_SELLING_PRODUCTS_QUERY = `
  query GetBestSellingProducts($first: Int!) {
    products(first: $first, sortKey: BEST_SELLING) {
      edges {
        node {
          id
          title
          description
          handle
          vendor
          tags
          productType
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          images(first: 5) {
            edges {
              node {
                url
                altText
              }
            }
          }
          variants(first: 10) {
            edges {
              node {
                id
                title
                price {
                  amount
                  currencyCode
                }
                compareAtPrice {
                  amount
                  currencyCode
                }
                availableForSale
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
          options {
            name
            values
          }
        }
      }
    }
  }
`;

export const PRODUCT_RECOMMENDATIONS_QUERY = `
  query GetRecommendations($productId: ID!) {
    productRecommendations(productId: $productId, intent: RELATED) {
      id
      title
      description
      handle
      vendor
      priceRange {
        minVariantPrice { amount currencyCode }
      }
      images(first: 3) {
        edges { node { url altText } }
      }
      variants(first: 5) {
        edges {
          node {
            id
            title
            price { amount currencyCode }
            compareAtPrice { amount currencyCode }
            availableForSale
            selectedOptions { name value }
          }
        }
      }
      options { name values }
    }
  }
`;

export const PRODUCT_BY_HANDLE_QUERY = `
  query GetProductByHandle($handle: String!) {
    productByHandle(handle: $handle) {
      id
      title
      description
      handle
      vendor
      priceRange {
        minVariantPrice {
          amount
          currencyCode
        }
      }
      images(first: 10) {
        edges {
          node {
            url
            altText
          }
        }
      }
      variants(first: 30) {
        edges {
          node {
            id
            title
                price {
                  amount
                  currencyCode
                }
                compareAtPrice {
                  amount
                  currencyCode
                }
                availableForSale
                selectedOptions {
                  name
              value
            }
          }
        }
      }
      options {
        name
        values
      }
    }
  }
`;

// Cart mutations
const CART_QUERY = `
  query cart($id: ID!) {
    cart(id: $id) {
      id
      totalQuantity
      lines(first: 100) {
        edges { node { id merchandise { ... on ProductVariant { id } } } }
      }
    }
  }
`;

const CART_CREATE_MUTATION = `
  mutation cartCreate($input: CartInput!) {
    cartCreate(input: $input) {
      cart {
        id
        checkoutUrl
        lines(first: 100) { edges { node { id merchandise { ... on ProductVariant { id } } } } }
      }
      userErrors { field message }
    }
  }
`;

const CART_LINES_ADD_MUTATION = `
  mutation cartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart {
        id
        lines(first: 100) { edges { node { id merchandise { ... on ProductVariant { id } } } } }
      }
      userErrors { field message }
    }
  }
`;

const CART_LINES_UPDATE_MUTATION = `
  mutation cartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) {
      cart { id }
      userErrors { field message }
    }
  }
`;

const CART_LINES_REMOVE_MUTATION = `
  mutation cartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
      cart { id }
      userErrors { field message }
    }
  }
`;

const CART_DISCOUNT_CODES_UPDATE_MUTATION = `
  mutation cartDiscountCodesUpdate($cartId: ID!, $discountCodes: [String!]!) {
    cartDiscountCodesUpdate(cartId: $cartId, discountCodes: $discountCodes) {
      cart {
        id
        discountCodes { code applicable }
      }
      userErrors { field message }
    }
  }
`;

// Passar null remove qualquer cupom aplicado ao carrinho.
// Shopify aceita códigos inexistentes sem userError, mas marca applicable: false.
export async function applyDiscountToCart(
  cartId: string,
  discountCode: string | null,
): Promise<{ success: boolean; applicable: boolean }> {
  try {
    const data = await storefrontApiRequest(CART_DISCOUNT_CODES_UPDATE_MUTATION, {
      cartId,
      discountCodes: discountCode ? [discountCode] : [],
    });
    const payload = data?.data?.cartDiscountCodesUpdate;
    const userErrors = payload?.userErrors || [];
    if (userErrors.length > 0) {
      console.error('Failed to apply discount:', userErrors);
      return { success: false, applicable: false };
    }
    if (!discountCode) return { success: true, applicable: true };
    const codes: { code: string; applicable: boolean }[] = payload?.cart?.discountCodes || [];
    const applied = codes.find((c) => c.code.toLowerCase() === discountCode.toLowerCase());
    return { success: true, applicable: Boolean(applied?.applicable) };
  } catch (error) {
    console.error('Failed to apply discount code:', error);
    return { success: false, applicable: false };
  }
}

function formatCheckoutUrl(checkoutUrl: string): string {
  try {
    const url = new URL(checkoutUrl);
    url.searchParams.set('channel', 'online_store');
    return url.toString();
  } catch {
    return checkoutUrl;
  }
}

function isCartNotFoundError(userErrors: Array<{ field: string[] | null; message: string }>): boolean {
  return userErrors.some(e => e.message.toLowerCase().includes('cart not found') || e.message.toLowerCase().includes('does not exist'));
}

export interface CartItem {
  lineId: string | null;
  product: ShopifyProduct;
  variantId: string;
  variantTitle: string;
  price: { amount: string; currencyCode: string };
  quantity: number;
  selectedOptions: Array<{ name: string; value: string }>;
}

// Shopify auto-generates a "Title: Default Title" option for products without
// real variants — not meaningful to shoppers, so it's filtered from display.
export function getDisplayOptions(options: Array<{ name: string; value: string }>) {
  return options.filter((o) => o.value !== "Default Title");
}

export async function createShopifyCart(item: CartItem): Promise<{ cartId: string; checkoutUrl: string; lineId: string } | null> {
  const data = await storefrontApiRequest(CART_CREATE_MUTATION, {
    input: { lines: [{ quantity: item.quantity, merchandiseId: item.variantId }] },
  });

  if (data?.data?.cartCreate?.userErrors?.length > 0) {
    console.error('Cart creation failed:', data.data.cartCreate.userErrors);
    return null;
  }

  const cart = data?.data?.cartCreate?.cart;
  if (!cart?.checkoutUrl) return null;

  const lineId = cart.lines.edges[0]?.node?.id;
  if (!lineId) return null;

  return { cartId: cart.id, checkoutUrl: formatCheckoutUrl(cart.checkoutUrl), lineId };
}

/**
 * Cria um carrinho temporário (NÃO afeta o carrinho persistente do usuário)
 * usado apenas pelo botão "Comprar Agora" para ir direto ao checkout.
 */
export async function createInstantCheckoutUrl(
  items: Array<{ variantId: string; quantity: number }>
): Promise<string | null> {
  const data = await storefrontApiRequest(CART_CREATE_MUTATION, {
    input: { lines: items.map(i => ({ quantity: i.quantity, merchandiseId: i.variantId })) },
  });
  if (data?.data?.cartCreate?.userErrors?.length > 0) {
    console.error('Instant checkout failed:', data.data.cartCreate.userErrors);
    return null;
  }
  const checkoutUrl = data?.data?.cartCreate?.cart?.checkoutUrl;
  return checkoutUrl ? formatCheckoutUrl(checkoutUrl) : null;
}

export async function addLineToShopifyCart(cartId: string, item: CartItem): Promise<{ success: boolean; lineId?: string; cartNotFound?: boolean }> {
  const data = await storefrontApiRequest(CART_LINES_ADD_MUTATION, {
    cartId,
    lines: [{ quantity: item.quantity, merchandiseId: item.variantId }],
  });

  const userErrors = data?.data?.cartLinesAdd?.userErrors || [];
  if (isCartNotFoundError(userErrors)) return { success: false, cartNotFound: true };
  if (userErrors.length > 0) return { success: false };

  const lines = data?.data?.cartLinesAdd?.cart?.lines?.edges || [];
  const newLine = lines.find((l: { node: { id: string; merchandise: { id: string } } }) => l.node.merchandise.id === item.variantId);
  return { success: true, lineId: newLine?.node?.id };
}

export async function updateShopifyCartLine(cartId: string, lineId: string, quantity: number): Promise<{ success: boolean; cartNotFound?: boolean }> {
  const data = await storefrontApiRequest(CART_LINES_UPDATE_MUTATION, {
    cartId,
    lines: [{ id: lineId, quantity }],
  });

  const userErrors = data?.data?.cartLinesUpdate?.userErrors || [];
  if (isCartNotFoundError(userErrors)) return { success: false, cartNotFound: true };
  if (userErrors.length > 0) return { success: false };
  return { success: true };
}

export async function removeLineFromShopifyCart(cartId: string, lineId: string): Promise<{ success: boolean; cartNotFound?: boolean }> {
  const data = await storefrontApiRequest(CART_LINES_REMOVE_MUTATION, {
    cartId,
    lineIds: [lineId],
  });

  const userErrors = data?.data?.cartLinesRemove?.userErrors || [];
  if (isCartNotFoundError(userErrors)) return { success: false, cartNotFound: true };
  if (userErrors.length > 0) {
    console.error('Failed to remove cart line:', userErrors);
    return { success: false };
  }
  return { success: true };
}

export async function findShopifyCartLine(
  cartId: string,
  variantId: string,
): Promise<{ lineId: string | null; cartNotFound: boolean } | null> {
  const data = await storefrontApiRequest(CART_QUERY, { id: cartId });
  if (!data) return null;

  const cart = data?.data?.cart;
  if (!cart) return { lineId: null, cartNotFound: true };

  const line = cart.lines?.edges?.find(
    (edge: { node: { merchandise?: { id?: string } } }) => edge.node.merchandise?.id === variantId,
  );
  return { lineId: line?.node?.id ?? null, cartNotFound: false };
}

export async function syncShopifyCart(cartId: string): Promise<boolean> {
  const data = await storefrontApiRequest(CART_QUERY, { id: cartId });
  if (!data) return true; // preserve on API error
  const cart = data?.data?.cart;
  return !!(cart && cart.totalQuantity > 0);
}
