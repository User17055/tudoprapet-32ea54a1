// Texto do botão de pagamento da franquia enquanto o boleto não tem link.

// Depois disso o boleto pendente deixa de ser "em geração" e passa ao financeiro.
const RECEIVABLE_REVIEW_AFTER_MS = 60 * 60_000;

export function pendingPaymentLabel(
  payment: { receivablePending?: boolean; createdAt: string },
  now = Date.now(),
): string {
  if (!payment.receivablePending) return "Link sendo gerado";
  return now - Date.parse(payment.createdAt) > RECEIVABLE_REVIEW_AFTER_MS
    ? "Boleto em análise pelo financeiro"
    : "Boleto em geração";
}
