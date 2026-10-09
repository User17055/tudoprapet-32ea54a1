# Pedidos de franquias pela Olist

O checkout de franquia usa a Olist como origem financeira. Depois da confirmação final do franqueado, o sistema:

1. cria o pedido de venda na Olist;
2. registra em `outras_despesas` a taxa operacional e a diferença entre custo e preço comercial;
3. lança a conta a receber com vencimento em 7 ou 30 dias, conforme o cadastro do franqueado;
4. gera e emite a NF-e imediatamente;
5. conclui o rascunho do pedido na Shopify como pagamento pendente;
6. consulta a Olist a cada 10 minutos e dá baixa local quando a conta estiver paga.

O boleto usa a mesma conta a receber e pode oferecer Pix por QR Code ou copia e cola. Não devem ser criadas duas cobranças separadas.

Os itens do pedido e da NF-e usam o custo salvo em `product_costs`, capturado no
snapshot do checkout. Quando o preço cobrado da franquia for maior que o custo,
a diferença, junto da taxa operacional, segue em `outras_despesas`. A parcela e
a conta a receber preservam o total comercial confirmado no checkout.

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

## Pagamentos Asaas importados da Shopify

Pedidos comuns e de assinantes pagos por Pix ou cartão no Asaas são concluídos
na Shopify como pagos. O pedido também leva `note_attributes` com
`payment_method`, `meio_pagamento`, `payment_gateway` e `provedor_pagamento`,
permitindo que a integração da Olist reconheça o intermediador real.

Na integração Shopify do ERP, habilite **Importar forma de recebimento nos
pedidos** e **Utilizar meio pagamento informado no note_attributes**. Depois,
na aba **Formas de Recebimento**, mapeie o código `pix` para a forma **Pix** e
para um meio/gateway financeiro chamado **Asaas**. Esse cadastro é apenas a
conciliação do ERP; a confirmação real continua vindo do webhook do Asaas.

Para baixar automaticamente na Olist os Pix e cartões confirmados pelo Asaas,
cadastre uma conta financeira chamada **Asaas** no ERP e publique o secret com
o nome exatamente igual ao cadastro:

```bash
npx supabase secrets set OLIST_ASAAS_ACCOUNT_NAME="Asaas"
```

O cron de `asaas-process-events` também executa essa ponte a cada 10 minutos. Ele
chama `olist-reconcile-franchise` com a credencial atual do ambiente, aguarda a
integração importar o pedido Shopify, confere pedido, valor e status pago,
localiza a conta a receber (pelo pedido ou pela NF-e) e chama a baixa oficial da
API Olist. A sessão guarda o resultado e as retentativas para impedir baixa
duplicada.

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
npx supabase functions deploy asaas-process-events --no-verify-jwt
npx supabase functions deploy olist-reconcile-franchise --no-verify-jwt
```

A migration remove o cron Olist direto, que dependia de uma cópia da service
role no Vault. O cron `reconcile-paid-shopify-orders`, já agendado a cada 10
minutos, passa a encaminhar a conciliação com a credencial vigente da função.

## Comportamento em falhas

Os IDs do pedido, da conta e da nota são salvos separadamente. Se a Olist ou a
Shopify falhar no meio do processo, uma nova tentativa retoma os registros
existentes em vez de gerar uma duplicidade. Falhas de geração, emissão ou
autorização da NF-e ficam registradas em `checkout_sessions.olist_invoice_status`
e são retomadas pela conciliação, sem bloquear a conclusão da venda.
Antes de criar pedido, cobrança, gerar ou emitir nota, o checkout obtém uma
trava atômica no banco. A emissão também tem uma trava própria compartilhada com
o conciliador. Apenas o vencedor chama a Olist; uma trava abandonada é retomada
depois de dez minutos. Isso impede pedidos e NF-e duplicados quando o cliente
repete a confirmação ou quando checkout e cron executam ao mesmo tempo.
