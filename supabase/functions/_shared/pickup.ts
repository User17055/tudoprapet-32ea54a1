// Constantes e helpers do fluxo de retirada na loja.
// Compartilhado por shopify-pickup-webhook e pickup-resend-last.

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
