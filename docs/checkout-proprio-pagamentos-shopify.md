# Checkout próprio TudoPraPet com Shopify e Asaas

Status: proposta técnica para implementação  
Objetivo: substituir o redirecionamento ao checkout da Shopify por um checkout com a identidade visual da TudoPraPet, mantendo a Shopify como fonte de catálogo, variantes, estoque e pedidos. O Asaas será inicialmente o processador financeiro, isolado atrás de uma camada que permita trocar de fornecedor no futuro.

## 1. Decisões principais

1. A página de checkout pertence à TudoPraPet e roda no mesmo frontend da loja.
2. O navegador nunca recebe a chave da API do Asaas nem o token administrativo da Shopify.
3. Preços, descontos, elegibilidade, estoque, frete e bloqueios são recalculados no backend.
4. A Shopify continua registrando o pedido final e controlando estoque/fulfillment.
5. O Supabase mantém a sessão de checkout, o vínculo financeiro e o histórico de eventos.
6. O Asaas é acessado por um adaptador de pagamento; nenhuma tela deve depender de campos exclusivos dele.
7. Webhook, e não o retorno do navegador, confirma pagamento.
8. Todas as operações críticas devem ser idempotentes para não cobrar, criar pedido ou imprimir duas vezes.

## 2. O que muda no projeto atual

Hoje `src/pages/Cart.tsx` e `src/components/CartDrawer.tsx` obtêm um `checkoutUrl` e redirecionam o comprador. Os fluxos especiais `subscriber-checkout` e `franchise-checkout` criam Draft Orders e retornam a URL de cobrança da Shopify.

No fluxo novo:

- o botão **Finalizar compra** navegará para `/checkout`;
- o carrinho continuará usando variantes e dados da Shopify;
- `/checkout` exibirá identificação, entrega, resumo e pagamento com o visual TudoPraPet;
- uma Edge Function criará uma sessão de checkout validada;
- outra Edge Function iniciará a cobrança no provedor configurado;
- o webhook do provedor apenas validará e persistirá o evento em uma inbox durável;
- um worker separado atualizará a sessão e concluirá o pedido na Shopify.

Não se deve remover imediatamente o checkout atual. Durante a implantação, ele será mantido atrás de uma flag de rollback.

Destino dos fluxos atuais:

- `subscriber-checkout` e `franchise-checkout` coexistem temporariamente com o checkout novo atrás da flag;
- as regras atuais de elegibilidade e preço são extraídas/reutilizadas em `checkout-prepare`, sem criar uma segunda regra concorrente;
- `Cart.tsx`, `CartDrawer.tsx` e a compra imediata de `ProductDetail.tsx` migram como um único conjunto, para não haver caminhos com preços ou comportamentos diferentes;
- `ProductDetail.tsx` não é apenas outro botão: hoje ele possui os caminhos de `franchise-checkout`, `subscriber-checkout` e o checkout instantâneo `createInstantCheckoutUrl`; os três precisam convergir para `checkout-prepare` sem obrigar a inclusão prévia no carrinho;
- cada sessão registra `checkout_version`, permitindo auditoria e rollback;
- após pelo menos 30 dias de estabilidade, conciliação sem divergências e aprovação operacional, os endpoints antigos podem ser aposentados.

## 3. Regras por tipo de cliente

| Tipo | Preço | Pagamento | Quando vira pedido Shopify | Bloqueio |
|---|---|---|---|---|
| Comum | Preço normal vigente na Shopify | Imediato | Após confirmação do pagamento | Não aplicável |
| Assinante ativo | Preço do clube calculado no servidor | Imediato | Após confirmação do pagamento | Perde preço especial se assinatura estiver inativa |
| Franqueado regular | Preço de franquia calculado no servidor | Prazo de 7 dias | Imediatamente, como pagamento pendente aprovado para prazo | Bloqueado se houver cobrança vencida |
| Franqueado inadimplente | Nenhuma nova compra | Não cria cobrança | Não cria pedido | Até quitar ou receber liberação administrativa |

Regra recomendada: o franqueado pode comprar durante os sete dias de prazo e é bloqueado somente quando existir título vencido. Se a regra comercial desejada for permitir apenas uma cobrança aberta por vez, isso deve ser uma configuração chamada `block_on_any_open_invoice`.

O frontend jamais decide se alguém é assinante ou franqueado. A Edge Function consulta o usuário autenticado, as tabelas de elegibilidade e a situação financeira.

## 4. Arquitetura independente do Asaas

O domínio usará nomes genéricos:

```ts
interface PaymentProvider {
  createCustomer(input: CustomerInput): Promise<ProviderCustomer>;
  createImmediatePayment(input: ImmediatePaymentInput): Promise<PaymentResult>;
  createDeferredCharge(input: DeferredChargeInput): Promise<PaymentResult>;
  getPayment(id: string): Promise<PaymentResult>;
  refund(id: string, amount?: number): Promise<RefundResult>;
  parseWebhook(request: Request): Promise<VerifiedPaymentEvent>;
}
```

Implementações previstas:

```text
PaymentProvider
└── AsaasPaymentProvider (primeira implementação)
    ├── clientes
    ├── Pix
    ├── cobranças com prazo
    ├── consulta de status
    └── estorno e webhook
```

A interface e o banco armazenam `provider = "asaas"` e `provider_payment_id`, mas a tela trabalha apenas com `paymentId`, `status`, `pixQrCode`, `pixCopyPaste` e `expiresAt`. Assim outro gateway poderá ser conectado sem reconstruir o checkout.

### Autoridade por produto financeiro

- **Stripe permanece responsável pelas assinaturas do Clube** na primeira versão. `create-checkout`, `customer-portal` e a tabela `subscribers` não serão removidos por esta migração.
- **Asaas processa compras de produtos** de clientes comuns e assinantes, além das cobranças a prazo dos franqueados.
- Migrar a recorrência do Clube para outro provedor é um projeto separado, com migração de clientes, cartões/tokens, cancelamentos e conciliação próprios.
- Vindi ou qualquer sistema financeiro da matriz fica fora do escopo até existir contrato de API, autenticação, estados financeiros e regra de conciliação documentados.

Assim, “assinante” define elegibilidade de preço; não significa que a compra avulsa de produtos precise ser cobrada no mesmo provedor da assinatura.

## 5. Fluxo do cliente comum e assinante

1. O comprador confirma os dados no checkout TudoPraPet.
2. `checkout-prepare` recebe apenas IDs de variantes, quantidades, cupom e entrega pretendida.
3. O servidor consulta os produtos novamente e ignora preços enviados pelo navegador.
4. O servidor identifica o perfil e aplica preço normal ou preço do clube.
5. O servidor calcula frete e total final.
6. Uma `checkout_session` é criada com status `awaiting_payment`.
7. `checkout-pay` cria uma nova linha em `payments` para cada tentativa e envia `externalReference = payment.id` ao Asaas.
8. No Pix, o checkout exibe QR Code, copia e cola, valor e a validade real informada pelo Asaas usando componentes TudoPraPet.
9. A tela acompanha o status, mas nunca se autodeclara paga.
10. O webhook autenticado persiste a confirmação e responde HTTP 200 imediatamente.
11. Um worker processa o evento persistido e conclui o pedido Shopify exatamente uma vez.
12. O navegador é atualizado por Realtime ou consulta curta e abre `/pedido-confirmado/:id`.

Uma sessão pode ter várias tentativas de pagamento, mas o caminho normal deve reutilizar a cobrança válida existente. Uma tentativa falha, excluída ou realmente expirada nunca é sobrescrita: fica no histórico e, somente quando necessário, uma nova linha `payments` é criada.

### Validade, reserva e substituição do Pix

A cobrança Asaas, a sessão do checkout e a reserva Shopify têm vidas independentes:

| Vida | Autoridade | Renovação |
|---|---|---|
| Cobrança/QR Pix | `dueDate`, `expirationDate` e estado retornados pelo Asaas | normalmente reutiliza a mesma cobrança |
| Sessão visual | política da TudoPraPet | pode ser reaberta enquanto a cobrança continuar válida |
| Reserva de estoque | `reserveInventoryUntil` da Shopify | `draftOrderUpdate`, sem exigir novo pagamento |

O Asaas recebe `dueDate` como data, não como horário. Sua documentação informa que o QR dinâmico regular pode expirar até 12 meses depois do vencimento; sem chave Pix própria, o comportamento transitório é até 23:59 do mesmo dia. Portanto, o checkout **não pode inventar um contador de 15 minutos** nem afirmar que o Pix expirou apenas porque a sessão visual terminou. Deve mostrar `expirationDate` devolvido pelo provedor e confirmar o comportamento real da conta no Sandbox.

Os spikes precisam medir: validade com chave Pix configurada, comportamento após `dueDate`, campos retornados na consulta, pagamento após a reserva Shopify e exclusão de cobrança pendente. O resultado decide a política:

- se a cobrança continua pagável depois da reserva, aceitar o pagamento tardio e tratar falta de estoque; ou
- excluir a cobrança quando a reserva/sessão vencer, alinhando as duas vidas por uma rotina agendada.

Substituir a cobrança vira exceção — mudança de carrinho/valor, cancelamento explícito, exclusão ou falha definitiva — e não ação normal de “regenerar”. Desativar uma tentativa apenas no banco não impede o pagamento do QR Code antigo. Quando a substituição for necessária, usa-se `DELETE /v3/payments/{id}` somente se ainda estiver elegível, por uma saga idempotente:

1. bloquear a sessão e marcar a tentativa atual como `cancellation_requested`, gravando uma ação durável;
2. consultar o estado atual no Asaas;
3. se ainda estiver pendente, solicitar a exclusão e confirmar `deleted: true`;
4. somente depois marcar a tentativa como `cancelled`, `is_active = false`;
5. renovar a reserva Shopify, quando adotada, até a política definida para a sessão;
6. criar a próxima linha `payments`, emitir a nova cobrança e só então apresentar o novo QR Code.

Existe uma corrida inevitável: o cliente pode pagar enquanto o cancelamento está em andamento. Por isso, `PAYMENT_CONFIRMED` ou `PAYMENT_RECEIVED` de tentativa inativa/cancelada continua sendo um pagamento válido do checkout e pode concluir o pedido exatamente uma vez. Se duas tentativas forem efetivamente recebidas, uma única cria o pedido; a outra abre ocorrência financeira para estorno, sem gerar segundo pedido ou impressão.

Se o Asaas estiver indisponível durante `cancellation_requested`, `payment-reconcile` retenta a mesma saga com backoff. Enquanto isso, a tela mostra “não foi possível substituir o Pix agora” e, se a cobrança anterior ainda for válida e os itens/valores não mudaram, continua oferecendo o QR anterior. A mesma rotina cancela qualquer tentativa substituta pendente quando uma tentativa antiga for recebida. Deve existir alerta para cancelamento pendente acima de 15 minutos.

Para pagamento imediato, o pedido definitivo não deve ser impresso antes da confirmação financeira.

## 6. Fluxo do franqueado com prazo de 7 dias

1. `checkout-prepare` autentica o franqueado.
2. O backend bloqueia a conta durante a validação para impedir duas compras concorrentes de burlarem a regra.
3. Consulta cobranças abertas/vencidas e o campo administrativo de bloqueio.
4. Se houver inadimplência, responde `403` com valor, vencimento e identificação da pendência.
5. Se estiver regular, valida os preços de franquia.
6. Cria cobrança com vencimento em `data_do_pedido + 7 dias`.
7. Cria/conclui o Draft Order Shopify como pedido com pagamento pendente.
8. Salva o ID Shopify e o ID financeiro na mesma sessão.
9. O pedido recebe tags `FRANQUIA`, `PRAZO_7_DIAS` e `ASAAS`.
10. O pedido pode seguir para separação e impressão porque o crédito comercial foi aprovado.
11. No pagamento, o webhook grava o evento; o worker marca a cobrança local e o pedido Shopify como pagos.
12. No vencimento, o worker ou a reconciliação diária bloqueia novas compras.

O bloqueio precisa existir em dois pontos: ao abrir/preparar o checkout e novamente imediatamente antes de criar a cobrança/pedido.

## 7. Shopify

A Shopify permanece responsável por:

- produtos, variantes, publicação e estoque;
- identidade do item comprado por `variant_id`;
- pedido final, cliente, endereços e linhas de frete;
- fulfillment, retirada e histórico operacional;
- relatórios operacionais e integrações existentes.

Estratégia recomendada:

- criar um Draft Order validado;
- para pagamento imediato, completá-lo como pago somente pelo worker após um evento financeiro persistido;
- para franqueado, completá-lo como pagamento pendente autorizado para prazo;
- registrar o provedor e o ID da cobrança em metafields ou atributos;
- usar uma linha de frete explícita, sem inferência por status.

Valores obrigatórios de entrega:

```text
RETIRADA  -> title: "Retirada na loja", code: "pick_up"
PAC       -> title: "PAC", code: "pac"
SEDEX     -> title: "SEDEX", code: "sedex"
MOTOBOY   -> title: "Motoboy", code: "local_delivery"
```

Isso evita voltar a exibir `SHOP LOCATION SHOP` e mantém a impressão baseada na escolha do comprador, nunca no estado "pronto para retirada".

A Shopify documenta a Storefront API como base para vitrines headless e a Admin GraphQL API permite criar pedidos externos. `orderCreate` não reaplica automaticamente todas as regras de desconto; por isso os valores devem ser reproduzidos e auditados pelo backend. Referências: [Storefront API](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api), [orderCreate](https://shopify.dev/docs/api/admin-graphql/latest/mutations/ordercreate) e [draftOrderComplete](https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftOrderComplete).

### 7.1 Frete é um subsistema próprio

O projeto atual não calcula frete: essa responsabilidade fica no checkout hospedado da Shopify. Portanto, “calcular frete” não pode ser tratado como apenas um campo novo no checkout.

Antes da implementação, um spike técnico deve comparar:

1. opções de entrega calculadas pela Shopify;
2. integração direta com transportadora ou agregador;
3. tabela própria por CEP, peso, valor e modalidade.

A primeira opção a validar é a query GraphQL [`draftOrderAvailableDeliveryOptions`](https://shopify.dev/docs/api/admin-graphql/latest/queries/draftOrderAvailableDeliveryOptions). O teste deve confirmar cobertura para o Brasil, retirada, regras da loja e preços especiais. Se ela não atender, será necessário escolher e contratar a fonte de tarifas.

Responsabilidades: Operação/Comercial define modalidades, regiões, SLA e margem; Tecnologia integra e monitora; Financeiro concilia divergências; Produto define a experiência e mensagens. Nenhuma cobrança pode ser criada até que a opção escolhida seja revalidada no servidor.

### 7.2 Reserva de estoque durante o Pix

O helper atual em `_shared/shopify.ts` cria Draft Order pela API REST e **não configura reserva de estoque**. Portanto, hoje a reserva é zero.

A API GraphQL da Shopify permite informar [`reserveInventoryUntil`](https://shopify.dev/docs/api/admin-graphql/latest/mutations/draftOrderCreate) ao criar o Draft Order. O mesmo `DraftOrderInput` também é aceito por `draftOrderUpdate`, permitindo testar a extensão da reserva. A decisão técnica é binária:

1. migrar a criação de draft para GraphQL e reservar até a expiração do Pix, opção recomendada para validar em sandbox/development store; ou
2. não reservar, informar isso claramente ao comprador e manter um fluxo operacional de falta de estoque, substituição e estorno.

Se a opção com reserva for adotada, sua renovação acompanha a **sessão/reserva**, não necessariamente uma nova cobrança. `draftOrderUpdate` pode estender `reserveInventoryUntil` mantendo o mesmo Pix, desde que itens, valor e entrega continuem idênticos. A resposta da Shopify precisa ser confirmada antes de a interface prometer uma nova janela de reserva.

Nenhuma contagem regressiva pode prometer “produto reservado” sem a Shopify ter confirmado `reserveInventoryUntil`. Mesmo com reserva, o estoque deve ser revalidado antes da conclusão.

## 8. Asaas no backend

Segredos necessários no Supabase:

```text
PAYMENT_PROVIDER=asaas
ASAAS_API_KEY=...
ASAAS_API_URL=https://api-sandbox.asaas.com/v3
ASAAS_WEBHOOK_TOKEN=valor forte com no mínimo 32 caracteres
PAYMENT_WORKER_TOKEN=outro valor forte com no mínimo 32 caracteres
```

Nenhum desses valores pode usar prefixo `VITE_` ou aparecer no frontend.

Operações principais:

- criar/reutilizar cliente Asaas;
- criar cobrança com `externalReference` igual ao ID interno;
- obter QR Code Pix;
- criar cobrança com vencimento para franqueado;
- consultar e excluir cobrança pendente antes de substituí-la por outra tentativa;
- consultar status para reconciliação;
- estornar quando autorizado;
- validar e processar webhook.

O Asaas orienta cadastrar/reutilizar o cliente antes da cobrança, usar `externalReference` para conciliação e acompanhar o resultado por webhook. Referências: [clientes](https://docs.asaas.com/docs/criando-um-cliente), [criação de cobrança](https://docs.asaas.com/reference/criar-nova-cobranca), [exclusão de cobrança pendente](https://docs.asaas.com/reference/excluir-cobranca), [webhooks](https://docs.asaas.com/reference/criar-novo-webhook) e [eventos de cobranças](https://docs.asaas.com/docs/webhook-para-cobrancas).

### Contrato exato do webhook Asaas

- autenticar pelo header `asaas-access-token`, comparando-o com `ASAAS_WEBHOOK_TOKEN` em tempo constante;
- nunca usar `ASAAS_API_KEY` como token do webhook;
- ler o `id` do evento e inseri-lo em uma coluna `UNIQUE` antes de responder;
- uma reentrega do mesmo `id` deve responder 200 sem criar novo trabalho;
- responder **exatamente HTTP 200** depois que o evento estiver persistido;
- não usar 201 ou 204: embora pertençam à família 2xx, o Asaas atualmente os considera falha para sua fila de webhooks;
- não chamar Shopify, impressora, e-mail ou outras APIs dentro da requisição do webhook;
- permitir campos desconhecidos no JSON, pois o provedor pode acrescentar atributos ao payload.

Entrega `at least once` significa que o evento será entregue pelo menos uma vez e **pode** ser repetido; não significa que toda entrega será duplicada. O mesmo evento conserva o mesmo `id`. A estratégia oficial recomendada é persistir em uma tabela com chave única, responder 200 e processar depois por Cron/Worker. Referências: [idempotência em webhooks](https://docs.asaas.com/docs/how-to-implement-idempotence-in-webhooks), [FAQ](https://docs.asaas.com/docs/faq-de-webhooks) e [tipos de envio](https://docs.asaas.com/docs/tipos-de-envio).

Fluxo obrigatório:

```text
Asaas POST
  -> validar asaas-access-token com comparação timing-safe
  -> validar estrutura mínima (id + event)
  -> INSERT asaas_eventos ON CONFLICT (evento_id) DO NOTHING
  -> HTTP 200

worker agendado
  -> reivindicar eventos PENDING sem concorrência
  -> consultar estado atual da cobrança quando necessário
  -> aplicar transição financeira
  -> concluir/atualizar pedido Shopify
  -> liberar/bloquear franquia
  -> enfileirar impressão se elegível
  -> marcar PROCESSED ou registrar ERROR para retentativa
```

O helper `timingSafeEqual` já existe em `supabase/functions/_shared/webhook.ts` e deve ser reutilizado para o token do Asaas. A política HMAC da Shopify continua separada; o Asaas usa token compartilhado no header, não HMAC do corpo.

## 9. Checkout com o visual TudoPraPet

Rota proposta: `/checkout`.

Etapas visuais:

1. **Identificação**: nome, e-mail, telefone e CPF/CNPJ.
2. **Entrega**: endereço, CEP, opções de frete e retirada.
3. **Pagamento**: Pix, boleto ou cartão conforme perfil e configuração.
4. **Confirmação**: resumo, prazo, status e número do pedido.

Elementos permanentes:

- logo, cores e tipografia TudoPraPet;
- resumo fixo no desktop e recolhível no celular;
- preço original/desconto/preço final identificados;
- selo "Preço do Clube" ou "Preço de Franquia" quando aplicável;
- valor e prazo de entrega;
- mensagens de erro no campo correspondente;
- recuperação da sessão se a página for recarregada;
- acessibilidade de teclado, contraste e leitores de tela;
- nenhuma marca do provedor na estrutura da interface, salvo obrigação contratual/legal.

O frontend nunca recebe um resultado `paid` apenas porque uma requisição de pagamento respondeu 200. Ele mostra `processando` até a confirmação persistida pelo webhook.

## 10. Pix, boleto e cartão

### Pix

Pode usar integralmente o visual TudoPraPet. O backend cria a cobrança; o frontend recebe somente QR Code, código copia e cola, valor e expiração. O status vem do webhook.

### Boleto/prazo

O backend devolve a representação segura disponibilizada pelo provedor. Para franquia, o vencimento é calculado no servidor. A regra deve definir como tratar fins de semana e feriados antes da produção.

### Cartão transparente

É possível desenhar a tela com a identidade TudoPraPet, mas os dados do cartão ampliam significativamente o escopo de segurança e conformidade PCI. A API key fica no backend e o sistema deve seguir o método de tokenização/checkout transparente autorizado para a conta Asaas. A documentação do Asaas exige dados do titular e o IP real do comprador em operações de tokenização; a habilitação em produção pode depender de análise. Referência: [tokenização de cartão](https://docs.asaas.com/reference/tokenizacao-de-cartao-de-credito).

Decisão de segurança recomendada:

- MVP das fases 0 a 3: Pix no checkout próprio; quem escolher cartão continua no checkout legado da Shopify por uma flag específica de meio de pagamento;
- Fase 4, primeira entrega de cartão: página ou campos hospedados/tokenizados aprovados pelo provedor;
- evolução posterior: cartão totalmente transparente somente após validação PCI, antifraude, 3-D Secure quando aplicável e aprovação do fluxo pelo Asaas.

A flag não pode trocar todo o checkout enquanto o caminho de cartão ainda não existir. Ela deve permitir migração por perfil e por meio de pagamento, preservando a opção que o cliente já possui hoje.

Checkout com visual próprio não significa guardar número, CVV ou imagem do cartão. Esses dados nunca devem ser registrados em logs, banco, analytics, monitoramento ou suporte.

## 11. Modelo de dados proposto

### `checkout_sessions`

```text
id uuid primary key
user_id uuid nullable
checkout_version text
customer_type common|subscriber|franchise
status draft|awaiting_payment|payment_processing|paid|credit_approved|expired|cancelled|failed
currency text
subtotal numeric
discount numeric
shipping_amount numeric
total numeric
shipping_method text
shipping_code text
customer_snapshot jsonb
address_snapshot jsonb
items_snapshot jsonb
pricing_snapshot jsonb
shopify_draft_order_id text nullable
shopify_order_id text nullable
inventory_reserved_until timestamptz nullable
anonymous_access_token_hash text nullable unique
anonymous_access_token_expires_at timestamptz nullable
created_at timestamptz
session_expires_at timestamptz
```

### `payments`

```text
id uuid primary key
checkout_session_id uuid not null
attempt_number integer not null
is_active boolean default true
provider text
provider_customer_id text
provider_payment_id text unique
external_reference text unique
method pix|boleto|credit_card|terms
status pending|processing|cancellation_requested|confirmed|received|overdue|refunded|chargeback|cancelled|failed
amount numeric
due_date date nullable
provider_expires_at timestamptz nullable
confirmed_at timestamptz nullable
received_at timestamptz nullable
provider_deleted_at timestamptz nullable
raw_status text
created_at timestamptz
updated_at timestamptz
unique(checkout_session_id, attempt_number)
```

A relação é `checkout_sessions 1:N payments`. Cada geração ou regeneração de Pix cria uma tentativa nova; tentativas expiradas, canceladas ou falhas permanecem auditáveis com `is_active = false`. `external_reference` identifica a tentativa (`payment.id` ou `payment:<uuid>`), nunca a sessão inteira.

Deve existir no máximo uma tentativa ativa pendente por sessão:

```sql
create unique index payments_one_active_attempt
on payments (checkout_session_id)
where is_active and status in ('pending', 'processing', 'cancellation_requested');
```

O índice é a única autoridade sobre qual tentativa está ativa; não existe um segundo ponteiro em `checkout_sessions` que possa divergir. Incluir `cancellation_requested` impede uma nova cobrança enquanto a anterior ainda pode ser paga.

### `payment_events`

```text
id uuid primary key
provider text
provider_event_id text
event_type text
payload jsonb
received_at timestamptz
status text check (status in ('PENDING','PROCESSING','PROCESSED','ERROR'))
attempts integer default 0
next_attempt_at timestamptz nullable
locked_at timestamptz nullable
processed_at timestamptz nullable
processing_error text nullable
unique(provider, provider_event_id)
```

### `franchise_credit_accounts`

```text
user_id uuid primary key
payment_term_days integer default 7
credit_limit numeric nullable
block_on_any_open_invoice boolean default false
manually_blocked boolean default false
blocked_reason text nullable
blocked_at timestamptz nullable
updated_at timestamptz
```

Dados pessoais e payloads precisam de retenção definida, acesso administrativo restrito e logs sem segredos.

### Acesso anônimo e RLS

Uma compra anônima não possui `auth.uid()`, portanto `user_id nullable` sozinho não autoriza consulta segura. O mecanismo recomendado é:

1. `checkout-prepare` gera um token opaco aleatório de 32 bytes e o devolve uma única vez ao navegador;
2. o banco armazena somente o hash e a validade curta desse token;
3. o papel anônimo não recebe `SELECT` direto em `checkout_sessions`, `payments` ou `payment_events`;
4. `checkout-status` recebe `session_id` e o token bruto, calcula o hash, valida a expiração com comparação em tempo constante e usa service role somente depois dessa autorização;
5. a resposta é um DTO mínimo, sem payload do provedor, IDs internos sensíveis ou dados completos do cliente;
6. para usuário autenticado, a autorização continua baseada em `auth.uid() = user_id`;
7. depois da confirmação, o token de pagamento é rotacionado para um token somente de leitura do comprovante, com sobrevida definida — recomendação inicial de 72 horas — para que `/pedido-confirmado/:id` continue acessível;
8. o acesso posterior ocorre pela conta autenticada ou por link de pedido assinado e revogável enviado ao cliente, nunca mantendo indefinidamente o token do checkout.

Chave `service_role`, token de provedor e identificadores financeiros completos nunca são enviados ao navegador.

## 12. Edge Functions propostas

| Função | Responsabilidade |
|---|---|
| `checkout-prepare` | autenticar, validar itens, perfil, preço, estoque, entrega e bloqueio |
| `checkout-payment` | iniciar pagamento imediato ou cobrança com prazo usando o adaptador |
| `checkout-status` | devolver ao comprador somente o estado seguro da sessão |
| `asaas-webhook` | validar `asaas-access-token`, persistir idempotentemente e responder HTTP 200; nenhum trabalho externo |
| `asaas-process-events` | reivindicar e processar a inbox com retentativa, concluindo Shopify fora da requisição do webhook |
| `checkout-finalize-shopify` | criar/concluir o pedido exatamente uma vez |
| `payment-reconcile` | rotina agendada para corrigir webhook perdido e detectar vencimento |
| `admin-franchise-credit` | consultar, bloquear e desbloquear com auditoria |

Funções internas devem usar service role apenas depois da autenticação/autorização. O webhook valida o token, salva o evento e responde HTTP 200; todo trabalho pesado fica no worker idempotente.

`checkout-payment` deve serializar a criação por sessão: bloquear a sessão e reutilizar a tentativa ativa quando a requisição for repetida. Para regenerar, inicia a saga de cancelamento da tentativa anterior e só cria o próximo `attempt_number` após confirmar sua exclusão no Asaas e renovar a reserva Shopify, quando aplicável. Se uma resposta externa se perder, consulta primeiro pelo `provider_payment_id`/`externalReference` antes de repetir qualquer mutação.

## 13. Estados e transições

```text
draft
  -> awaiting_payment
      -> payment_processing
          -> paid -> shopify_created
          -> failed
      -> expired

payment attempt
  -> pending
      -> cancellation_requested -> cancelled -> próxima tentativa
      -> confirmed/received -> concluir checkout
  tentativa antiga/inativa -> confirmed/received -> concluir checkout uma vez

franchise approved
  -> credit_approved -> shopify_payment_pending
      -> paid
      -> overdue -> franchise_blocked
      -> cancelled
```

Uma transição para trás não pode ocorrer sem uma operação explícita. Por exemplo, um webhook atrasado de `pending` não pode rebaixar um pagamento já `received`. Estados financeiros confirmados têm precedência sobre `cancellation_requested`, `cancelled` e `is_active = false`, porque o pagamento pode ter ocorrido antes da exclusão e o webhook ter chegado depois.

## 14. Impressão e operação

Elegibilidade de impressão:

```text
cliente comum/assinante: payment_status in (confirmed, received)
franqueado: checkout_status = credit_approved e conta sem bloqueio no momento da aprovação
qualquer outro caso: não imprimir automaticamente
```

O pedido Shopify deve carregar `shipping_code` e `shipping_method` definidos no checkout. A etiqueta continua mostrando `RETIRADA`, `PAC`, `SEDEX` ou `MOTOBOY`. O retorno da impressora permanece independente do pagamento: primeiro o pedido torna-se elegível, depois entra na fila, e por fim o agente confirma sucesso/falha.

## 15. Segurança obrigatória

- API keys somente em secrets das Edge Functions.
- Recalcular todos os valores no servidor.
- Validar estoque antes de preparar e antes de finalizar.
- Limitar tentativas por IP, usuário, CPF e sessão.
- Usar idempotency key para criar cobrança e pedido.
- Validar token do webhook e rejeitar origem inválida.
- Nunca confiar em `customer_type`, desconto, frete ou total enviados pelo frontend.
- Nunca registrar dados completos de cartão ou CVV.
- Aplicar RLS; comprador só enxerga suas sessões.
- Guardar trilha de auditoria para bloqueio/desbloqueio e alteração de prazo.
- Fazer reconciliação agendada com o provedor.
- Ter alertas para webhook interrompido, divergência de valor e pedido pago sem Shopify ID.
- Comparar `asaas-access-token` com `timingSafeEqual`, sem registrar o token recebido ou esperado.

## 16. Tratamento de falhas

| Falha | Comportamento |
|---|---|
| Asaas indisponível antes de confirmar a criação | consultar pelo `externalReference` da tentativa antes de reenviar; só criar nova tentativa se a anterior for definitivamente inexistente, falha ou expirada |
| Pagou, mas Shopify falhou | marcar `paid_pending_shopify`, alertar e retentar sem cobrar novamente |
| Shopify criou, resposta se perdeu | consultar por atributo/idempotency key antes de criar outro pedido |
| Webhook duplicado | retornar 200 depois de detectar `provider_event_id` existente |
| Webhook perdido | rotina de reconciliação consulta cobranças pendentes |
| Worker falha ao chamar Shopify | manter evento em `ERROR`, aplicar backoff e responder 200 ao Asaas porque o evento já está durável |
| Pix antigo pago durante/depois da regeneração | aceitar o recebimento mesmo com tentativa inativa, concluir um único pedido e cancelar a tentativa substituta ainda pendente |
| Duas tentativas do mesmo checkout foram recebidas | concluir somente um pedido, bloquear segunda impressão e abrir ocorrência para estorno do excedente |
| Cancelamento Asaas ficou inconclusivo | não emitir novo QR Code; consultar o estado anterior e retomar a saga |
| Renovação da reserva Shopify falhou | não prometer reserva nem liberar a nova tentativa até corrigir ou obter consentimento explícito para seguir sem reserva |
| Estoque acabou antes de pagar | impedir conclusão automática, abrir exceção operacional e oferecer estorno/substituição |
| Franqueado venceu | bloquear novas sessões e mostrar instruções para quitar |
| Pagamento vencido foi quitado | webhook/reconciliação desbloqueia se não houver outra pendência |

## 17. Plano de implementação

### Fase 0 — definições comerciais

- estabelecer deploy próprio de migrations e Edge Functions, staging, secrets, smoke test e rollback conforme a seção 22;
- escolher bloqueio somente no vencimento ou com qualquer título aberto;
- definir dias corridos ou úteis para franquia;
- definir meios de pagamento por perfil;
- executar o spike de frete e escolher sua fonte de tarifas;
- medir no Sandbox a validade real do QR Pix com chave configurada, após `dueDate` e após a janela visual da sessão;
- testar criação e extensão de `reserveInventoryUntil` por `draftOrderCreate`/`draftOrderUpdate`;
- escolher entre Draft Order GraphQL com reserva renovável ou Pix sem reserva;
- definir cancelamento, estorno e chargeback;
- confirmar requisitos PCI e antifraude do cartão.

### Fase 1 — fundação

- migrations e RLS;
- implementar tentativas de pagamento `1:N` e acesso anônimo por token opaco;
- interface `PaymentProvider` e adaptador sandbox Asaas;
- `checkout-prepare`, `checkout-status`, inbox do webhook e worker;
- idempotência, auditoria e reconciliação;
- testes automatizados de preço e bloqueio.

### Fase 2 — checkout visual e Pix

- rota `/checkout` responsiva;
- identificação, endereço, entrega e resumo;
- Pix com QR Code/copia e cola;
- confirmação por webhook;
- criação Shopify e impressão elegível.

### Fase 3 — assinantes e franquias

- reutilizar as regras atuais de elegibilidade e preço especial;
- prazo de 7 dias;
- bloqueio transacional;
- painel de contas a receber e desbloqueio;
- mensagens e e-mails de vencimento.

### Fase 4 — cartão

- validar modelo aprovado pelo Asaas;
- PCI, antifraude, 3DS e tratamento de recusa;
- estorno e chargeback;
- testes de segurança e produção controlada.

### Fase 5 — migração

- ativar por feature flag para equipe interna;
- liberar para pequena porcentagem;
- comparar total, estoque, pagamento, pedido e impressão;
- manter rollback para `checkoutUrl` atual;
- retirar fluxo antigo somente após estabilidade comprovada.

### Estimativa inicial

Estimativa de planejamento revisada após inspecionar o código existente, para aproximadamente uma pessoa técnica dedicada com apoio de revisão, sem contar esperas por aprovação do Asaas, contratação de frete ou decisões comerciais:

| Fase | Estimativa |
|---|---:|
| Fase 0 — deploy independente, decisões e três spikes | 2–4 dias úteis |
| Fase 1 — fundação segura | 4–7 dias úteis |
| Fase 2 — checkout visual e Pix | 4–7 dias úteis |
| Fase 3 — assinantes e franquias | 3–6 dias úteis |
| Fase 4 — cartão | 1–3 semanas, além de aprovações externas |
| Fase 5 — rollout e estabilização | 3–8 dias úteis |

Como o projeto já possui carrinho, autenticação, preços especiais, Draft Order Shopify, pedidos e impressão, o MVP com Pix para comum/assinante e prazo para franquia tende a ocupar **3–5 semanas corridas**. Cartão acrescenta aproximadamente **1–3 semanas** de implementação, além de eventual aprovação externa. Uma integração de frete nova pode acrescentar **1–2 semanas**. As faixas devem ser recalibradas depois dos três spikes.

## 18. Critérios de aceite

- O checkout inteiro usa identidade visual TudoPraPet.
- Nenhum segredo aparece no navegador ou build.
- Alterar total/preço pelo DevTools não altera a cobrança.
- Assinante ativo recebe exatamente o preço do clube.
- Cliente comum não recebe desconto de assinante/franquia.
- Franqueado regular recebe prazo e pedido pendente.
- Franqueado vencido não consegue criar outro pedido nem por chamadas diretas.
- Pagamento confirmado cria apenas um pedido Shopify.
- Webhook repetido não duplica cobrança, pedido ou impressão.
- O checkout reutiliza a cobrança Pix válida e não mostra contador inventado diferente de `expirationDate` do Asaas.
- Uma substituição excepcional do Pix não libera o novo QR Code antes de resolver a cobrança anterior no Asaas.
- `cancellation_requested` travado é retentado, alertado e explicado na interface.
- Pagamento confirmado de tentativa antiga/inativa continua concluindo o checkout exatamente uma vez.
- Dois pagamentos recebidos para a mesma sessão geram um pedido e uma ocorrência de estorno, nunca dois pedidos.
- Quando houver reserva, ela pode ser renovada sem recriar a cobrança e a interface só promete a janela confirmada pela Shopify.
- O webhook responde HTTP 200 depois do insert e não espera nenhuma resposta da Shopify.
- Respostas 201/204 não são usadas no endpoint Asaas.
- Um evento com Shopify indisponível permanece retentável no banco.
- `Shop location`, `pick_up` e retirada explícita aparecem como `RETIRADA`.
- Pedido comum/assinante pendente não imprime.
- Pedido de franquia com crédito aprovado pode imprimir antes da quitação.
- Cliente que escolher cartão antes da Fase 4 continua tendo acesso ao checkout legado.
- Compra imediata de `ProductDetail.tsx`, carrinho e gaveta usam a mesma regra server-side.
- Comprador anônimo consegue abrir a confirmação durante a sobrevida do token somente de leitura.
- Falha entre pagamento e Shopify aparece no painel operacional e é retentada.
- Trocar o adaptador financeiro não exige reconstruir o checkout.

## 19. Pendências que precisam de decisão antes do código

1. Franqueado pode fazer vários pedidos durante os sete dias ou apenas um por vez?
2. O prazo usa dias corridos ou dias úteis?
3. Qual meio será oferecido ao franqueado: boleto, Pix com vencimento ou ambos?
4. O checkout migrará o Draft Order para GraphQL, renovando `reserveInventoryUntil` durante a sessão, ou assumirá explicitamente que não há reserva?
5. O assinante pode usar cupom junto com o preço do clube?
6. Quem pode desbloquear manualmente uma franquia e qual justificativa é obrigatória?
7. Em qual status financeiro a operação deve separar/imprimir pedidos pagos por cartão sob análise?
8. O cartão da primeira versão será hospedado/tokenizado pelo provedor ou transparente sob escopo PCI validado?
9. Qual fonte calculará frete: opções Shopify, transportadora/agregador ou tabela própria?
10. O webhook Asaas começará em modo sequencial, conforme recomendação abaixo?
11. Depois do spike, pagamento posterior ao fim da reserva será aceito com tratamento de falta de estoque ou a cobrança será excluída automaticamente junto com a reserva?

Decisões já fechadas para o MVP:

- Stripe continua cuidando da recorrência do Clube;
- Asaas cuida das compras de produtos e do prazo dos franqueados;
- os endpoints antigos de assinante/franqueado coexistem atrás de flag e só são aposentados após rollout estável;
- cliente anônimo consulta status somente pela Edge Function com token opaco; não há leitura anônima direta via RLS.

## 20. Operação da fila Asaas

O Asaas interrompe a fila de um webhook depois de 15 falhas consecutivas. Enquanto interrompida, novos eventos continuam sendo criados, mas deixam de ser enviados. Eventos com mais de 14 dias são apagados permanentemente. A reativação pode ser feita no painel ou atualizando o webhook com `interrupted: false`, sempre depois de corrigir a causa. Referências: [fila pausada](https://docs.asaas.com/docs/fila-pausada), [reativar fila](https://docs.asaas.com/docs/como-reativar-fila-interrompida) e [logs](https://docs.asaas.com/docs/logs-de-webhooks).

Responsabilidades que precisam ter nome antes da produção:

| Responsabilidade | Responsável definido antes do go-live |
|---|---|
| E-mail cadastrado no webhook | pessoa que acompanha diariamente e substituto |
| Alerta de fila interrompida | responsável operacional com acesso ao Asaas |
| Evento `ERROR` por mais de 15 minutos | responsável técnico |
| `cancellation_requested` por mais de 15 minutos | responsável técnico; `payment-reconcile` continua retentando com backoff |
| Pagamento sem pedido Shopify | operação + responsável técnico |
| Pagamento duplicado | Financeiro como dono e Operação como substituto; alerta imediato, contato com o cliente em até 1 hora útil e início do estorno em até 4 horas úteis |
| Reativação da fila | somente após correção e teste do endpoint |
| Reconciliação diária | job monitorado, com alerta se não executar |

Controles mínimos:

- alerta quando houver qualquer falha consecutiva, sem esperar chegar a 15;
- alerta de evento `PENDING/ERROR` acima do tempo esperado;
- alerta de cancelamento pendente e pagamento duplicado, sem depender de conferência manual;
- painel com idade do evento mais antigo;
- verificação diária do campo `interrupted` do webhook;
- runbook para corrigir, testar com evento controlado e somente então reativar;
- conciliação por consulta à API para cobrir eventos definitivamente perdidos depois de 14 dias.

### Entrega sequencial ou não sequencial

O Asaas permite configurar o webhook com envio sequencial ou não sequencial. O sequencial preserva a ordem, mas um evento problemático pode segurar os seguintes; o não sequencial aumenta o paralelismo, porém não garante ordem.

Como o endpoint proposto faz somente validação, insert idempotente e resposta 200, a recomendação para o volume inicial é **começar sequencial**. Ainda assim, o worker deve aceitar eventos fora de ordem, aplicar transições monotônicas e consultar o estado atual da cobrança quando houver conflito. Se o volume justificar mudar para não sequencial, essas garantias tornam-se obrigatórias e a mudança deve ser registrada como decisão operacional.

## 21. Teste seguro do Draft Order

Não executar `draftOrderComplete` diretamente em um draft arbitrário da loja de produção como primeiro teste: completar um draft cria um pedido real e pode reservar/baixar estoque, acionar e-mail, automação, impressão e integrações.

Ordem segura:

1. testar o adaptador e webhook no Sandbox Asaas;
2. testar GraphQL e permissões Shopify com uma consulta sem mutação;
3. preferir uma development store Shopify isolada;
4. se for inevitável testar em produção, criar um produto/variante exclusiva de teste sem automações e um Draft Order identificado como `TESTE_NAO_EXPEDIR`;
5. desativar impressão, notificações e fulfillment automáticos para esse teste;
6. revisar mutation e variáveis antes de executar;
7. confirmar o resultado e cancelar/estornar pelo fluxo correto, preservando auditoria.

A chamada de teste deve ser preparada somente depois dessas salvaguardas e nunca deve imprimir ou completar um pedido real sem aprovação explícita.

## 22. Deploy independente do Lovable

O processamento financeiro não pode depender exclusivamente do mecanismo de publicação do frontend. O repositório já demonstrou que Git Sync, Publish e deploy de Edge Function são etapas diferentes. Para pagamentos, é obrigatório ter um caminho próprio e reproduzível de deploy.

Requisitos:

- Supabase CLI autenticado para o projeto correto;
- ambientes separados de sandbox/staging e produção;
- deploy explícito das migrations e Edge Functions;
- secrets configurados fora do Git;
- versão observável em header/health check;
- smoke test automatizado depois de cada deploy;
- rollback documentado para a versão anterior;
- permissão de deploy para ao menos duas pessoas responsáveis.

Pipeline conceitual:

```text
testes + typecheck
  -> migrations staging
  -> deploy functions staging
  -> teste webhook sandbox + worker
  -> aprovação manual
  -> migrations produção
  -> deploy functions produção
  -> smoke test sem criar pedido real
  -> monitoramento reforçado
```

O Lovable pode continuar publicando o frontend, mas uma indisponibilidade ou atraso nele não pode impedir a correção urgente de `asaas-webhook`, `asaas-process-events` ou `payment-reconcile` enquanto corre a retenção de 14 dias.
