# Smoke test das edge functions

Como exercitar as edge functions localmente sem tocar em nada de produção, e o que foi
verificado em 04/08/2026.

Cobre `shopify-pickup-webhook` (parte 1) e os dois checkouts (parte 2).

## Por que não `supabase functions serve`

Ele exige Docker. As edge functions são só módulos Deno com `Deno.serve`, então dá para
rodá-las direto — mais rápido e sem dependência extra.

## A regra de segurança

> **Não defina `SHOPIFY_ACCESS_TOKEN` nem os tokens da Storefront.**

Sem eles nenhuma chamada à Shopify acontece, e os fluxos param antes de criar ou alterar
qualquer coisa. Combinado com apontar `EXTERNAL_API_BASE_URL` e `SUPABASE_URL` para
servidores locais, **nada sai da máquina**.

Com os valores de produção, estas functions **mandam WhatsApp de verdade e criam Draft
Order de verdade**.

---

# Parte 1 — `shopify-pickup-webhook`

## Como reproduzir

### 1. Servidor que finge ser a API externa

```ts
// fake-external-api.ts — em qualquer pasta fora do repositório
Deno.serve({ port: 9099 }, async (req) => {
  const url = new URL(req.url);
  const body = await req.json().catch(() => null);
  console.log(`\n>>> ${req.method} ${url.pathname}`);
  console.log(JSON.stringify(body, null, 2));
  if (url.pathname === "/api/whatsapp/send") {
    return Response.json({ ok: true, pickup_code: "TESTE123" });
  }
  return Response.json({ ok: true });
});
```

```bash
deno run --allow-net fake-external-api.ts
```

### 2. A function, apontando para ele

```bash
unset SHOPIFY_ACCESS_TOKEN
export EXTERNAL_API_BASE_URL="http://localhost:9099"
export EXTERNAL_API_TOKEN="fake-token"
export SHOPIFY_WEBHOOK_SECRET="segredo-de-teste"
export SHOPIFY_WEBHOOK_HMAC_MODE="monitor"
deno run --allow-net --allow-env supabase/functions/shopify-pickup-webhook/index.ts
```

Sobe em `http://localhost:8000`.

### 3. Disparar um evento

```bash
curl -X POST http://localhost:8000 \
  -H "Content-Type: application/json" \
  -H "x-shopify-topic: fulfillment_orders/line_items_prepared_for_pickup" \
  -H "x-shopify-shop-domain: petjoy-deals-hb8r9.myshopify.com" \
  -d '{"fulfillment_order":{"id":999,"order_id":12345,"delivery_method":{"method_type":"pick_up"}},"order_number":"1042","customer":{"first_name":"Maria","phone":"18999991234"}}'
```

## Resultados

| Caso | Tópico / payload | Esperado | Obtido |
|---|---|---|---|
| Retirada | `..._prepared_for_pickup`, `method_type: pick_up` | envia | ✅ enviou |
| Entrega | mesmo tópico, `method_type: shipping` | ignora | ✅ `not a pickup order (method_type=shipping)` |
| Atualização | `fulfillments/update` | ignora | ✅ `unhandled (topic=fulfillments/update)` |
| Pedido criado | `orders/create` | `order_created` | ✅ |
| Mesmo pedido, outro tópico | `fulfillments/create` do pedido 12345 | mesma `idempotency_key` | ✅ idêntica |

O último caso é o que valida a idempotência: dois tópicos diferentes produziram
`order_ready_for_pickup:12345`, variando apenas `source_topic`. É isso que permite à API
externa descartar a repetição sem perder o diagnóstico.

O caminho *fail-open* também foi exercitado: sem `SHOPIFY_ACCESS_TOKEN` a function não
consegue determinar o método de entrega, registra
`Delivery method indeterminado para o pedido 12345 — enviando mesmo assim` e prossegue.

### Verificação do HMAC

Esta é a parte que **nenhum teste unitário cobre** — os testes validam a política de
decisão (`decideHmac`), não o cálculo criptográfico. Se a assinatura fosse calculada
errado, ligar `enforce` derrubaria o fluxo inteiro.

A assinatura foi calculada com `openssl` (ferramenta independente, mesmo algoritmo da
Shopify: HMAC-SHA256 sobre o corpo bruto, em base64):

```bash
printf '%s' "$BODY" | openssl dgst -sha256 -hmac "segredo-de-teste" -binary | openssl base64
```

Com `SHOPIFY_WEBHOOK_HMAC_MODE=enforce`:

| Cenário | Resposta | Log |
|---|---|---|
| Assinatura correta | **200** | `result=valid action=accept` |
| Assinatura errada | **401** | `result=invalid-rejected action=reject` |
| Sem assinatura | **401** | `result=invalid-rejected action=reject` |

**Conclusão: a verificação está correta.** Ligar `enforce` é seguro do ponto de vista do
código; o que falta é confirmar em produção, pelos logs em `monitor`, que o
`SHOPIFY_WEBHOOK_SECRET` configurado é o certo.

---

# Parte 2 — `subscriber-checkout` e `franchise-checkout`

São o caminho do dinheiro: criam Draft Order real na Shopify. Também são as functions
mais reescritas (207 e 193 linhas viraram 25 e 22, sobre `_shared/checkout.ts`), então
importa provar que a parametrização das duas está correta.

## Método

Um **Supabase falso** responde `/auth/v1/user` e `/rest/v1/*`, escolhendo o
comportamento pelo token enviado — assim dá para testar todos os cenários sem reiniciar:

| Token | Usuário |
|---|---|
| `tok-membro` | é membro do clube |
| `tok-naomembro` | não é membro |
| `tok-franqueado` | é franqueado |
| `tok-comum` | não é nada |
| qualquer outro | token inválido |

O ponto de parada é o **token da Storefront**: deixando-o indefinido, o fluxo percorre
autenticação, elegibilidade, validação de entrada e busca de preço no banco, e para com
`Token Storefront ausente` — exatamente antes da primeira chamada à Shopify.

```bash
unset SHOPIFY_ACCESS_TOKEN SHOPIFY_STOREFRONT_ACCESS_TOKEN SHOPIFY_STOREFRONT_TOKEN
export SUPABASE_URL="http://localhost:9098"
export SUPABASE_ANON_KEY="anon-falsa"
export SUPABASE_SERVICE_ROLE_KEY="service-falsa"
deno run --allow-net --allow-env supabase/functions/subscriber-checkout/index.ts
```

O código do Supabase falso está no histórico desta sessão; reconstruí-lo é trivial —
duas rotas e um mapa de tokens.

## Resultados

| Caso | `subscriber-checkout` | `franchise-checkout` |
|---|---|---|
| OPTIONS | ✅ 200 `ok` | — |
| Sem `Authorization` | ✅ 401 `Não autorizado` | ✅ 401 |
| Token inválido | ✅ 401 | — |
| Autenticado, sem direito | ✅ 403 `Você não é membro do clube` | ✅ 403 `Usuário não é franqueado` |
| Membro do clube no checkout de franquia | — | ✅ 403 (não vaza entre os dois) |
| Carrinho vazio | ✅ 400 `Carrinho vazio` | ✅ 400 |
| `variantId` malformado (`"111"`) | ✅ 400 `Identificador de produto inválido` | — |
| `variantId` de Product, não Variant | ✅ 400 | — |
| Quantidade negativa | ✅ 400 `entre 1 e 10000` | ✅ 400 |
| Quantidade fracionária | ✅ 400 `Quantidade inválida` | — |
| Quantidade absurda (99999) | ✅ 400 | — |
| Carrinho válido | ✅ 500 `Token Storefront ausente` | ✅ idem |

O último caso é o que prova o percurso completo: passou por tudo e parou no ponto certo.

## Duas verificações que só apareceram nos logs

**A normalização do e-mail funciona.** O usuário falso tem e-mail `Membro@Teste.COM`, e a
consulta saiu como `email=eq.membro%40teste.com`. O `toLowerCase()` que a refatoração
preservou está valendo de ponta a ponta.

**As duas functions consultam tabelas e colunas diferentes, apesar do código comum:**

```
subscriber-checkout → club_members (por email)  +  subscriber_prices (coluna subscriber_price)
franchise-checkout  → profiles (por user_id)    +  franchise_prices  (coluna price)
```

Era o principal risco da unificação, e está correto.

**Campos extras são descartados.** Enviando `{"variantId": ..., "quantity": 1, "price": 0.01, "admin": true}`,
a validação aceitou o item e repassou apenas `variantId` e `quantity`.

---

---

# Parte 3 — Como saber o que está publicado

## Sincronizar código não é publicar function

São mecanismos separados, e essa distinção custou horas de confusão em 04/08/2026.

O Lovable puxa os commits do GitHub para o workspace dele — os arquivos aparecem no
editor, corretos. Mas o **deploy** das edge functions só acontece quando ele mesmo edita
uma function pelo pipeline dele. Mudança que chega de fora, por Pull Request, fica no
editor e **não vai ao ar**.

O resultado é o pior tipo de falha: silenciosa. O código está certo no repositório, certo
no GitHub, certo dentro do Lovable — e o que roda em produção é outra coisa. Ninguém
percebe, porque não há nada visivelmente errado em lugar nenhum.

## Como verificar, sem precisar de credencial

Nem todo mundo do time tem acesso ao painel do Supabase. Este teste não precisa de
nenhum: um `OPTIONS` não processa corpo, não dispara nada, e devolve os cabeçalhos CORS
que a própria function monta.

```bash
curl -s -i -X OPTIONS https://smvtnflhkvxdmvqbxwrf.supabase.co/functions/v1/shopify-pickup-webhook | grep -i access-control-allow-headers
```

Confirme que é a function respondendo, e não o gateway, procurando estes cabeçalhos na
resposta completa:

```
x-served-by: supabase-edge-runtime
x-deno-execution-id: ...
```

Para varrer várias de uma vez:

```bash
for fn in shopify-pickup-webhook customer-portal check-subscription subscriber-checkout pickup-validate; do printf "%-24s " "$fn"; curl -s -i -X OPTIONS "https://smvtnflhkvxdmvqbxwrf.supabase.co/functions/v1/$fn" | grep -i "access-control-allow-headers"; done
```

## Como escolher o que observar

O truque é achar **qualquer diferença observável** entre a versão que você quer publicar
e a que está no ar. Em agosto/2026 serviu o `x-retry-count`: ele passou a existir quando
o `corsHeaders` foi centralizado em `_shared/cors.ts`, e não existia antes.

**Esse sinal expira.** Depois que a versão nova subir, `x-retry-count` estará sempre
presente e não distingue mais nada. Para o próximo deploy é preciso escolher outro
discriminador — o que mudou naquela entrega.

Se o time quiser algo permanente, a saída é embutir um **marcador de versão** nas
functions: uma constante em `_shared/cors.ts` devolvida como cabeçalho, atualizada a cada
entrega. Custa disciplina, mas troca "descobrir um discriminador" por "ler um número".

## O que foi encontrado em 04/08/2026

Todas as cinco functions sondadas responderam a lista antiga de cabeçalhos:

```
authorization, x-client-info, apikey, content-type,
x-shopify-hmac-sha256, x-shopify-topic, x-shopify-shop-domain
```

Como a centralização do `corsHeaders` foi uma das primeiras mudanças da leva, a versão
publicada era anterior a praticamente todo o trabalho. **Não houve deploy nenhum** — não
foi uma mudança específica que ficou de fora.

Descartadas por verificação direta, para o registro:

- **Codebase do Lovable × repositório:** todos os `.ts`, `.tsx` e `.sql` de `src/` e
  `supabase/` comparados. Zero diferenças, nenhum arquivo a mais ou a menos.
- **Configuração:** `project_id`, `.env` e a URL do webhook registrada na Shopify apontam
  todos para o mesmo projeto.
- **Código órfão:** a mensagem antiga do HMAC não existe em nenhum arquivo da codebase.

## Soluções possíveis

Em ordem de esforço.

### 1. Pedir ao Lovable que publique

Único caminho que funciona hoje. Peça pelo chat dele que faça o deploy das edge
functions. Se ele alegar que não há o que mudar, force com algo mínimo e observável —
um comentário em `_shared/cors.ts`, que é o arquivo de menor risco.

*Vantagem:* imediato, sem depender de acesso novo.
*Limite:* manual, sem garantia de que publica tudo, e precisa ser lembrado a cada PR.

### 2. Obter acesso ao projeto Supabase

Com um `SUPABASE_ACCESS_TOKEN` do projeto, qualquer pessoa do time publica:

```bash
npx supabase functions deploy --project-ref smvtnflhkvxdmvqbxwrf
```

*Vantagem:* destrava tudo, inclusive CI.
*Limite:* depende do que o plano do Lovable Cloud permite. Vale perguntar ao suporte.

### 3. CI que publica no merge

Um GitHub Action rodando `supabase functions deploy` quando `supabase/functions/**` muda
na `main`. **Depende da solução 2** — sem o token, não há como.

*Vantagem:* fecha a lacuna permanentemente; ninguém precisa lembrar.
*Limite:* todo merge vai direto a produção. É uma decisão de postura, não só técnica.

### 4. Migrar para um Supabase próprio

Sair do Supabase gerido pelo Lovable e usar um projeto do time.

*Vantagem:* controle total, CI, acesso a logs para todos.
*Limite:* é uma migração de verdade — banco, secrets, storage, auth.

### 5. Trabalhar só pelo Lovable

Aceitar que ele é o único caminho e que o Git vira histórico.

*Vantagem:* nenhuma mudança de processo.
*Limite:* Pull Request e revisão de código passam a ser decorativos — o que é revisado
não é o que roda. Foi essa divergência que gerou o problema.

### Recomendação

A 1 resolve hoje. A 2 é o que vale perguntar em seguida, porque destrava a 3 — e a 3 é a
única que impede o problema de voltar. A 4 só se a 2 for negada e o time considerar o
risco inaceitável. A 5 é o que acontece por omissão se ninguém decidir nada.

---

## O que estes testes NÃO cobrem

- **Nada da Shopify real.** Busca de pedido, método de entrega, gravação em
  `note_attributes`, preços da Storefront, criação de cliente e de Draft Order — tudo
  pulado por não haver token.
- **O contrato da API externa.** O servidor falso devolve `pickup_code`, mas não se sabe
  se a API real usa esse nome, nem em quais eventos devolve código.
- **RLS do Postgres.** O Supabase falso não aplica política nenhuma.
- **Qualquer coisa visual.** Nenhuma tela foi aberta.
