# Implantação do checkout próprio

O código foi construído com uma flag desligada por padrão. Assim, migrations e Edge Functions podem ser homologadas antes de qualquer cliente entrar no fluxo novo. Não ligue `VITE_CUSTOM_CHECKOUT_ENABLED` antes de concluir o teste no Sandbox.

## O que já está implementado

- checkout visual TudoPraPet em `/checkout`;
- retirada na loja;
- Pix Asaas para clientes comuns e assinantes;
- preço de assinante recalculado no servidor;
- cobrança com prazo configurável, inicialmente sete dias, para franqueados;
- bloqueio financeiro da franquia antes de criar a tentativa;
- Draft Order e pedido final na Shopify;
- inbox idempotente do webhook, resposta HTTP 200 e worker separado;
- consulta de status sem expor tabelas financeiras;
- checkout dividido em dados, entrega, pagamento e revisão;
- reaproveitamento do último cadastro, múltiplos endereços e endereço fiscal;
- frete calculado e revalidado pela API de Draft Order da Shopify;
- cartão Asaas com token criptografado, bandeira e quatro últimos dígitos;
- validação de estoque, preço, público do produto, CPF/CNPJ e limite de requisições;
- flag de rollout para voltar imediatamente ao checkout anterior.

A assinatura recorrente do Clube continua fora deste fluxo. Cartão e frete somente devem ser habilitados em produção depois das liberações e testes descritos abaixo.

## 1. Preparar Supabase CLI

Execute na raiz do projeto e confirme cuidadosamente o project ref antes de qualquer alteração:

```powershell
npx supabase login
npx supabase link --project-ref smvtnflhkvxdmvqbxwrf
npx supabase migration list
npx supabase db push --dry-run
```

O `--dry-run` deve mostrar a migration `20260811120000_checkout_payments_foundation.sql`. Depois de revisar, a aplicação real é:

```powershell
npx supabase db push
```

## 2. Configurar secrets no Sandbox

Gere tokens diferentes, longos e aleatórios para webhook e worker. Eles não devem entrar no Git.

```powershell
npx supabase secrets set ASAAS_API_KEY="chave_sandbox"
npx supabase secrets set ASAAS_API_URL="https://api-sandbox.asaas.com/v3"
npx supabase secrets set ASAAS_WEBHOOK_TOKEN="token_webhook_aleatorio"
npx supabase secrets set PAYMENT_WORKER_TOKEN="token_worker_aleatorio_diferente"
npx supabase secrets set PAYMENT_TOKEN_ENCRYPTION_KEY="segredo_aleatorio_com_32_ou_mais_caracteres"
```

Confirme também que `SHOPIFY_ACCESS_TOKEN` e `SHOPIFY_STOREFRONT_ACCESS_TOKEN` já existem no projeto. Nunca cole esses valores em conversa, arquivo `.env` ou captura de tela.

## 3. Publicar somente o backend

```powershell
npx supabase functions deploy checkout-prepare
npx supabase functions deploy checkout-payment
npx supabase functions deploy checkout-status
npx supabase functions deploy checkout-customer-data
npx supabase functions deploy checkout-shipping-options
npx supabase functions deploy asaas-webhook --no-verify-jwt
npx supabase functions deploy asaas-process-events --no-verify-jwt
```

URL do webhook:

```text
https://smvtnflhkvxdmvqbxwrf.supabase.co/functions/v1/asaas-webhook
```

No painel Sandbox do Asaas, cadastre essa URL, use no token exatamente o mesmo valor de `ASAAS_WEBHOOK_TOKEN` e comece com entrega sequencial. Selecione ao menos os eventos de pagamento criado/atualizado, confirmado, recebido, vencido, excluído, estornado e chargeback.

## 4. Agendar a reconciliação

O webhook acorda o worker em segundo plano imediatamente depois de persistir o evento. Também configure no Supabase Cron uma chamada POST a cada minuto para:

```text
https://smvtnflhkvxdmvqbxwrf.supabase.co/functions/v1/asaas-process-events
```

Com o header:

```text
x-payment-worker-token: valor_de_PAYMENT_WORKER_TOKEN
```

Guarde o header no Vault/secret do agendamento, nunca diretamente em uma migration versionada. Esse cron é o que retoma eventos `ERROR` depois do backoff quando Shopify ou Asaas ficarem temporariamente indisponíveis.

## 5. Homologar sem afetar pedidos reais

1. Mantenha a flag do frontend desligada.
2. Use Sandbox Asaas e, de preferência, uma development store Shopify.
3. Crie um produto exclusivo de teste, sem impressão ou automação.
4. Teste retirada como cliente comum e confirme o Pix no Sandbox.
5. Confirme que `payment_events` virou `PROCESSED` e `checkout_sessions` virou `shopify_created`.
6. Reenvie o mesmo webhook e confirme que não criou outro pedido.
7. Derrube temporariamente a integração de teste, confirme `ERROR` e depois a retentativa pelo cron.
8. Teste assinante e confira o preço do servidor.
9. Teste franqueado com cobrança anterior vencida e confirme o bloqueio.
10. Solicite ao gerente Asaas a liberação da tokenização na conta de produção.
11. Teste cartão aprovado, recusado, timeout, token salvo e remoção local do cartão.
12. Teste todas as tarifas de frete reais configuradas na Shopify para diferentes CEPs.
13. Verifique a operação de impressão separadamente. O checkout não deve imprimir antes de o pedido existir na Shopify.

## 6. Ligar o frontend gradualmente

No ambiente de preview/homologação do Lovable, configure:

```text
VITE_CUSTOM_CHECKOUT_ENABLED=true
```

Publique o frontend e repita os testes. Somente depois habilite a mesma variável em produção. Para rollback imediato do frontend, altere para `false` e republique; o checkout antigo continuará disponível.

## 7. Antes de produção

- trocar `ASAAS_API_KEY` pela chave de produção;
- trocar `ASAAS_API_URL` para `https://api.asaas.com/v3`;
- cadastrar um webhook novo de produção e fazer teste controlado;
- definir quem recebe e age sobre alertas da fila Asaas;
- monitorar eventos `ERROR`, pagamentos sem pedido e duplicidades;
- confirmar que o token Shopify possui `read_draft_orders` e que todas as tarifas esperadas aparecem;
- obter a liberação de tokenização do Asaas antes de habilitar cartão;
- validar requisitos PCI aplicáveis ao checkout que captura cartão, sempre via HTTPS;
- manter a feature flag desligada enquanto frete e cartão não estiverem homologados.
