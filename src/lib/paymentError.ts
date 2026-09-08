/** Impede que respostas internas do Asaas apareçam para o cliente. */
export function customerPaymentError(detail: string): string {
  const message = String(detail || "").trim();
  if (/invalid_creditcard/i.test(message)) {
    return "O banco não autorizou esta compra. Confira os dados, tente outro cartão ou escolha Pix ou débito.";
  }
  if (/Asaas\s+400:/i.test(message)) {
    return "Não foi possível validar o pagamento. Confira os dados ou escolha outra forma de pagamento.";
  }
  if (/Asaas\s+(401|403|429|5\d\d):/i.test(message)) {
    return "O serviço de pagamento está temporariamente indisponível. Tente novamente em instantes.";
  }
  return message || "Não foi possível iniciar o pagamento.";
}
