

## Plan: Sistema de "Planistas" — Membros Manuais com Desconto no Checkout

### Resumo
Em vez de cobrar mensalidade via Stripe, você define manualmente quem é "planista" cadastrando o e-mail da pessoa no banco de dados. Quando essa pessoa faz login e vai ao checkout, o desconto é aplicado automaticamente via código de desconto do Shopify no carrinho.

### O que muda

1. **Criar tabela `club_members`** no banco de dados
   - Colunas: `id`, `email` (único), `name`, `is_active` (boolean, default true), `created_at`
   - RLS: leitura pública (para verificar status), inserção/edição apenas via ferramentas administrativas
   - Você adiciona/remove planistas inserindo e-mails nessa tabela

2. **Criar um código de desconto fixo no Shopify**
   - Um price rule com desconto percentual ou valor fixo (ex: 50% off)
   - Código tipo `CLUBE2025` que será aplicado automaticamente no carrinho dos planistas

3. **Modificar a Edge Function `check-subscription`**
   - Em vez de consultar o Stripe, consulta a tabela `club_members` por e-mail
   - Retorna `{ subscribed: true/false }`

4. **Aplicar desconto no carrinho automaticamente**
   - Usar a mutation `cartDiscountCodesUpdate` do Storefront API para adicionar o código de desconto ao carrinho quando o usuário for planista
   - Modificar `cartStore.ts` para aceitar e aplicar discount codes
   - Quando um planista adiciona item ao carrinho, o código de desconto é aplicado automaticamente

5. **Atualizar a página `/clube`**
   - Remover referências a R$ 29,90/mês e checkout do Stripe
   - Mostrar apenas status de membro e benefícios
   - Se for planista: "Você é membro do Clube! 🎉"
   - Se não for: "O Clube é exclusivo para membros convidados"

6. **Atualizar `SubscriptionContext`**
   - Remover funções `createCheckout` e `openCustomerPortal` (não precisa mais de Stripe)
   - Simplificar para apenas verificar status na tabela `club_members`

### Como você gerencia os planistas
- Me diz o e-mail da pessoa e eu adiciono na tabela
- Ou no futuro podemos criar uma página admin para você gerenciar

### Detalhes técnicos

- **Tabela `club_members`**: armazena e-mails autorizados
- **Shopify discount code**: desconto real aplicado no checkout do Shopify, garantindo que o preço final já vem com desconto
- **Storefront API `cartDiscountCodesUpdate`**: mutation que aplica código de desconto ao carrinho programaticamente
- **Edge Function simplificada**: apenas um SELECT na tabela em vez de chamadas ao Stripe

