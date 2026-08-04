# Smoke test do webhook de retirada

Como exercitar `shopify-pickup-webhook` localmente sem tocar em nada de produção,
e o que foi verificado em 04/08/2026.

## Por que não `supabase functions serve`

Ele exige Docker. As edge functions são só módulos Deno com `Deno.serve`, então dá para
rodá-las direto — mais rápido e sem dependência extra.

## A regra de segurança

> **Não defina `SHOPIFY_ACCESS_TOKEN`.**

Sem ele, a function não faz nenhuma chamada à Shopify: pula a busca do pedido, pula a
resolução do método de entrega e pula a gravação do código no pedido. Combinado com
apontar `EXTERNAL_API_BASE_URL` para um servidor local, **nada sai da máquina** — e,
principalmente, nenhum WhatsApp é enviado a cliente real.

Com os valores de produção, esta function **manda mensagem de verdade**.

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

## O que este teste NÃO cobre

- **Nada da Shopify real.** Busca de pedido, resolução do método de entrega pela Admin
  API e gravação em `note_attributes` foram todas puladas por não haver token.
- **O contrato da API externa.** O servidor falso devolve `pickup_code`, mas não se sabe
  se a API real usa esse nome, nem em quais eventos ela devolve código.
- **As functions de checkout.** `subscriber-checkout` e `franchise-checkout` exigem sessão
  Supabase válida; não foram exercitadas.
- **Qualquer coisa visual.** Nenhuma tela foi aberta.
