# Preço do cliente acima do preço da Shopify

## Problema confirmado

Em `checkout-prepare`, o total cobrado usa `catalogPrice = customerPriceMap.get(variantId) ?? detail.price`, mas o rascunho na Shopify é montado por `buildDraftLineItems`, que só sabe aplicar **desconto** por linha (`applied_discount`) quando o preço especial é *menor* que o preço da variante.

Consequência: quando o "Valor do Cliente" cadastrado em Valores é **maior** que o preço da Shopify, o cliente paga o valor maior, mas o pedido gerado na Shopify fica com o valor menor. O mesmo vale para `_shared/checkout.ts` (checkout de assinante/franquia), onde o preço do cliente só entra no mapa quando é menor.

## O que fazer

1. **Linha com acréscimo no rascunho**: em `_shared/pricing.ts`, quando o preço efetivo for maior que o preço da variante na Shopify, montar a linha como item customizado (`title` + `originalUnitPrice` = preço efetivo) em vez de `variant_id`, mantendo SKU e título do produto nas propriedades da linha para rastreio. Quando for menor ou igual, manter o comportamento atual (variante + desconto).
2. **Rastreio de estoque**: itens customizados não baixam estoque na Shopify. Definir junto ao dono se isso é aceitável ou se preferimos a alternativa (2b).
   - 2b. Alternativa sem item customizado: manter a linha da variante e adicionar **uma linha customizada de ajuste** ("Ajuste de preço") com a diferença total. Estoque continua correto, mas o pedido mostra a linha extra.
3. **Unificar em `_shared/checkout.ts`**: passar o preço do cliente como preço base (`currentPriceMap`) para assinante/franquia, de modo que o desconto do perfil seja calculado sobre o valor exibido no site, não sobre o da Shopify.
4. **Testes**: acrescentar casos em `src/test/checkoutPricing.test.ts` cobrindo preço do cliente maior, menor e igual ao da Shopify, com e sem preço de assinante/franquia.
5. **Deploy**: `checkout-prepare`, `subscriber-checkout`, `franchise-checkout` e publicação do frontend.

## Decisão necessária

Escolher entre item customizado (item 1, perde baixa de estoque) e linha de ajuste (item 2b, mantém estoque e mostra linha extra no pedido).
