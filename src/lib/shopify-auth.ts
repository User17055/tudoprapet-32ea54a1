import { storefrontApiRequest } from './shopify';

// --- Mutations ---

const CUSTOMER_CREATE_MUTATION = `
  mutation customerCreate($input: CustomerCreateInput!) {
    customerCreate(input: $input) {
      customer { id firstName lastName email }
      customerUserErrors { field message code }
    }
  }
`;

const CUSTOMER_ACCESS_TOKEN_CREATE = `
  mutation customerAccessTokenCreate($input: CustomerAccessTokenCreateInput!) {
    customerAccessTokenCreate(input: $input) {
      customerAccessToken { accessToken expiresAt }
      customerUserErrors { field message code }
    }
  }
`;

const CUSTOMER_ACCESS_TOKEN_DELETE = `
  mutation customerAccessTokenDelete($customerAccessToken: String!) {
    customerAccessTokenDelete(customerAccessToken: $customerAccessToken) {
      deletedAccessToken
      userErrors { field message }
    }
  }
`;

const CUSTOMER_QUERY = `
  query customer($customerAccessToken: String!) {
    customer(customerAccessToken: $customerAccessToken) {
      id
      firstName
      lastName
      email
      phone
    }
  }
`;

// --- Types ---

export interface ShopifyCustomer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
}

// --- Functions ---

export async function shopifyRegister(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const data = await storefrontApiRequest(CUSTOMER_CREATE_MUTATION, { input });
    const errors = data?.data?.customerCreate?.customerUserErrors || [];
    if (errors.length > 0) {
      return { success: false, error: errors.map((e: { message: string }) => e.message).join(', ') };
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao criar conta.';
    return { success: false, error: message };
  }
}

export async function shopifyLogin(email: string, password: string): Promise<{ token: string; expiresAt: string } | { error: string }> {
  try {
    const data = await storefrontApiRequest(CUSTOMER_ACCESS_TOKEN_CREATE, {
      input: { email, password },
    });
    const errors = data?.data?.customerAccessTokenCreate?.customerUserErrors || [];
    if (errors.length > 0) {
      return { error: errors.map((e: { message: string }) => e.message).join(', ') };
    }
    const tokenData = data?.data?.customerAccessTokenCreate?.customerAccessToken;
    if (!tokenData) return { error: 'Não foi possível fazer login.' };
    return { token: tokenData.accessToken, expiresAt: tokenData.expiresAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao fazer login.';
    return { error: message };
  }
}

export async function shopifyLogout(token: string): Promise<void> {
  await storefrontApiRequest(CUSTOMER_ACCESS_TOKEN_DELETE, { customerAccessToken: token });
}

export async function shopifyGetCustomer(token: string): Promise<ShopifyCustomer | null> {
  const data = await storefrontApiRequest(CUSTOMER_QUERY, { customerAccessToken: token });
  return data?.data?.customer || null;
}
