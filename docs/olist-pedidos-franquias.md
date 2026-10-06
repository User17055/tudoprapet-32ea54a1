# Pedidos de franquias pela Olist

O checkout de franquia usa a Olist como origem financeira. Depois da confirmação final do franqueado, o sistema:

1. cria o pedido de venda na Olist;
2. acrescenta R$ 2,00 em `outras_despesas`;
3. lança a conta a receber com vencimento em 7 ou 30 dias, conforme o cadastro do franqueado;
4. gera e emite a NF-e imediatamente;
5. conclui o rascunho do pedido na Shopify como pagamento pendente;
6. consulta a Olist a cada 10 minutos e dá baixa local quando a conta estiver paga.

O boleto usa a mesma conta a receber e pode oferecer Pix por QR Code ou copia e cola. Não devem ser criadas duas cobranças separadas.

A condição de pagamento é individual por franquia e pode ser configurada no
Admin em dois modos:

- **dias após a compra**: qualquer prazo entre 1 e 365 dias;
- **dia fixo no mês seguinte**: dia 1 a 31; em meses curtos, usa o último dia.

O prazo, a modalidade e a finalidade da NF-e são copiados para o pedido;
alterações posteriores no cadastro não mudam pedidos antigos.

## Configuração

Defina os segredos das Edge Functions:

```powershell
npx supabase secrets set OLIST_API_TOKEN="token-da-api-v2"
npx supabase secrets set OLIST_FRANCHISE_PAYMENT_METHOD="boleto"
npx supabase secrets set OLIST_RESALE_NATURE_OPERATION_ID="id-revenda-na-olist"
npx supabase secrets set OLIST_FINAL_CONSUMPTION_NATURE_OPERATION_ID="id-consumo-final-na-olist"
```

`OLIST_FRANCHISE_PAYMENT_METHOD` usa `boleto` por padrão. O valor é normalizado para minúsculas antes de ser enviado à Olist.

Os dois IDs de natureza de operação são obrigatórios para novos pedidos de franquia. Obtenha-os no cadastro fiscal da Olist com o contador; o sistema não presume CFOP ou tributação. A escolha **Revenda** ou **Consumo final** feita no checkout seleciona o ID correspondente no campo `id_natureza_operacao` do pedido da Olist.

No painel da Olist, confirme antes da publicação:

- certificado digital A1 válido e configuração fiscal da NF-e;
- natureza de operação, série e numeração da nota;
- produtos com SKU igual ao código usado na Shopify;
- lançamento financeiro pelo pedido, evitando uma segunda conta automática na autorização da nota;
- permissão do token para pedidos, contas a receber e notas fiscais.

### Envio do Pix por e-mail

No painel da Olist, acesse **Configurações > Finanças > Configurações do envio de documentos**. Na área de Pix, inclua a variável `[LINK_PIX]` no modelo do e-mail de cobrança.

Se o e-mail enviado for o da venda completa, faça a mesma configuração em **Configurações > Vendas > Configurações do envio de documentos**. A conta bancária/Conta Digital precisa estar configurada para recebimento por Pix. O sistema já envia a NF-e ao e-mail do cliente e mantém o vencimento no prazo de 7 ou 30 dias configurado pelo administrador.

## Publicação

Execute a migration e publique as funções alteradas:

```powershell
npx supabase db push
npx supabase functions deploy checkout-prepare
npx supabase functions deploy checkout-payment
npx supabase functions deploy checkout-customer-data
npx supabase functions deploy franchise-payments
npx supabase functions deploy admin-franchise-settings
npx supabase functions deploy admin-orders --no-verify-jwt
npx supabase functions deploy olist-reconcile-franchise --no-verify-jwt
```

A migration agenda a conciliação a cada 10 minutos. Ela precisa encontrar o segredo `service_role_key` (ou `supabase_service_role_key`) no Vault do projeto, caso `app.settings.service_role_key` não esteja definido.

## Comportamento em falhas

Os IDs do pedido, da conta e da nota são salvos separadamente. Se a Olist ou a Shopify falhar no meio do processo, uma nova tentativa retoma os registros existentes em vez de gerar uma duplicidade. Depois que a Olist aceita a solicitação de emissão, o pedido é concluído na Shopify mesmo que a NF-e ainda esteja pendente de autorização pela SEFAZ. Uma recusa real da solicitação de emissão continua interrompendo o fluxo.
