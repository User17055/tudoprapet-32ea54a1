# Restaurar a confirmação de estoque no checkout

## O que será feito

- Manter a validação de estoque obrigatória e bloquear a compra quando a Shopify não permitir confirmar a quantidade.
- Identificar explicitamente a falta de `read_products` ou `read_inventory` na consulta administrativa.
- Registrar o detalhe técnico em `checkout_attempt_logs`, sem gravar token nem dados pessoais desnecessários.
- Mostrar ao cliente apenas: “Loja temporariamente indisponível. Tente novamente em instantes.”
- Validar a função e publicar somente `checkout-prepare` após o token correto estar configurado.

## Configuração obrigatória na Shopify

O token atual é gerenciado pela integração e não pode ser substituído pelas ferramentas de secrets. Será necessário:

1. Abrir **Shopify Admin → Configurações → Apps e canais de vendas → Desenvolver apps**.
2. Abrir o aplicativo usado pela TudoPraPet.
3. Em **Configuração da API Admin**, incluir `read_products` e `read_inventory`.
4. Salvar e clicar em **Instalar app** ou **Reinstalar app** para que os novos escopos entrem no token.
5. Copiar o novo token Admin e atualizar `SHOPIFY_ACCESS_TOKEN` na conexão Shopify do workspace, sem enviar o valor pelo chat.

## Validação

- Confirmar que a consulta de `ProductVariant` retorna produto e inventário sem `ACCESS_DENIED`.
- Confirmar que estoque indisponível continua bloqueando a compra.
- Confirmar que uma tentativa válida cria o rascunho antes de qualquer cobrança.
- Conferir os logs da função após o redeploy.

## Rollback

- Reimplantar a versão anterior de `checkout-prepare`; os escopos adicionais são somente leitura e podem permanecer sem alterar o comportamento anterior.
