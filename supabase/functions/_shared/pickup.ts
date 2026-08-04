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
