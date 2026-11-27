# Custos e preços pela Olist

A Olist alimenta o site; o site nunca grava na Olist (mão única).

## Regra comercial

- custo: `preco_custo` da Olist, gravado em `product_costs` (com histórico);
- A franquia usa a lista Franqueados (1872). Sem referência, a aplicação propõe o custo.
- O Clube usa a lista Plano São Francisco (1871). Sem referência, a aplicação propõe o custo mais a margem de categoria (5% para ração).
- A venda efetiva usa o promocional ou o preço normal da Olist. Quando difere do valor do site, a confirmação grava o Valor do Cliente. A edição manual da coluna Shopify atualiza o preço-base na Shopify.
- O checkout e o recálculo de margens preservam os preços explícitos. Uma nova aplicação confirmada pode substituir um ajuste manual.

O SKU da variante na Shopify precisa ser igual ao código do produto na Olist
(sem espaços nas pontas, maiúsculas e minúsculas tanto faz, zero à esquerda conta).
Custo vazio ou zero na Olist não é gravado.

## Tela Admin > Valores

1. **Ler catálogo da Olist**: baixa o catálogo inteiro (`produtos.pesquisa`, 100
   por página, ~8 chamadas) e as listas de preço com as exceções (~15 chamadas)
   para tabelas de retrato só de admin. Não altera nada no site nem na Olist.
   Cada pedido à função faz uma chamada só; como a leitura inteira passa do
   limite por minuto das automações, a tela espera o tempo devolvido e continua
   sozinha (1 a 2 minutos no total).
2. Filtrar e selecionar (caixinha por linha, a página ou todos os filtrados): por
   categoria, marca, diferença com a Olist, sem SKU, não conferido há N dias,
   alterado desde uma data.
3. **Simular e atualizar pela Olist**: mostra quantos custos, franquias e
   assinantes mudam e quem passa a ficar bloqueado; só grava ao confirmar.
   SKU fora do catálogo lido pode ser consultado 1 a 1 pelo caminho antigo.

O botão com seta em cada linha continua consultando aquele SKU direto na Olist.

A prévia mostra cada SKU apto e a origem dos preços. O preço efetivo de uma lista é o promocional
da exceção do produto (ou o preço da exceção); sem exceção, o preço de venda com
o acréscimo/desconto da lista.

Datas: "alterado em" muda só quando o valor muda (gatilhos no banco, valem para
todo caminho que grava); "conferido" é a última leitura daquele custo na Olist.

## Configuração

O token fica só como secret das Edge Functions (`OLIST_API_TOKEN`), nunca no
`.env` do Vite. As funções `admin-olist-catalog` e `admin-olist-cost-sync` sobem
quando o Lovable publica; confira com `bash scripts/check-deploy.sh admin-olist-catalog`.

A API tem limite de chamadas por minuto compartilhado com o checkout
(`claim_olist_api_call`); a leitura do catálogo usa prioridade de segundo plano.
