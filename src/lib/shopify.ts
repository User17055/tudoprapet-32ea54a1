import { toast } from "sonner";

const SHOPIFY_API_VERSION = '2025-07';
const SHOPIFY_STORE_PERMANENT_DOMAIN = 'petjoy-deals-hb8r9.myshopify.com';
const SHOPIFY_STOREFRONT_URL = `https://${SHOPIFY_STORE_PERMANENT_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`;
const SHOPIFY_STOREFRONT_TOKEN = '66b7b618d388aa97942b3ac0c15a2315';

export interface ShopifyProduct {
  node: {
    id: string;
    title: string;
    description: string;
    handle: string;
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

export const PRODUCTS_QUERY = `
  query GetProducts($first: Int!, $query: String) {
    products(first: $first, query: $query) {
      edges {
        node {
          id
          title
          description
          handle
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
    cart(id: $id) { id totalQuantity }
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
      cart { id }
      userErrors { field message }
    }
  }
`;

export async function applyDiscountToCart(cartId: string, discountCode: string): Promise<boolean> {
  try {
    const data = await storefrontApiRequest(CART_DISCOUNT_CODES_UPDATE_MUTATION, {
      cartId,
      discountCodes: [discountCode],
    });
    const userErrors = data?.data?.cartDiscountCodesUpdate?.userErrors || [];
    if (userErrors.length > 0) {
      console.error('Failed to apply discount:', userErrors);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Failed to apply discount code:', error);
    return false;
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
  if (userErrors.length > 0) return { success: false };
  return { success: true };
}

export async function syncShopifyCart(cartId: string): Promise<boolean> {
  const data = await storefrontApiRequest(CART_QUERY, { id: cartId });
  if (!data) return true; // preserve on API error
  const cart = data?.data?.cart;
  return !!(cart && cart.totalQuantity > 0);
}
