export interface CustomerOrderVisibilityInput {
  financialStatus: string;
  cancelled: boolean;
  linkedCustomerType?: string | null;
  linkedSessionStatus?: string | null;
}

export function shouldShowCustomerOrder(input: CustomerOrderVisibilityInput): boolean {
  if (input.cancelled) return false;
  const financialStatus = input.financialStatus.toLowerCase();
  if (["paid", "partially_paid"].includes(financialStatus)) return true;

  // Pedidos de franquia sao concluidos na Shopify com pagamento pendente,
  // porque o pagamento ocorre no prazo comercial. So exibimos esse estado
  // quando a sessao pertence ao usuario e o credito ja foi aprovado.
  return input.linkedCustomerType === "franchise" &&
    input.linkedSessionStatus === "credit_approved" &&
    ["pending", "authorized"].includes(financialStatus);
}
