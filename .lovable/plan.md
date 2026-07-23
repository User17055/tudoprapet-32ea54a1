## Objetivo
Permitir marcar cada produto (no admin) como visível para **cliente**, **franquia** ou **ambos**, ocultar os "franquia" de clientes normais, e definir preço especial de franquia.

## Banco de dados (migration)

1. **`profiles`**: adicionar coluna `is_franchisee boolean default false`.
2. **`product_audience`** (nova tabela):
   - `shopify_product_id text primary key`
   - `audience text not null check (audience in ('cliente','franquia','ambos'))` — default `'cliente'`
   - `created_at`, `updated_at`
   - RLS: leitura pública (anon+authenticated); escrita apenas admin (`has_role`).
   - GRANTs padrão.
3. **`franchise_prices`** (nova tabela, espelho de `subscriber_prices`):
   - `shopify_variant_id text primary key`
   - `shopify_product_id text not null`
   - `price numeric not null`
   - `created_at`, `updated_at`
   - RLS: leitura só para franqueado logado (`profiles.is_franchisee = true`) ou admin; escrita só admin.
   - GRANTs.

## Frontend — Admin

4. Nova aba **"Franquia"** (ou seção dentro de "Detalhes") no painel admin:
   - Lista de produtos Shopify com seletor de audiência (Cliente / Franquia / Ambos) — grava em `product_audience`.
   - Campo de preço de franquia por variante — grava em `franchise_prices`.
5. Na aba de **usuários/perfis** (Detalhes), adicionar toggle "Franqueado" que atualiza `profiles.is_franchisee`.

## Frontend — Loja

6. Novo hook `useProductAudience()` (carrega mapa `product_id → audience` uma vez).
7. Novo contexto/hook `useIsFranchisee()` lendo `profiles.is_franchisee` do usuário logado.
8. Filtro de produtos aplicado em:
   - `ProductGrid` (destaques)
   - `Catalog` (catálogo)
   - `ProductDetail` (bloquear/redirecionar se não permitido)
   
   Regra:
   - Não-franqueado → mostra `cliente` e `ambos`
   - Franqueado → mostra `franquia` e `ambos`
9. Novo hook `useFranchisePrices()` análogo a `useSubscriberPrices`. Em `ProductCard` e `ProductDetail`, se usuário é franqueado e existe preço de franquia, exibir com destaque próprio (badge "Preço Franquia", cor diferente do sky do clube — sugiro `emerald`).
10. Checkout: função edge `franchise-checkout` (baseada em `subscriber-checkout`) que cria Draft Order aplicando preço de franquia quando o usuário logado é franqueado.

## Detalhes técnicos
- Filtragem client-side (mesma abordagem já usada com `featured_products`).
- Preço de franquia é exclusivo — não empilha com preço de clube. Precedência: franqueado > clube > varejo.
- `has_role(auth.uid(),'admin')` continua sendo o gate de escrita.

## Fora do escopo
- Sincronização automática com tags da Shopify (você marca manualmente no admin).
- Cadastro em massa de preços de franquia (fazer 1 a 1 na UI; posso adicionar import CSV depois se quiser).

Confirma que posso seguir?