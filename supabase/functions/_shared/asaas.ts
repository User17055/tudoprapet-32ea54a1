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
  installmentCount?: number;
  totalValue?: number;
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

export interface AsaasCardToken {
  creditCardToken: string;
  creditCardNumber?: string;
  creditCardBrand?: string;
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

// Teto de chamadas ao Asaas por execucao.
//
// Toda requisicao passa por `asaasRequest`, entao e aqui que da para contar
// tudo. Sem teto o consumo e emergente: depende de quantos gatilhos dispararam e
// de quantas linhas cada varredura encontrou, que foi como se chegou aos 30.000
// do bloqueio de 17/08/2026.
//
// O orcamento e um objeto criado por requisicao e passado explicitamente, e nao
// estado de modulo. Um isolate do Deno atende varias requisicoes e pode atender
// duas ao mesmo tempo: com contador global, a segunda execucao zeraria o
// contador da primeira no meio da varredura dela, e as duas juntas gastariam
// muito mais que o teto -- exatamente o que este mecanismo existe para impedir.
//
// A isencao existe -- o checkout cria a cobranca de um cliente real e nao pode
// ser recusado por causa de uma varredura de fundo -- mas ela e DECLARADA, e nao
// obtida por omissao. Ate 19/08/2026 o parametro era opcional, e `admin-orders`
// ganhou passe livre so por nao passar nada: o agente de impressao chamava
// `action=list` a cada 20s e cada chamada varria ate 100 cobrancas no Asaas.
// Foram ~216.000 requisicoes/12h e a cota da conta caiu de novo, dois dias
// depois do teto que so o worker tinha recebido.
//
// Por isso o parametro e obrigatorio: um call site novo nao compila sem dizer de
// que lado esta. Esquecer deixou de ser possivel; escolher errado ainda e, mas
// aparece na revisao como a palavra CUSTOMER_FACING escrita de proposito.
export const CUSTOMER_FACING = Symbol("asaas:cliente real esperando na tela");

export type AsaasCallBudget = AsaasBudget | typeof CUSTOMER_FACING;

export interface AsaasBudget {
  readonly limit: number;
  used: number;
}

export class AsaasBudgetExhausted extends Error {
  constructor(limit: number) {
    super(`Orcamento de ${limit} chamadas ao Asaas esgotado nesta execucao`);
    this.name = "AsaasBudgetExhausted";
  }
}

export function createAsaasBudget(limit: number): AsaasBudget {
  return { limit: Number.isFinite(limit) && limit > 0 ? limit : Number.POSITIVE_INFINITY, used: 0 };
}

export function asaasCallsUsed(budget: AsaasBudget): number {
  return budget.used;
}

export function isAsaasBudgetExhausted(budget: AsaasBudget): boolean {
  return budget.used >= budget.limit;
}

async function asaasRequest<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs: number,
  budget: AsaasCallBudget,
): Promise<T> {
  if (budget !== CUSTOMER_FACING) {
    if (budget.used >= budget.limit) throw new AsaasBudgetExhausted(budget.limit);
    // Conta antes de sair: uma requisicao que falha ou estoura o timeout ja
    // gastou a cota do lado do Asaas.
    budget.used++;
  }

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
      const resetHeader = response.headers.get("ratelimit-reset") || response.headers.get("retry-after");
      const resetSeconds = resetHeader ? Number(resetHeader) : NaN;
      const providerError = error as Error & { status?: number; retryAfterSeconds?: number };
      providerError.status = response.status;
      if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
        providerError.retryAfterSeconds = Math.ceil(resetSeconds);
      }
      throw error;
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function findOrCreateAsaasCustomer(
  input: AsaasCustomerInput,
  budget: AsaasCallBudget,
): Promise<string> {
  const query = new URLSearchParams({ externalReference: input.externalReference, limit: "1" });
  const existing = await asaasRequest<{ data?: Array<{ id?: string }> }>(
    `/customers?${query}`,
    {},
    12_000,
    budget,
  );
  const existingId = existing.data?.[0]?.id;
  if (existingId) {
    await asaasRequest(`/customers/${encodeURIComponent(existingId)}`, {
      method: "PUT",
      body: JSON.stringify({ ...input, notificationDisabled: true }),
    }, 12_000, budget);
    return existingId;
  }

  const created = await asaasRequest<{ id?: string }>("/customers", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      notificationDisabled: true,
    }),
  }, 12_000, budget);
  if (!created.id) throw new Error("Asaas não retornou o ID do cliente");
  return created.id;
}

export function createAsaasPayment(
  input: AsaasPaymentInput,
  budget: AsaasCallBudget,
): Promise<AsaasPayment> {
  return asaasRequest<AsaasPayment>("/payments", {
    method: "POST",
    body: JSON.stringify(input),
  }, input.billingType === "CREDIT_CARD" ? 65_000 : 12_000, budget);
}

export function tokenizeAsaasCreditCard(
  input: Pick<AsaasPaymentInput, "customer" | "creditCard" | "creditCardHolderInfo" | "remoteIp">,
  budget: AsaasCallBudget,
): Promise<AsaasCardToken> {
  return asaasRequest<AsaasCardToken>("/creditCard/tokenizeCreditCard", {
    method: "POST",
    body: JSON.stringify(input),
  }, 65_000, budget);
}

export async function findAsaasPaymentByExternalReference(
  reference: string,
  budget: AsaasCallBudget,
): Promise<AsaasPayment | null> {
  const query = new URLSearchParams({ externalReference: reference, limit: "1" });
  const result = await asaasRequest<{ data?: AsaasPayment[] }>(
    `/payments?${query}`,
    {},
    12_000,
    budget,
  );
  return result.data?.[0] ?? null;
}

export function getAsaasPayment(id: string, budget: AsaasCallBudget): Promise<AsaasPayment> {
  return asaasRequest<AsaasPayment>(`/payments/${encodeURIComponent(id)}`, {}, 12_000, budget);
}

export function getAsaasPixQrCode(id: string, budget: AsaasCallBudget): Promise<AsaasPixQrCode> {
  return asaasRequest<AsaasPixQrCode>(
    `/payments/${encodeURIComponent(id)}/pixQrCode`,
    {},
    12_000,
    budget,
  );
}

export function deleteAsaasPayment(
  id: string,
  budget: AsaasCallBudget,
): Promise<{ deleted: boolean; id: string }> {
  return asaasRequest<{ deleted: boolean; id: string }>(`/payments/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }, 12_000, budget);
}
