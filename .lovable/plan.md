# Documento do cliente na Shopify: auditoria antes de qualquer correção

## O que já está confirmado por leitura de código

`findOrCreateCustomer` (`supabase/functions/_shared/shopify.ts`, linhas 59-120) grava no cadastro do cliente da Shopify **apenas**: e-mail, primeiro/último nome, telefone e (quando o cliente não tem endereço padrão) um endereço. Não há nenhuma escrita de CPF/CNPJ ali — nem metafield, nem nota, nem `tax_exemptions`. O documento só é gravado no pedido/rascunho: no atributo `CPF/CNPJ` e no campo localizado `TAX_CREDENTIAL_BR`.

Ou seja: a hipótese de que o cadastro do cliente está sem documento é consistente com o código. O que falta é medir na Shopify, e medir antes de mudar qualquer coisa.

## Item 4 e ASAAS_DIAG_OPEN

- Persistência do aviso de credencial fiscal: nada será feito, é do seu PR.
- `ASAAS_DIAG_OPEN`: fica como está, aguardando sua aprovação de remoção.

## Passo 1 — Auditoria (só leitura na Shopify)

Uma Edge Function temporária, protegida por `PAYMENT_WORKER_TOKEN`, que recebe uma lista de números de pedido e devolve, para cada um:

- do pedido: `localizedFields` (chave e valor de `TAX_CREDENTIAL_BR`), o atributo `CPF/CNPJ`, e se os dois batem dígito a dígito;
- do cliente associado: `id`, `email`, `phone`, `note`, `taxExempt`, `defaultAddress`, **todos** os `metafields` (todos os namespaces) e `tags` — para responder se o documento aparece em algum campo do cadastro.

Rodo primeiro com o #1094 (recusado, posterior ao #1053) e com um pedido processado com sucesso pelo Mintegra, para comparar. Depois rodo com a lista dos 18 quando você me passar.

A função é criada, executada e removida no mesmo trabalho — mesmo procedimento da auditoria anterior de `localizedFields`, sem deixar superfície aberta.

## Passo 2 — Só depois da leitura

Se o cadastro do cliente vier sem documento nos pedidos recusados e com documento nos aceitos, a causa está identificada e a correção é gravar o documento no cadastro do cliente. Nesse caso eu volto com a proposta concreta (qual campo: metafield dedicado vs. outro), porque a escolha depende de qual campo o Mintegra lê — e isso a auditoria comparativa mostra.

Se os dois vierem iguais, a causa não é campo vazio nem cadastro do cliente, e o próximo alvo passa a ser o formato/valor lido pelo Mintegra. Nesse caso não invento correção: reporto o que os dados mostram.

## Arquivos que não serão tocados

Nada de `ValuesTab.tsx`, `Header.tsx`, `MobileCategoryNav.tsx`, `_shared/pricing.ts`, `checkout-prepare/index.ts`, `checkout-payment/index.ts`. Nesta etapa nem `_shared/shopify.ts` é alterado — a auditoria é uma função isolada e temporária.
