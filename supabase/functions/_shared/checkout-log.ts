export interface CheckoutAttemptLog {
  checkoutSessionId?: string | null;
  userId?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  paymentMethod?: "pix" | "credit_card" | "debit_card" | "terms" | "unknown";
  stage: "prepare" | "payment" | "shopify_completion";
  success: boolean;
  errorMessage?: string | null;
  providerPaymentId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Detalhe a registrar quando o pedido foi concluido mas a credencial fiscal
 * brasileira nao gravou na Shopify.
 *
 * Nao e falha de venda: o pedido existe, foi pago, e o CPF/CNPJ continua nos
 * atributos. E um registro de rastreio -- ate 31/08/2026 esse caso so virava
 * console.warn, e os logs de edge function do projeto tem retencao curta, o
 * que fazia a busca devolver zero tanto na ausencia quanto na presenca do
 * problema. Sem isto nao ha como cruzar essas conclusoes com os pedidos que o
 * Mintegra recusa por "CPF ou CNPJ invalido".
 */
export function taxCredentialGapMessage(error?: string | null): string {
  return `Pedido concluido, mas a credencial fiscal (CPF/CNPJ) nao gravou na Shopify: ${error || "motivo nao informado"}`;
}

/** Registro operacional sem dados sensiveis de cartao. Falha de log nunca derruba o checkout. */
export async function writeCheckoutAttemptLog(admin: any, value: CheckoutAttemptLog): Promise<void> {
  try {
    const { error } = await admin.from("checkout_attempt_logs").insert({
      checkout_session_id: value.checkoutSessionId || null,
      user_id: value.userId || null,
      customer_name: String(value.customerName || "").trim().slice(0, 160) || null,
      customer_email: String(value.customerEmail || "").trim().toLowerCase().slice(0, 254) || null,
      payment_method: value.paymentMethod || "unknown",
      stage: value.stage,
      success: value.success,
      error_message: value.errorMessage ? String(value.errorMessage).slice(0, 500) : null,
      provider_payment_id: value.providerPaymentId ? String(value.providerPaymentId).slice(0, 120) : null,
      metadata: value.metadata || {},
    });
    if (error) console.error("Falha ao registrar tentativa de checkout:", error.message);
  } catch (error) {
    console.error("Falha inesperada no log de checkout:", error);
  }
}
