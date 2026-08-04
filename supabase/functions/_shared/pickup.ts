// Constantes e regras do fluxo de retirada na loja.
// Compartilhado por shopify-pickup-webhook e pickup-resend-last.
//
// As funções aqui são puras (sem Deno, sem fetch) para poderem ser testadas
// pelo vitest — ver src/test/pickupWebhook.test.ts.

export const STORE_NAME = "TudoPraPet";
export const PICKUP_HOURS = "segunda a sexta, das 9h às 18h, e aos sábados até 12h";

/**
 * Normaliza telefone para o formato esperado pela API de WhatsApp:
 * só dígitos, com DDI 55 na frente. Devolve null quando não há dígito algum.
 */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  return digits.startsWith("55") ? digits : `55${digits}`;
}

export type PickupEvent = "order_ready_for_pickup" | "order_created" | null;

/**
 * Tópicos que representam "pedido pronto para retirada".
 *
 * `fulfillments/update` foi deliberadamente deixado de fora: atualizar um
 * fulfillment que já existe (incluir rastreio, corrigir um dado) não é um novo
 * evento de "pronto" — era uma das fontes de mensagem duplicada.
 */
const READY_TOPICS = new Set([
  "fulfillment_orders/ready_to_pickup",
  "fulfillment_orders/line_items_prepared_for_pickup",
  "fulfillments/create",
]);

export interface WebhookSignals {
  fulfillmentStatus?: string | null;
  tags?: string | null;
}

/**
 * Classifica o webhook da Shopify em um evento de negócio, ou null quando o
 * evento não interessa. A precedência de "pronto" sobre "criado" é a mesma de
 * antes: um pedido criado já marcado como pronto conta como pronto.
 */
export function classifyWebhookEvent(topic: string, signals: WebhookSignals = {}): PickupEvent {
  const status = String(signals.fulfillmentStatus ?? "").toLowerCase();
  const tags = String(signals.tags ?? "").toLowerCase();

  const isReady =
    READY_TOPICS.has(topic) ||
    status === "ready_for_pickup" ||
    tags.includes("pronto-retirada") ||
    tags.includes("ready-for-pickup");

  if (isReady) return "order_ready_for_pickup";
  if (topic === "orders/create") return "order_created";
  return null;
}

/** true quando o método de entrega da Shopify é retirada na loja. */
export function isPickupMethod(methodType: string | null | undefined): boolean {
  return String(methodType ?? "").toLowerCase() === "pick_up";
}

/**
 * Chave estável por (evento, pedido). Os três tópicos que viram
 * `order_ready_for_pickup` produzem a MESMA chave, então a API externa
 * consegue descartar a repetição — inclusive as retentativas da Shopify.
 */
export function buildIdempotencyKey(event: string, orderId: string): string {
  return `${event}:${orderId.replace(/\D/g, "")}`;
}

/**
 * Decide se o código devolvido pela API externa deve ser gravado no pedido.
 *
 * Para `order_ready_for_pickup` o filtro de retirada já rodou antes do envio
 * (pedido de entrega nem chega aqui), então gravamos sempre. Para os demais
 * eventos — hoje só `order_created`, que dispara para TODO pedido — só gravamos
 * com método de entrega comprovadamente `pick_up`. Método indeterminado NÃO
 * grava: um código de retirada no e-mail de um cliente de entrega é pior do que
 * o código chegar apenas no evento de "pronto", que grava de novo.
 */
export function shouldSavePickupCode(
  event: PickupEvent,
  methodType: string | null | undefined,
): boolean {
  if (event === "order_ready_for_pickup") return true;
  return isPickupMethod(methodType);
}

export interface NoteAttribute {
  name: string;
  value: string;
}

/** Nome do atributo no pedido. O template de e-mail da Shopify lê exatamente isto. */
export const PICKUP_CODE_ATTRIBUTE = "Codigo de retirada";

/**
 * Lê o código de retirada da resposta da API externa.
 *
 * Os três nomes de campo aceitos são uma herança: não há documentação do
 * contrato da API externa deste lado, então a implementação original tentava
 * `pickup_code`, `code` e `data.pickup_code`. Mantido como estava para não
 * quebrar, mas o certo é fixar o contrato com quem mantém a API.
 */
export function extractPickupCode(responseText: string): string | null {
  try {
    const parsed = JSON.parse(responseText);
    const code = parsed?.pickup_code ?? parsed?.code ?? parsed?.data?.pickup_code ?? null;
    if (code === null || code === undefined || code === "") return null;
    return String(code);
  } catch {
    return null;
  }
}

/**
 * Monta a lista de note_attributes preservando o que já existia.
 *
 * O PUT de note_attributes na Admin API **substitui o array inteiro**. Escrever
 * só `[{ codigo }]` apaga qualquer outro atributo do pedido (observação de
 * presente, dado vindo do checkout, atributo posto por app). Esta função
 * mantém os demais e sobrescreve apenas o de mesmo nome.
 */
export function mergeNoteAttributes(
  existing: NoteAttribute[] | null | undefined,
  name: string,
  value: string,
): NoteAttribute[] {
  const kept = (existing ?? []).filter((attr) => attr?.name !== name);
  return [...kept, { name, value }];
}
