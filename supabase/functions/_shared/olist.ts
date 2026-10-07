export const OLIST_PRODUCTS_SEARCH_URL = "https://api.tiny.com.br/api2/produtos.pesquisa.php";
export const OLIST_ORDER_CREATE_URL = "https://api.tiny.com.br/api2/pedido.incluir.php";
export const OLIST_ORDER_SEARCH_URL = "https://api.tiny.com.br/api2/pedidos.pesquisa.php";
export const OLIST_RECEIVABLE_CREATE_URL = "https://api.tiny.com.br/api2/conta.receber.incluir.php";
export const OLIST_RECEIVABLE_SEARCH_URL =
  "https://api.tiny.com.br/api2/contas.receber.pesquisa.php";
export const OLIST_RECEIVABLE_GET_URL = "https://api.tiny.com.br/api2/conta.receber.obter.php";
export const OLIST_ORDER_GET_URL = "https://api.tiny.com.br/api2/pedido.obter.php";
export const OLIST_INVOICE_GENERATE_URL =
  "https://api.tiny.com.br/api2/gerar.nota.fiscal.pedido.php";
export const OLIST_INVOICE_GET_URL = "https://api.tiny.com.br/api2/nota.fiscal.obter.php";
export const OLIST_INVOICE_LINK_URL = "https://api.tiny.com.br/api2/nota.fiscal.obter.link.php";
export const OLIST_INVOICE_ISSUE_URL = "https://api.tiny.com.br/api2/nota.fiscal.emitir.php";
export const OLIST_ORDER_LAUNCH_RECEIVABLES_URL =
  "https://api.tiny.com.br/api2/pedido.lancar.contas.php";
export const OLIST_RECEIVABLE_SETTLE_URL = "https://api.tiny.com.br/api2/conta.receber.baixar.php";

export interface OlistCost {
  id: string;
  sku: string;
  name: string;
  cost: number;
}

export interface OlistFranchiseCustomer {
  name: string;
  tradeName?: string;
  stateRegistration?: string;
  cpfCnpj: string;
  email: string;
  phone: string;
  address: string;
  number: string;
  complement?: string;
  neighborhood: string;
  postalCode: string;
  city: string;
  state: string;
}

export interface OlistFranchiseOrderItem {
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface OlistFranchiseOrderInput {
  externalReference: string;
  customer: OlistFranchiseCustomer;
  deliveryAddress?: OlistFranchiseCustomer;
  items: OlistFranchiseOrderItem[];
  shippingAmount: number;
  serviceFee: number;
  total: number;
  dueDate: string;
  shippingMethod?: string;
  paymentMethod?: string;
  paymentHolder?: string;
  invoicePurpose?: "resale" | "final_consumption";
  natureOperationId?: string;
}

export interface OlistCreatedOrder {
  id: string;
  number: string;
}

export interface OlistImportedOrder extends OlistCreatedOrder {
  externalReference: string;
}

export interface OlistReceivable {
  id: string;
  status: "aberto" | "pago" | "cancelado" | "cancelada" | "parcial" | string;
  documentNumber?: string;
  dueDate?: string;
  amount?: number;
  balance?: number;
  boletoUrl?: string | null;
}

export interface OlistInvoice {
  id: string;
  number: string;
  series?: string;
  issued: boolean;
  accessKey?: string | null;
  accessUrl?: string | null;
}

type OlistProduct = {
  id?: string | number;
  codigo?: string | number;
  nome?: string;
  preco_custo?: string | number;
};

type OlistSearchResponse = {
  retorno?: {
    status?: string;
    codigo_erro?: number;
    erros?: Array<{ erro?: string }>;
    produtos?: Array<{ produto?: OlistProduct }>;
  };
};

export function normalizeSku(value: unknown): string {
  return String(value ?? "").trim().toLocaleUpperCase("pt-BR");
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function subscriberPriceFromCost(cost: number): number {
  return roundMoney(cost * 1.05);
}

export function normalizeOlistId(value: unknown): string | null {
  const id = String(value ?? "").trim();
  return !id || /^0+$/.test(id) ? null : id;
}

export function normalizedExternalOrderReferences(value: unknown): string[] {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return [];
  const withoutHash = raw.replace(/^#+/, "");
  return [...new Set([raw, withoutHash].filter(Boolean))];
}

export function olistExternalReferenceMatches(
  externalReference: unknown,
  references: unknown[],
): boolean {
  const external = new Set(normalizedExternalOrderReferences(externalReference));
  return references.some((reference) =>
    normalizedExternalOrderReferences(reference).some((candidate) => external.has(candidate))
  );
}

function truncate(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

export function toOlistDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(`${value}T12:00:00-03:00`);
  if (Number.isNaN(date.getTime())) throw new Error("Data inválida para a Olist");
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function olistCustomer(customer: OlistFranchiseCustomer): Record<string, unknown> {
  return {
    nome: truncate(customer.name, 50),
    ...(customer.tradeName ? { nome_fantasia: truncate(customer.tradeName, 50) } : {}),
    tipo_pessoa: customer.cpfCnpj.replace(/\D/g, "").length === 14 ? "J" : "F",
    cpf_cnpj: customer.cpfCnpj.replace(/\D/g, ""),
    ...(customer.stateRegistration
      ? { ie: customer.stateRegistration.replace(/\D/g, "").slice(0, 14) }
      : {}),
    endereco: truncate(customer.address, 50),
    numero: truncate(customer.number, 10),
    complemento: truncate(customer.complement, 50),
    bairro: truncate(customer.neighborhood, 30),
    cep: customer.postalCode.replace(/\D/g, "").slice(0, 8),
    cidade: truncate(customer.city, 30),
    uf: truncate(customer.state, 2).toUpperCase(),
    fone: truncate(customer.phone, 40),
    email: truncate(customer.email, 50),
    atualizar_cliente: "S",
  };
}

function olistDeliveryAddress(customer: OlistFranchiseCustomer): Record<string, unknown> {
  return {
    tipo_pessoa: customer.cpfCnpj.replace(/\D/g, "").length === 14 ? "J" : "F",
    cpf_cnpj: customer.cpfCnpj.replace(/\D/g, ""),
    ...(customer.stateRegistration
      ? { ie: customer.stateRegistration.replace(/\D/g, "").slice(0, 14) }
      : {}),
    endereco: truncate(customer.address, 50),
    numero: truncate(customer.number, 10),
    complemento: truncate(customer.complement, 50),
    bairro: truncate(customer.neighborhood, 30),
    cep: customer.postalCode.replace(/\D/g, "").slice(0, 8),
    cidade: truncate(customer.city, 30),
    uf: truncate(customer.state, 2).toUpperCase(),
    fone: truncate(customer.phone, 40),
    nome_destinatario: truncate(customer.name, 60),
  };
}

export function buildOlistFranchiseOrder(input: OlistFranchiseOrderInput): Record<string, unknown> {
  if (!input.items.length) throw new Error("Pedido da Olist sem itens");
  return {
    pedido: {
      data_pedido: toOlistDate(new Date()),
      cliente: olistCustomer(input.customer),
      ...(input.deliveryAddress
        ? {
          endereco_entrega: olistDeliveryAddress(input.deliveryAddress),
        }
        : {}),
      itens: input.items.map((entry) => ({
        item: {
          ...(entry.sku ? { codigo: truncate(entry.sku, 60) } : {}),
          descricao: truncate(entry.description, 120),
          unidade: "UN",
          quantidade: entry.quantity,
          valor_unitario: roundMoney(entry.unitPrice),
        },
      })),
      valor_frete: roundMoney(input.shippingAmount),
      outras_despesas: roundMoney(input.serviceFee),
      forma_frete: truncate(input.shippingMethod, 30),
      ...(input.paymentMethod ? { forma_pagamento: truncate(input.paymentMethod, 30) } : {}),
      ...(input.natureOperationId
        ? { id_natureza_operacao: truncate(input.natureOperationId, 30) }
        : {}),
      parcelas: [{
        parcela: {
          data: toOlistDate(input.dueDate),
          valor: roundMoney(input.total),
          destino: "Contas a Receber",
          ...(input.paymentMethod ? { forma_pagamento: truncate(input.paymentMethod, 30) } : {}),
        },
      }],
      situacao: "aprovado",
      numero_pedido_ecommerce: truncate(input.externalReference, 50),
      ecommerce: "TudoPraPet",
      obs: truncate(
        `Pedido de franquia TudoPraPet ${input.externalReference} - NF-e: ${
          input.invoicePurpose === "final_consumption" ? "consumo final" : "revenda"
        }`,
        100,
      ),
      obs_internas: truncate(
        `Taxa operacional R$ ${roundMoney(input.serviceFee).toFixed(2)} - Finalidade: ${
          input.invoicePurpose === "final_consumption" ? "consumo final" : "revenda"
        }`,
        100,
      ),
    },
  };
}

export function buildOlistReceivable(
  input: OlistFranchiseOrderInput,
  documentNumber: string,
): Record<string, unknown> {
  return {
    conta: {
      data: toOlistDate(new Date()),
      vencimento: toOlistDate(input.dueDate),
      valor: roundMoney(input.total),
      nro_documento: truncate(documentNumber, 9),
      cliente: olistCustomer(input.customer),
      historico: truncate(`Pedido de franquia TudoPraPet ${input.externalReference}`, 300),
      ...(input.paymentMethod ? { forma_pagamento: truncate(input.paymentMethod, 30) } : {}),
      ...(input.paymentHolder ? { portador: truncate(input.paymentHolder, 100) } : {}),
      ocorrencia: "U",
    },
  };
}

function responseErrors(payload: any): string {
  const root = payload?.retorno ?? {};
  const direct = (root.erros ?? []).map((entry: any) => entry?.erro).filter(Boolean);
  const rawRecords = root.registros
    ? (Array.isArray(root.registros) ? root.registros : [root.registros])
    : [];
  const records = rawRecords.flatMap((entry: any) => {
    const record = entry?.registro ?? entry;
    return (record?.erros ?? []).map((error: any) => error?.erro).filter(Boolean);
  });
  return [...direct, ...records].join("; ") || "A Olist recusou a operação";
}

async function olistPost(url: string, token: string, fields: Record<string, string>): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ token, formato: "JSON", ...fields }),
  });
  if (!response.ok) throw new Error(`Olist respondeu HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.retorno?.status === "Erro" && Number(payload?.retorno?.codigo_erro) !== 20) {
    throw new Error(responseErrors(payload));
  }
  return payload;
}

function firstRecord(payload: any): any {
  const records = payload?.retorno?.registros;
  const entry = Array.isArray(records) ? records[0] : records;
  return entry?.registro ?? entry ?? null;
}

export async function createOlistFranchiseOrder(
  input: OlistFranchiseOrderInput,
  token: string,
): Promise<OlistCreatedOrder> {
  const existing = await findOlistOrderByExternalReference(input.externalReference, token);
  if (existing) return existing;
  let payload: any;
  try {
    payload = await olistPost(OLIST_ORDER_CREATE_URL, token, {
      pedido: JSON.stringify(buildOlistFranchiseOrder(input)),
    });
  } catch (error) {
    const recovered = await findOlistOrderByExternalReference(input.externalReference, token);
    if (recovered) return recovered;
    throw error;
  }
  const record = firstRecord(payload);
  if (!record?.id) throw new Error(responseErrors(payload));
  return { id: String(record.id), number: String(record.numero ?? record.id) };
}

export async function findOlistOrderByExternalReference(
  externalReference: string,
  token: string,
): Promise<OlistCreatedOrder | null> {
  const todayDate = new Date();
  const yesterdayDate = new Date(todayDate);
  yesterdayDate.setDate(todayDate.getDate() - 1);
  const today = toOlistDate(todayDate);
  const payload = await olistPost(OLIST_ORDER_SEARCH_URL, token, {
    dataInicial: toOlistDate(yesterdayDate),
    dataFinal: today,
  });
  if (Number(payload?.retorno?.codigo_erro) === 20) return null;
  for (const entry of payload?.retorno?.pedidos ?? []) {
    const order = entry?.pedido ?? entry;
    if (String(order?.numero_ecommerce || "") !== externalReference) continue;
    if (!order?.id) continue;
    return { id: String(order.id), number: String(order.numero ?? order.id) };
  }
  return null;
}

/**
 * Localiza pedidos que a integração Shopify já importou no ERP. Uma única
 * varredura atende vários checkouts e evita uma chamada Olist por pedido.
 */
export async function findImportedOlistOrders(
  references: unknown[],
  token: string,
  lookbackDays = 14,
): Promise<OlistImportedOrder[]> {
  const wanted = references.flatMap(normalizedExternalOrderReferences);
  if (!wanted.length) return [];
  const todayDate = new Date();
  const initialDate = new Date(todayDate);
  initialDate.setDate(todayDate.getDate() - Math.max(1, lookbackDays));
  const found = new Map<string, OlistImportedOrder>();

  // A API pagina a pesquisa. Cinco páginas cobrem o volume normal sem deixar
  // uma conta com histórico grande transformar o cron em uma varredura infinita.
  for (let page = 1; page <= 5; page++) {
    const payload = await olistPost(OLIST_ORDER_SEARCH_URL, token, {
      dataInicial: toOlistDate(initialDate),
      dataFinal: toOlistDate(todayDate),
      pagina: String(page),
    });
    if (Number(payload?.retorno?.codigo_erro) === 20) break;
    const orders = payload?.retorno?.pedidos ?? [];
    for (const entry of orders) {
      const order = entry?.pedido ?? entry;
      const externalReference = String(order?.numero_ecommerce || "").trim();
      if (!order?.id || !olistExternalReferenceMatches(externalReference, wanted)) continue;
      found.set(String(order.id), {
        id: String(order.id),
        number: String(order.numero ?? order.id),
        externalReference,
      });
    }
    const totalPages = Number(payload?.retorno?.numero_paginas || 1);
    if (!orders.length || !Number.isFinite(totalPages) || page >= totalPages) break;
  }
  return [...found.values()];
}

export async function findOlistReceivableByDocument(
  documentNumber: string,
  token: string,
): Promise<OlistReceivable | null> {
  const payload = await olistPost(OLIST_RECEIVABLE_SEARCH_URL, token, {
    numero_doc: documentNumber,
  });
  if (Number(payload?.retorno?.codigo_erro) === 20) return null;
  const entry = payload?.retorno?.contas?.[0];
  const account = entry?.conta ?? entry;
  if (!account?.id) return null;
  return {
    id: String(account.id),
    status: String(account.situacao || "aberto").toLowerCase(),
    documentNumber: String(account.numero_doc || documentNumber),
    dueDate: account.data_vencimento ? String(account.data_vencimento) : undefined,
    amount: Number(account.valor),
    balance: Number(account.saldo),
  };
}

export async function createOlistReceivable(
  input: OlistFranchiseOrderInput,
  documentNumber: string,
  token: string,
): Promise<OlistReceivable> {
  const existing = await findOlistReceivableByDocument(documentNumber, token);
  if (existing) return existing;
  const payload = await olistPost(OLIST_RECEIVABLE_CREATE_URL, token, {
    conta: JSON.stringify(buildOlistReceivable(input, documentNumber)),
  });
  const record = firstRecord(payload);
  if (!record?.id) throw new Error(responseErrors(payload));
  return { id: String(record.id), status: "aberto", documentNumber };
}

export async function findOlistReceivableByOrder(
  orderId: string,
  token: string,
): Promise<OlistReceivable | null> {
  const payload = await olistPost(OLIST_RECEIVABLE_SEARCH_URL, token, { id_origem: orderId });
  if (Number(payload?.retorno?.codigo_erro) === 20) return null;
  const entry = payload?.retorno?.contas?.[0];
  const account = entry?.conta ?? entry;
  if (!account?.id) return null;
  return {
    id: String(account.id),
    status: String(account.situacao || "aberto").toLowerCase(),
    documentNumber: account.numero_doc ? String(account.numero_doc) : undefined,
    dueDate: account.data_vencimento ? String(account.data_vencimento) : undefined,
    amount: Number(account.valor),
    balance: Number(account.saldo),
  };
}

export async function ensureOlistOrderReceivable(
  orderId: string,
  token: string,
): Promise<OlistReceivable> {
  const existing = await findOlistReceivableByOrder(orderId, token);
  if (existing) return existing;
  await olistPost(OLIST_ORDER_LAUNCH_RECEIVABLES_URL, token, { id: orderId });
  const created = await findOlistReceivableByOrder(orderId, token);
  if (!created) throw new Error("A Olist não devolveu a conta a receber do pedido");
  return created;
}

export async function getOlistReceivable(id: string, token: string): Promise<OlistReceivable> {
  const payload = await olistPost(OLIST_RECEIVABLE_GET_URL, token, {
    id,
    obter_link_boleto: "S",
  });
  const account = payload?.retorno?.conta;
  if (!account?.id) throw new Error(responseErrors(payload));
  return {
    id: String(account.id),
    status: String(account.situacao || "aberto").toLowerCase(),
    documentNumber: account.nro_documento ? String(account.nro_documento) : undefined,
    dueDate: account.vencimento ? String(account.vencimento) : undefined,
    amount: Number(account.valor),
    balance: Number(account.saldo),
    boletoUrl: typeof account.link_boleto === "string" ? account.link_boleto : null,
  };
}

export async function settleOlistReceivable(
  id: string,
  token: string,
  input: {
    paidAt: Date;
    amount: number;
    destinationAccount?: string;
    history?: string;
  },
): Promise<void> {
  const current = await getOlistReceivable(id, token);
  if (current.status.toLowerCase() === "pago") return;
  if (["cancelado", "cancelada"].includes(current.status.toLowerCase())) {
    throw new Error("A conta a receber da Olist está cancelada");
  }
  const account = {
    id,
    data: toOlistDate(input.paidAt),
    valorPago: roundMoney(input.amount),
    ...(input.destinationAccount
      ? { contaDestino: truncate(input.destinationAccount, 100) }
      : {}),
    ...(input.history ? { historico: truncate(input.history, 300) } : {}),
  };
  try {
    const payload = await olistPost(OLIST_RECEIVABLE_SETTLE_URL, token, {
      conta: JSON.stringify({ conta: account }),
    });
    const record = firstRecord(payload);
    if (record?.status && String(record.status).toLowerCase() !== "ok") {
      throw new Error(responseErrors(payload));
    }
  } catch (error) {
    // Duas execuções podem observar "aberto" quase juntas. A segunda recebe
    // este retorno da Olist; financeiramente o resultado desejado já ocorreu.
    if (/j[aá] foi paga/i.test(error instanceof Error ? error.message : String(error))) return;
    throw error;
  }
}

export async function getOlistOrderInvoiceId(
  orderId: string,
  token: string,
): Promise<string | null> {
  const payload = await olistPost(OLIST_ORDER_GET_URL, token, { id: orderId });
  // A Olist devolve "0" quando o pedido ainda nao tem nota; nao e um ID valido.
  const invoiceId = payload?.retorno?.pedido?.id_nota_fiscal;
  return normalizeOlistId(invoiceId);
}

export async function getOlistInvoice(id: string, token: string): Promise<OlistInvoice> {
  const payload = await olistPost(OLIST_INVOICE_GET_URL, token, { id });
  const invoice = payload?.retorno?.nota_fiscal;
  if (!invoice?.id) throw new Error(responseErrors(payload));
  const accessKey = invoice.chave_acesso ? String(invoice.chave_acesso) : null;
  const issued = Boolean(accessKey) || /autorizad|emitid/i.test(String(invoice.situacao || ""));
  let accessUrl = invoice.link_acesso ? String(invoice.link_acesso) : null;
  if (!accessUrl && issued) {
    // nota.fiscal.obter nao traz o link; a API tem um endpoint proprio para ele.
    try {
      const linkPayload = await olistPost(OLIST_INVOICE_LINK_URL, token, { id: String(invoice.id) });
      const link = linkPayload?.retorno?.link_nfe;
      if (typeof link === "string" && /^https?:\/\//.test(link)) accessUrl = link;
    } catch (error) {
      console.error("olist invoice link:", error);
    }
  }
  return {
    id: String(invoice.id),
    number: String(invoice.numero ?? ""),
    series: invoice.serie !== undefined ? String(invoice.serie) : undefined,
    issued,
    accessKey,
    accessUrl,
  };
}

export async function generateOlistInvoice(orderId: string, token: string): Promise<OlistInvoice> {
  const existingId = await getOlistOrderInvoiceId(orderId, token);
  if (existingId) return await getOlistInvoice(existingId, token);
  const payload = await olistPost(OLIST_INVOICE_GENERATE_URL, token, {
    id: orderId,
    modelo: "NFe",
  });
  const record = firstRecord(payload);
  if (!record?.idNotaFiscal) throw new Error(responseErrors(payload));
  return {
    id: String(record.idNotaFiscal),
    number: String(record.numero ?? ""),
    series: record.serie !== undefined ? String(record.serie) : undefined,
    issued: false,
  };
}

export async function issueOlistInvoice(
  invoice: OlistInvoice,
  token: string,
): Promise<OlistInvoice> {
  const current = await getOlistInvoice(invoice.id, token);
  if (current.issued) return current;
  const payload = await olistPost(OLIST_INVOICE_ISSUE_URL, token, {
    id: invoice.id,
    enviarEmail: "S",
  });
  const issued = payload?.retorno?.nota_fiscal;
  if (!issued && payload?.retorno?.status !== "OK") throw new Error(responseErrors(payload));
  const confirmed = await getOlistInvoice(String(issued?.id ?? invoice.id), token);
  // A autorizacao da SEFAZ e assincrona. Quando a Olist aceitou a emissao, a
  // nota pode continuar pendente por algum tempo; isso nao deve impedir que o
  // rascunho seja concluido como pedido na Shopify. Falhas reais da chamada de
  // emissao continuam sendo lancadas acima por `olistPost`.
  return confirmed;
}

export function findExactOlistCost(
  payload: OlistSearchResponse,
  requestedSku: string,
): OlistCost | null {
  const sku = normalizeSku(requestedSku);
  const products = payload.retorno?.produtos ?? [];
  const product = products
    .map((entry) => entry.produto)
    .find((candidate) => normalizeSku(candidate?.codigo) === sku);
  if (!product) return null;

  const cost = Number(product.preco_custo);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  return {
    id: String(product.id ?? ""),
    sku: String(product.codigo ?? "").trim(),
    name: String(product.nome ?? "").trim(),
    cost: roundMoney(cost),
  };
}

export async function fetchOlistCostBySku(sku: string, token: string): Promise<OlistCost | null> {
  const body = new URLSearchParams({ token, pesquisa: sku.trim(), formato: "JSON" });
  const response = await fetch(OLIST_PRODUCTS_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
  });
  if (!response.ok) throw new Error(`Olist respondeu HTTP ${response.status}`);

  const payload = await response.json() as OlistSearchResponse;
  if (payload.retorno?.status === "Erro") {
    // A API usa o erro 20 tambem quando a pesquisa simplesmente nao encontra o SKU.
    if (payload.retorno.codigo_erro === 20) return null;
    const detail = payload.retorno.erros?.map((entry) => entry.erro).filter(Boolean).join("; ");
    throw new Error(detail || "A Olist recusou a consulta");
  }
  return findExactOlistCost(payload, sku);
}
