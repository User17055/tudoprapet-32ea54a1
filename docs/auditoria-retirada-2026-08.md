# Auditoria da superfície de retirada — 08/2026

Revisão das sete functions que compõem o fluxo de retirada: `shopify-pickup-webhook`,
as cinco `pickup-*` e `shopify-webhooks-admin`.

Este documento **não repete** a matriz de autenticação nem o procedimento de ligar o
`enforce` — os dois estão em [`edge-functions-auth.md`](edge-functions-auth.md). Aqui
ficam os achados novos, o que foi verificado e confirmado, e o que não deu para verificar.

**Método:** leitura de código e migrations. Nenhuma function foi executada e nenhuma
requisição foi feita a produção — ver "O que não foi verificado".

---

## O que foi verificado e está correto

Registrado porque auditoria que só lista problema não permite saber o que já foi olhado.

- **`has_role` é `SECURITY DEFINER` com `SET search_path = public`**
  (`20260507160334`). É o gate de admin de todo o fluxo e está escrito da forma certa:
  sem `search_path` fixo, um schema malicioso no path poderia sequestrar a resolução.
- **As sete functions autenticam.** Quatro por `requireAdmin` de `_shared/auth.ts`, três
  por `getClaims()` + `has_role` (ver achado 3), o webhook por HMAC.
- **A checagem de papel falha fechada.** As functions fazem
  `const { data: isAdmin } = await supabase.rpc("has_role", …)` sem inspecionar o erro.
  Parece descuido, mas o efeito é seguro: erro do RPC devolve `data: null`, que é falso,
  e o pedido é rejeitado com 403.
- **Comparação de assinatura em tempo constante** (`timingSafeEqual`), sobre o corpo
  **bruto** — a verificação acontece antes de qualquer `JSON.parse`, que é a ordem certa.
- **Segredo ausente com `enforce` ligado é rejeitado**, não aceito em silêncio.
- **A identidade nunca vem do corpo da requisição** em nenhuma das sete.

---

## Achados

### 1. Deriva de versão do SDK do Supabase — média

Quatro combinações diferentes de especificador e versão convivem:

| Especificador | Onde |
|---|---|
| `npm:@supabase/supabase-js@2.75.0` | `pickup-validate`, `pickup-history`, `pickup-complete` |
| `https://esm.sh/@supabase/supabase-js@2.75.0` | `_shared/auth.ts`, `_shared/checkout.ts` |
| `https://esm.sh/@supabase/supabase-js@2.49.4` | `check-subscription` |
| `https://esm.sh/@supabase/supabase-js@2.49.1` | `customer-orders` |

O relatório de agosto registra a unificação em 2.75.0 **dentro dos dois checkouts**, mas
a deriva no resto passou. `customer-orders` e `check-subscription` seguem em 2.49.x — as
duas lidam com dado de cliente, e é o SDK que valida token nas duas.

Duas consequências práticas, além da inconsistência:

- **Correção de segurança no SDK precisa ser aplicada em quatro lugares**, e é fácil
  esquecer um. Não há nada que force o alinhamento.
- **Padronizar em `npm:` destrava verificação em ambiente restrito.** `npm:` resolve por
  `registry.npmjs.org`; `esm.sh` é um host à parte, bloqueado por políticas de egress
  mais fechadas — inclusive a desta sessão. Enquanto `_shared/auth.ts` importar de
  `esm.sh`, `npm run check:functions` não roda em ambiente restrito, porque quase toda
  function depende dele. Isso é pré-requisito para colocar o typecheck em CI.

**Sugestão:** padronizar em `npm:@supabase/supabase-js@2.75.0` nas sete. É troca de uma
linha por arquivo, mas mexe em autenticação que funciona — merece ser feita e verificada
sozinha, não junto de outra coisa.

### 2. `pickup-complete` chama um host fixo quando a variável falta — média

`pickup-complete/index.ts:156`:

```ts
const baseUrl = (Deno.env.get("EXTERNAL_API_BASE_URL") || "https://andrejrs.com.br").replace(/\/$/, "");
```

As outras quatro falham explicitamente quando `EXTERNAL_API_BASE_URL` não está definida.
Esta continua, apontando para um domínio fixo no código.

Por que importa mais do que uma inconsistência de estilo: se a variável for removida ou
renomeada por engano no painel, as quatro param com erro visível e esta **segue
funcionando contra um host que ninguém declarou**. É a diferença entre uma falha que
aparece e uma que não aparece. E é justamente a function que confirma a entrega da
mercadoria.

`edge-functions-auth.md` registra o fallback com "convém padronizar"; o ponto aqui é que
a padronização certa é **falhar**, não escolher um default melhor.

### 3. `getClaims()` aceita token revogado até expirar — baixa, a confirmar

`pickup-validate`, `pickup-complete` e `pickup-history` usam
`supabase.auth.getClaims(token)` + `has_role`, em vez de `requireAdmin`.
`edge-functions-auth.md` os trata como equivalentes. São, quanto ao resultado da
autorização — mas há uma diferença que não está registrada:

- `requireUser` usa `getUser()`, que **consulta o servidor de auth** a cada chamada.
- `getClaims()` valida a assinatura **localmente** contra o JWKS quando o projeto usa
  chave assimétrica, sem ir ao servidor.

Com validação local, um token de admin que teve a sessão encerrada continua sendo aceito
até o `exp` do próprio token. A janela é curta e exige um token de admin já emitido —
por isso severidade baixa — mas em `pickup-complete`, que dá baixa em mercadoria, "logout
não revoga imediatamente" é um fato que vale estar escrito.

**Não confirmei** qual algoritmo de assinatura o projeto usa. Com chave simétrica o SDK
cai de volta no servidor e a diferença desaparece. Confirmar antes de agir.

### 4. Janela do `monitor` — alta enquanto durar

Já documentado, quantificado aqui pelo que ele permite hoje: com
`SHOPIFY_WEBHOOK_HMAC_MODE=monitor`, quem souber a URL da function pode POSTar um payload
forjado e fazer o sistema disparar WhatsApp com **código de retirada válido** para
qualquer número. O código substitui a assinatura do canhoto — é o comprovante de entrega.

A URL não é segredo: está registrada na Shopify e a function responde de qualquer origem.

Nada a corrigir no código — está pronto e testado. É a troca de uma variável, com o
procedimento em [`edge-functions-auth.md`](edge-functions-auth.md#como-ligar-o-enforce).
**Enquanto não for ligado, esta é a exposição mais séria do fluxo.**

### 5. Functions publicadas sem chamador — baixa

`pickup-test-send` e `shopify-webhooks-admin` não são chamadas pelo frontend, e seguem
publicadas e alcançáveis. Ambas exigem admin, então não são um buraco — são superfície
viva sem dono. `pickup-test-send` dispara WhatsApp para telefone arbitrário; se uma conta
de admin for comprometida, ela é o caminho mais direto para usar o número da loja como
disparador.

Superfície que ninguém usa é superfície que ninguém observa. A decisão (remover ou
manter) já está aberta no relatório; o que esta auditoria acrescenta é que `pickup-test-send`
merece prioridade sobre as outras órfãs pelo que ela consegue fazer.

### 6. `CORS *` — informativo, sem ação

As 13 respondem `Access-Control-Allow-Origin: *`. Está listado como pergunta aberta, e
vale registrar por que **não** é urgente: a autenticação é por `Authorization` header,
não por cookie de sessão. Sem cookie não há envio automático de credencial pelo
navegador, então não há CSRF a explorar — um site de terceiros pode chamar a function,
mas não com a sessão de quem visita.

Restringir origem continua sendo boa higiene. Não é, porém, o que está segurando risco.

---

## O que não foi verificado

A parte que impede esta auditoria de induzir falsa confiança.

- **Logs de produção.** Não há acesso. A confirmação de que todo `HMAC_CHECK` sai
  `result=valid` — pré-requisito para ligar o `enforce` — **continua pendente e é a
  única coisa que separa o fluxo da proteção real.**
- **O que está publicado.** A política de egress desta sessão nega `*.supabase.co`;
  `scripts/check-deploy.sh` devolveu "desconhecido", não "desatualizado". Como o
  relatório registra que em 04/08 nenhuma function havia sido publicada, é razoável supor
  que os achados acima descrevem o repositório e **não necessariamente o que roda**.
- **Comportamento ao vivo.** Nenhuma function foi executada. Verificação estática não é
  execução.
- **RLS efetivo no Postgres.** As policies foram lidas nas migrations, não exercitadas
  contra o banco.
- **O contrato da API externa.** Se ela descarta `idempotency_key` repetida segue sem
  confirmação — é o que sustenta a proteção contra duplicata.

---

## Ordem sugerida

1. Ligar o `enforce` (achado 4) — maior redução de risco, custo de uma variável.
2. Fazer `pickup-complete` falhar sem `EXTERNAL_API_BASE_URL` (achado 2) — mudança de
   uma linha.
3. Padronizar o SDK em `npm:` (achado 1) — destrava typecheck em CI.
4. Decidir sobre `pickup-test-send` (achado 5).
5. Confirmar o algoritmo de assinatura do JWT (achado 3) antes de mexer em qualquer coisa.
