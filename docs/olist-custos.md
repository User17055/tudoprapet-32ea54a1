# Sincronizacao de custos da Olist

A tela **Admin > Valores** consulta o ERP Olist pelo SKU da variante na Shopify.

## Regra comercial

- franquia: `preco_custo` da Olist;
- cliente, somente para racao: `preco_custo * 1,12`, arredondado em centavos;
- outros produtos: a consulta individual atualiza somente o valor da franquia.

Uma variante e considerada racao quando o tipo, uma tag ou o titulo do produto na
Shopify contem `racao` ou `racoes` (com ou sem acento). Para evitar classificacao
por titulo, use a tag ou o tipo de produto `racao` na Shopify.

O retorno da pesquisa da Olist pode conter codigos parecidos. A integracao grava
o custo apenas quando encontra uma correspondencia exata do SKU e ignora custo
vazio ou igual a zero.

## Configuracao

O token nunca deve ser colocado no `.env` do Vite nem no navegador. Cadastre-o
como secret da Edge Function:

```sh
npx supabase secrets set OLIST_API_TOKEN="seu-token-da-olist"
npx supabase functions deploy admin-olist-cost-sync
```

Depois do deploy, abra **Admin > Valores**. O botao **Atualizar racoes pela
Olist** atualiza todas as racoes que possuem SKU. O botao com seta em cada linha
faz a consulta de somente uma variante.

A API limita chamadas por minuto conforme o plano. A funcao consulta os SKUs em
sequencia e espera entre chamadas para respeitar o menor limite dos planos atuais.
