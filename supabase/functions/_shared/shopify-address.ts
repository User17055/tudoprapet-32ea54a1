// Endereço brasileiro traduzido para o modelo de endereço da Shopify.
//
// Por que isto é um módulo separado: o destino final destes campos não é a
// Shopify, é a NFe. O Omie.Hub lê o pedido na Shopify e preenche Logradouro,
// Número, Complemento e Bairro a partir daqui. Enquanto a função vivia dentro
// de `checkout-prepare/index.ts` ela não tinha como ser importada, e portanto
// não tinha como ser testada -- um campo trocado só aparecia como nota fiscal
// travada, dias depois, sem rastro no código.
//
// O QUE FOI MEDIDO (pedido #1106, 11/09/2026). O endereço
// `Rua Djalma Dutra / 280 / Apto 1201 / Vila Ocidental` chegava ao Omie assim:
//
//   Logradouro: "Rua Djalma Dutra, 280, Apto 1201 - Vila Ocidental"
//   Número:     (vazio)
//   Complemento:(vazio)
//   Bairro:     (vazio)   <- campo obrigatório, travava a emissão
//
// Ou seja, o Omie concatena address1 + address2 num campo só. `Número` e
// `Complemento` NÃO são obrigatórios na tela dele; `Bairro` é.

import type { CheckoutAddressInput } from "./checkout-input.ts";

// `type` e não `interface` de propósito: `createFiscalDraftOrder` recebe o
// endereço como `Record<string, unknown>`, e interface não é atribuível a isso
// (não ganha assinatura de índice implícita). Trocar por interface quebra o
// typecheck de checkout-prepare.
export type ShopifyRestAddress = {
  first_name: string;
  last_name: string;
  address1: string;
  address2?: string;
  company?: string;
  city: string;
  province_code: string;
  zip: string;
  country_code: "BR";
  phone: string;
};

export function shopifyAddress(
  address: CheckoutAddressInput,
  customerName: string,
  phone: string,
  cpfCnpj: string,
): ShopifyRestAddress {
  const names = customerName.trim().split(/\s+/);
  const firstName = names.shift() || "Cliente";
  return {
    first_name: firstName,
    last_name: names.join(" ") || firstName,

    // Número segue concatenado no logradouro DE PROPÓSITO. A Shopify não tem
    // campo de número, e como o Omie junta address1 com address2 de qualquer
    // jeito, separá-los aqui não faria o número aparecer no campo `Número` --
    // faria ele sumir da tela, que é pior do que aparecer colado. Só mude isto
    // quando o mapeamento de campos do Omie.Hub for conhecido.
    address1: `${address.address1}, ${address.number}`,
    address2: [address.address2, address.neighborhood].filter(Boolean).join(" - ") || undefined,

    // É DAQUI que o Omie.Hub lê o CPF/CNPJ do cliente. Não dos atributos do
    // pedido, não do campo localizado TAX_CREDENTIAL_BR -- do `company` do
    // endereço.
    //
    // Isso não está em documentação nenhuma da Omie; foi medido. Em 11/09/2026
    // o pedido #1169 estava parado com "CPF ou CNPJ do cliente esta vazio ou
    // invalido", como outros 72. Preenchendo à mão o campo "Empresa" do
    // endereço de entrega na Shopify com os 11 dígitos, o Omie passou a puxar
    // o cadastro inteiro e o pedido destravou. Nenhum outro campo mudou.
    //
    // Só dígitos: o Omie valida o documento, e "779.995.178-87" não passa.
    //
    // O bairro NÃO cabe aqui -- este campo tem dono. Ele continua indo dentro
    // de `address2`, que é para onde o próprio formulário brasileiro da
    // Shopify também o manda. Hoje o Omie não o extrai de lá, e esse pedaço
    // segue em aberto.
    //
    // Custo conhecido: `company` sai impresso como nome de empresa em etiqueta
    // e romaneio da Shopify -- aparecerá o CPF. É o preço de emitir a nota.
    company: cpfCnpj.replace(/\D/g, "") || undefined,

    city: address.city,
    province_code: address.provinceCode,
    zip: address.postalCode,
    country_code: "BR",
    phone: `+55${phone}`,
  };
}
