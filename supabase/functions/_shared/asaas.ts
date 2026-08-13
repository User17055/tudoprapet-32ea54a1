export interface AsaasCustomerInput {
  externalReference: string;
  name: string;
  cpfCnpj: string;
  email?: string;
  mobilePhone?: string;
  address?: string;
  addressNumber?: string;
  complement?: string;
  province?: string;
  postalCode?: string;
}

export interface AsaasPaymentInput {
  customer: string;
  billingType: "PIX" | "BOLETO" | "CREDIT_CARD" | "UNDEFINED";
  value: number;
  dueDate: string;
  description: string;
  externalReference: string;
  creditCardToken?: string;
  creditCard?: {
    holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string;
  };
  creditCardHolderInfo?: {
    name: string; email: string; cpfCnpj: string; postalCode: string;
    addressNumber: string; addressComplement?: string | null; phone?: string; mobilePhone: string;
  };
  remoteIp?: string;
}

export interface AsaasPayment {
  id: string;
  status: string;
  externalReference?: string | null;
  dueDate?: string | null;
  deleted?: boolean;
  creditCardToken?: string;
  creditCardNumber?: string;
  creditCardBrand?: string;
  invoiceUrl?: string;
  [key: string]: unknown;
}

export interface AsaasPixQrCode {
  encodedImage: string;
  payload: string;
  expirationDate: string;
}

function config() {
  const apiKey = Deno.env.get("ASAAS_API_KEY")?.trim();
  const baseUrl = (Deno.env.get("ASAAS_API_URL") || "https://api-sandbox.asaas.com/v3").replace(/\/$/, "");
  if (!apiKey) throw new Error("ASAAS_API_KEY ausente");
  return { apiKey, baseUrl };
}

async function asaasRequest<T>(path: string, init: RequestInit = {}, timeoutMs = 12_000): Promise<T> {
  const { apiKey, baseUrl } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "TudoPraPet-Checkout/1.0 (Supabase Edge Function)",
        access_token: apiKey,
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    let body: unknown = {};
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        if (response.ok) throw new Error("Asaas retornou uma resposta inválida");
        body = { message: text.slice(0, 300) };
      }
    }
    if (!response.ok) {
      const providerMessage = body && typeof body === "object" && "errors" in body
        ? JSON.stringify((body as { errors: unknown }).errors).slice(0, 1000)
        : "requisição rejeitada";
      const error = new Error(`Asaas ${response.status}: ${providerMessage}`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function findOrCreateAsaasCustomer(input: AsaasCustomerInput): Promise<string> {
  const query = new URLSearchParams({ externalReference: input.externalReference, limit: "1" });
  const existing = await asaasRequest<{ data?: Array<{ id?: string }> }>(`/customers?${query}`);
  const existingId = existing.data?.[0]?.id;
  if (existingId) {
    await asaasRequest(`/customers/${encodeURIComponent(existingId)}`, {
      method: "PUT",
      body: JSON.stringify({ ...input, notificationDisabled: true }),
    });
    return existingId;
  }

  const created = await asaasRequest<{ id?: string }>("/customers", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      notificationDisabled: true,
    }),
  });
  if (!created.id) throw new Error("Asaas não retornou o ID do cliente");
  return created.id;
}

export function createAsaasPayment(input: AsaasPaymentInput): Promise<AsaasPayment> {
  return asaasRequest<AsaasPayment>("/payments", {
    method: "POST",
    body: JSON.stringify(input),
  }, input.billingType === "CREDIT_CARD" ? 65_000 : 12_000);
}

export async function findAsaasPaymentByExternalReference(reference: string): Promise<AsaasPayment | null> {
  const query = new URLSearchParams({ externalReference: reference, limit: "1" });
  const result = await asaasRequest<{ data?: AsaasPayment[] }>(`/payments?${query}`);
  return result.data?.[0] ?? null;
}

export function getAsaasPayment(id: string): Promise<AsaasPayment> {
  return asaasRequest<AsaasPayment>(`/payments/${encodeURIComponent(id)}`);
}

export function getAsaasPixQrCode(id: string): Promise<AsaasPixQrCode> {
  return asaasRequest<AsaasPixQrCode>(`/payments/${encodeURIComponent(id)}/pixQrCode`);
}

export function deleteAsaasPayment(id: string): Promise<{ deleted: boolean; id: string }> {
  return asaasRequest<{ deleted: boolean; id: string }>(`/payments/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
