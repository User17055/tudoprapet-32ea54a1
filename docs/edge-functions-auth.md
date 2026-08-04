# Matriz de autenticação — Edge Functions

Como cada uma das 13 edge functions controla acesso, quem a chama, e o que ainda
está em aberto.

## Como o Supabase realmente protege uma function

Pré-requisito pra ler a tabela.

Por padrão o Supabase aplica `verify_jwt = true`: a plataforma exige um JWT válido,
assinado pelo segredo do projeto, no header `Authorization`. O `supabase/config.toml`
só desliga isso para `shopify-pickup-webhook`.

**Mas a `anon key` é um JWT válido** — e ela é pública, está no bundle do frontend
(`VITE_SUPABASE_PUBLISHABLE_KEY`). Ou seja:

> `verify_jwt` prova apenas que quem chamou tem a chave pública. Não prova que existe
> um usuário logado, e muito menos *qual* usuário.

Quando o front usa `supabase.functions.invoke()`, o header vai com o JWT da sessão se
houver login, e com a `anon key` caso contrário. Cabe à própria function distinguir os
dois casos.

Todas as 13 respondem `Access-Control-Allow-Origin: *`, então são chamáveis de
qualquer origem.

## O padrão da casa

Implementado em [`_shared/auth.ts`](../supabase/functions/_shared/auth.ts):

```ts
// exige usuário autenticado
const authResult = await requireUser(req);
if (!authResult.ok) return authResult.response;
const { userId, email } = authResult.auth;

// ou exige admin (chama requireUser por dentro e checa has_role)
const authResult = await requireAdmin(req);
if (!authResult.ok) return authResult.response;
```

Três regras, nesta ordem:

1. **Identidade vem do JWT**, nunca do corpo da requisição.
2. **Papel é checado via `has_role`**, nunca via campo do perfil.
3. **`service_role` só é criado depois** da autorização.

## A matriz

| Function | Autenticação | Papel exigido | `service_role` | Quem chama |
|---|---|---|:--:|---|
| `subscriber-checkout` | JWT | membro do clube | ✅ | CartDrawer, Cart, ProductDetail |
| `franchise-checkout` | JWT | `is_franchisee` | ✅ | CartDrawer, Cart, ProductDetail |
| `customer-orders` | JWT | — (só o próprio) | ❌ | MeusPedidos, Profile |
| `check-subscription` | JWT | — (só o próprio) | ✅ | SubscriptionContext |
| `create-checkout` | JWT | — (só o próprio) | ❌ | *ninguém* |
| `customer-portal` | JWT | — (só o próprio) | ❌ | *ninguém* |
| `pickup-validate` | JWT | admin | ❌ | RetiradaTab |
| `pickup-complete` | JWT | admin | ❌ | RetiradaTab |
| `pickup-history` | JWT | admin | ❌ | RetiradaTab |
| `pickup-resend-last` | JWT | admin | ❌ | RetiradaTab |
| `pickup-test-send` | JWT | admin | ❌ | *ninguém* |
| `shopify-webhooks-admin` | JWT | admin | ❌ | *ninguém* |
| `shopify-pickup-webhook` | **HMAC** (ver abaixo) | n/a | ❌ | Shopify |

`subscriber-checkout` e `franchise-checkout` delegam para `_shared/checkout.ts`.

## Em aberto

### `shopify-pickup-webhook` — HMAC calculado e descartado

É a única sem JWT, o que é **correto** para um webhook: a autenticação de webhook é a
assinatura HMAC, não JWT. O problema é que a assinatura é verificada e o resultado
ignorado:

```ts
if (!valid) {
  console.warn("HMAC inválido — prosseguindo mesmo assim (verificação desabilitada temporariamente)");
}
```

O processamento continua mesmo com assinatura inválida. Como a function repassa o
evento para a API externa — que gera o código de retirada e dispara o WhatsApp — um
payload forjado vira mensagem real no telefone que o atacante escolher, com um código
de retirada válido junto.

**Não corrigir sem coordenar.** O comentário diz "temporariamente", então foi um
contorno de setup. Se `SHOPIFY_WEBHOOK_SECRET` estiver ausente ou errado em produção,
passar a rejeitar derruba o fluxo de retirada inteiro.

Caminho seguro: primeiro registrar em log se o HMAC *bateria*, sem bloquear; observar
alguns dias; só então passar a rejeitar.

### Quatro functions sem chamador

`create-checkout`, `customer-portal`, `pickup-test-send` e `shopify-webhooks-admin`
não são chamadas pelo frontend. Agora estão autenticadas, mas continuam publicadas.

`customer-portal` redireciona para `${origin}/clube` — rota que **não existe** em
`App.tsx`. Somado a `create-checkout` também estar órfã, o quadro sugere que a tela de
assinatura do clube foi removida e as functions ficaram para trás.

`check-subscription` continua em uso: a associação ao clube ainda governa preço, mesmo
sem a tela de gestão.

**Decisão pendente:** remover as órfãs ou restaurar a tela `/clube`?

### `shopify-webhooks-admin` virou admin-only

Antes respondia a qualquer requisição via query string (`?action=list_orders`,
`?action=delete&id=`). Se alguém usava isso pelo navegador para depurar, agora precisa
de sessão de admin — vale avisar quem usava.

## O fluxo de retirada mora fora deste repositório

Vale destacar porque não é óbvio lendo o código: **nenhuma das functions de retirada
grava em tabela do Supabase**. Elas são um proxy autenticado para uma API externa, que
é quem gera, guarda e valida o código de retirada.

| Function | Encaminha para |
|---|---|
| `shopify-pickup-webhook` | `POST {EXTERNAL_API_BASE_URL}/api/whatsapp/send` |
| `pickup-resend-last` | `POST {EXTERNAL_API_BASE_URL}/api/whatsapp/send` |
| `pickup-test-send` | `POST {EXTERNAL_API_BASE_URL}/api/whatsapp/send` |
| `pickup-validate` | `POST {EXTERNAL_API_BASE_URL}/api/pickup/validate` |
| `pickup-complete` | `POST {EXTERNAL_API_BASE_URL}/api/pickup/complete` + fulfillment na Shopify |

Autenticação nessa API é por header `X-API-Key` (`EXTERNAL_API_TOKEN`).

Houve uma tentativa de guardar isso no Postgres: a tabela `pickup_codes` foi criada na
migration `20260708144427` e **derrubada 47 minutos depois** pela `20260708153152`.
Ficou o desenho atual, com o estado inteiramente na API externa.

`pickup-complete` tem `https://andrejrs.com.br` hardcoded como fallback caso
`EXTERNAL_API_BASE_URL` não esteja definida — as outras quatro falham explicitamente
quando falta a variável. Convém padronizar.

**Consequência prática:** se a API externa cair, o fluxo de retirada para por completo,
e não há registro no Supabase para reconstruir o que aconteceu.

## Perguntas para o time

1. As quatro órfãs devem ser removidas, ou a tela `/clube` volta?
2. O `SHOPIFY_WEBHOOK_SECRET` está configurado e correto em produção?
3. O `CORS *` é necessário, ou dá pra restringir aos domínios da loja?
4. Existe secret com nome `SHOPIFY_ONLINE_ACCESS_TOKEN:user:4HrJkQRl3KUXTrTOAgUkwQSkHWo2`
   (fallback em `subscriber-checkout`), ou é resquício de setup manual?

## Notas

`pickup-validate`, `pickup-complete` e `pickup-history` usam `auth.getClaims()` +
`has_role` diretamente, em vez de `requireAdmin`. São equivalentes; ficaram como
estavam para não mexer em autenticação que já funciona. Convergir depois é seguro,
mas é mudança sem ganho funcional.

## Como reproduzir a tabela

```bash
for d in supabase/functions/*/; do
  f="$d/index.ts"; [ -f "$f" ] || continue
  echo "$(basename $d): \
user=$(grep -cE 'requireUser|requireAdmin|auth\.getUser|auth\.getClaims|handleSpecialPriceCheckout' $f) \
admin=$(grep -cE 'requireAdmin|has_role' $f) \
serviceRole=$(grep -c 'SERVICE_ROLE' $f)"
done
```
