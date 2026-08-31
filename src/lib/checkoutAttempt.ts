// Rótulo de uma linha da tabela "Tentativas de compra" do admin.
//
// A etapa `payment` marcada como sucesso NÃO quer dizer que alguém pagou:
// quer dizer que o Asaas aceitou criar a cobrança. São coisas diferentes, e a
// diferença já custou caro. Em 31/08/2026 uma cliente tentou pagar R$ 228,38
// duas vezes, o app do banco recusou o QR nas duas, e o painel exibiu
// "Sucesso" nas duas -- o time só soube pela foto que ela mandou do celular.
//
// Quem lê esta tabela precisa enxergar a diferença entre cobrar e receber. A
// confirmação de pagamento vive no pedido, não aqui.

export type AttemptStage = "prepare" | "payment" | "shopify_completion";

export type AttemptTone = "ok" | "pending" | "error";

export interface AttemptStatusLabel {
  label: string;
  tone: AttemptTone;
}

export function attemptStatusLabel(stage: AttemptStage, success: boolean): AttemptStatusLabel {
  if (!success) return { label: "Falhou", tone: "error" };
  if (stage === "payment") return { label: "Cobrança criada", tone: "pending" };
  return { label: "Sucesso", tone: "ok" };
}
