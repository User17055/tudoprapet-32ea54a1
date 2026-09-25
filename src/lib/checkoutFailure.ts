// Motivo compreensível para as falhas de checkout exibidas no administrativo.
// Cobre também os registros antigos, cujo error_message veio cru da Shopify.

const PATTERNS: Array<[RegExp, string]> = [
  [/OLIST_API_TOKEN|Olist n[aã]o configurada/i, "Integração da Olist sem token configurado no Supabase"],
  [/schema cache|olist_(order|receivable|invoice)|provider_payment_url/i, "Migration da integração Olist ainda não aplicada"],
  [/nota fiscal|SEFAZ|certificado/i, "A Olist não conseguiu autorizar a nota fiscal"],
  [/conta a receber|cobrança/i, "A Olist não conseguiu gerar a conta a receber"],
  [/Olist/i, "A Olist recusou ou não concluiu a operação"],
  // Casos específicos primeiro: eles ficariam escondidos atrás de "cliente".
  [
    /ja pertence a um cadastro|has already been taken|already exists/i,
    "O e-mail já pertence a outro cadastro na loja e a busca não o devolve — una os cadastros na loja",
  ],
  [/HTTP 40[13]|unauthorized|forbidden|acesso/i, "A loja recusou o acesso do site (permissão do token) — falar com o suporte"],
  [/recusou o cadastro com telefone|telefone/i, "Telefone recusado pela loja — peça o celular com DDD ao cliente"],
  [/phone/i, "Telefone recusado pela loja — peça o celular com DDD ao cliente"],
  [/e-?mail|email/i, "E-mail recusado pela loja — confirme o endereço do cliente"],
  [/zip|postal|cep/i, "CEP recusado pela loja"],
  [/province|estado|uf/i, "Estado (UF) recusado pela loja"],
  [/address|endere/i, "Endereço recusado pela loja"],
  [/cpf|cnpj|taxcredential|localizedfield/i, "CPF/CNPJ recusado pela loja"],
  [/cliente do pedido|customer|purchasingentity/i, "A loja não localizou nem criou o cadastro do cliente"],
  [/lineitem|variant|produto/i, "Produto da sacola indisponível para venda"],
  [/shipping|frete/i, "Forma de entrega não aceita pela loja"],
  [/throttl|rate limit|http 5\d\d|timeout/i, "Instabilidade momentânea da loja — vale tentar de novo"],
];

export interface CheckoutFailureExplanation {
  reason: string;
  fields: string[];
  detail: string;
}

export function describeCheckoutFailure(entry: {
  error_message: string | null;
  metadata?: unknown;
}): CheckoutFailureExplanation | null {
  const detail = entry.error_message || "";
  const metadata = (entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {}) as {
    rejectedFields?: unknown;
  };
  const fields = Array.isArray(metadata.rejectedFields)
    ? metadata.rejectedFields.map((field) => String(field)).filter(Boolean)
    : [];
  if (!detail && !fields.length) return null;
  const haystack = `${fields.join(" ")} ${detail}`;
  const reason = PATTERNS.find(([pattern]) => pattern.test(haystack))?.[1]
    || "A loja recusou o pedido sem indicar o campo";
  return { reason, fields, detail };
}
