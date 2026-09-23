# Menus de categoria e preços do cliente

Dois problemas confirmados que precisam de decisão sua antes de eu mexer.

## 1. Categorias podem desaparecer do menu

Hoje o site só mostra uma categoria se houver produto ligado **diretamente** a ela. Nos dados atuais Cachorro, Gato, Ração e Farmácia têm produtos ligados direto, então o menu está normal. O risco: no dia em que um produto for cadastrado só no subgrupo (ex.: só em "Ração Seca"), a categoria "Ração" e até "Cachorro" saem do menu — e, sem a categoria mãe, os subgrupos ficam inalcançáveis, o atalho de pet desaparece e o filtro por pet no catálogo para de funcionar.

Proposta: manter a regra atual de esconder categorias vazias, mas **manter também as categorias mães** de qualquer categoria que tenha produto. Assim nada vazio aparece e a navegação nunca quebra.

Alternativa: deixar como está (menu pode sumir se o cadastro mudar).

## 2. Não há mais tela para ver/corrigir o "Valor do Cliente"

Existem 31 variantes com preço de cliente salvo. Esse valor continua decidindo o que o comprador vê e paga no fechamento do pedido, mas a tela Valores não mostra mais esse campo — não há onde conferir, corrigir ou apagar. A sincronização com a Olist só apaga esses valores em itens de ração.

Opções:
- **A.** Trazer de volta a coluna "Valor do Cliente" na tela Valores (ver, editar, apagar), como era antes.
- **B.** Deixar apenas leitura: uma lista dos produtos com valor de cliente salvo, com botão para remover.
- **C.** Apagar de vez os valores de cliente salvos e passar a usar sempre o preço derivado do custo.

## Detalhes técnicos

1. `src/lib/categoryAvailability.ts`: após montar o conjunto de categorias com vínculo, subir pela cadeia `parent_id` e incluir os ancestrais. Atualizar `src/test/categoryAvailability.test.ts` (os testes atuais afirmam o contrário) e manter `useCategoryTree.ts` / `Catalog.tsx` sem mudanças.
2. Opção A/B: reintroduzir em `src/pages/admin/ValuesTab.tsx` a leitura de `customer_prices` (via `fetchAllCustomerPrices`), a assinatura realtime, o campo no rascunho e o ramo de upsert/delete em `saveRow`, respeitando o teto de preço existente.
