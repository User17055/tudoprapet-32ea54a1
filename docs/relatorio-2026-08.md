# Relatório técnico — intervenções de agosto/2026

Registro do que foi alterado, por quê, e o que muda na prática. Escrito para quem não
acompanhou as mudanças de perto.

**Escopo:** branch `Guilherme`, 8 commits. Nada foi integrado à `main` — a decisão de
merge é do time.

---

## Resumo

| | Antes | Depois |
|---|---|---|
| Testes automatizados | 7 | **64** |
| Edge functions sem autenticação | 6 de 13 | **0** |
| Cópias de `corsHeaders` | 10 (divergentes) | 1 |
| Linhas nos dois checkouts | 400 | 47 |
| Mensagens de WhatsApp por pedido de retirada | até 4 | 2 |
| Aviso de retirada em pedido de entrega | sim | não |
| Documentação de arquitetura | nenhuma | 3 documentos |

Saldo de código: **−473 / +124 linhas** na primeira leva, mais as correções do fluxo de
retirada.

---

## 1. WhatsApp da retirada: mensagens descartadas pela Meta

### Problema

Entre 28/07 e 04/08, o painel da Meta registrou:

- **61** mensagens com erro `131049` — *"Integridade do ecossistema: a Meta optou por não entregar"*
- **54** mensagens não enviadas
- **17** números "fazendo parte de um experimento"

O sistema não sabia de nada disso. Continuava registrando `WhatsApp dispatched` no log.

### Causa

São duas causas somadas, e separá-las importa.

**Causa principal, fora do código.** O erro 131049 é o limite que a Meta aplica **por
usuário** e **apenas a templates categorizados como MARKETING**. O texto do próprio erro
diz: *"o WhatsApp pode limitar a quantidade de modelos de marketing que uma pessoa
recebe"*.

Um aviso de "seu pedido está pronto para retirada" é uma notificação transacional —
categoria **UTILITY**, que não está sujeita a esse limite.

**Causa secundária, no código.** O volume enviado estava muito acima do necessário, o
que derruba a reputação do número independentemente da categoria:

1. **Quatro tópicos da Shopify** estavam registrados, e **três** viravam o mesmo evento
   `order_ready_for_pickup`. Um único pedido gerava até 4 mensagens, 3 idênticas.
2. **Nenhuma verificação de que o pedido era de retirada.** `fulfillments/create`
   sozinho já marcava o evento como "pronto para retirada" — então **todo pedido de
   entrega despachado disparava "venha buscar na loja"**.
3. **Sem chave de idempotência**, a API externa não tinha como descartar a repetição.
4. **Falha da API externa devolvia 502**, e a Shopify reenvia webhook não-2xx por até
   48 horas — transformando uma instabilidade momentânea em dezenas de novas tentativas.

### Solução

Item 1 é configuração no WhatsApp Manager, **não foi feito aqui** — depende de acesso ao
painel da Meta. Os demais foram implementados:

| Mudança | Onde |
|---|---|
| Consulta `delivery_method.method_type` e só envia quando é `pick_up` | `shopify-pickup-webhook` |
| `fulfillments/update` deixa de contar como "pronto" | `_shared/pickup.ts` + `shopify-webhooks-admin` |
| `idempotency_key` (`evento:pedido`) e `source_topic` no payload | `shopify-pickup-webhook` |
| Erro 4xx da API externa devolve 200; 5xx continua 502 | `shopify-pickup-webhook` |

A lógica de decisão saiu de dentro do handler para `_shared/pickup.ts` e ganhou 13
testes — antes não havia nenhum.

### O que muda concretamente

**Pedidos de entrega param de receber aviso de retirada.** Esta é a mudança de maior
efeito, e a mais fácil de confirmar: nenhum cliente que pediu entrega recebe mais
mensagem pedindo para buscar na loja. O quanto isso reduz o volume total depende da
proporção retirada/entrega da loja, que não dá para medir pelo código.

**Um pedido de retirada gera 2 mensagens em vez de até 4** — uma na criação do pedido,
uma quando fica pronto.

**Retentativa da Shopify deixa de multiplicar mensagem** em erro 4xx.

**Ressalva importante:** a `idempotency_key` é uma *oferta*, não uma garantia. Ela só
elimina duplicata se a API externa efetivamente descartar chaves repetidas. Isso
**precisa ser confirmado e possivelmente implementado do lado do Andre.** Sem isso, a
proteção contra duplicata se resume à remoção do `fulfillments/update`.

**Ressalva 2:** quando não é possível determinar o método de entrega (payload sem o dado
e Admin API indisponível), o envio acontece mesmo assim, com registro em log. A escolha
foi deliberada: deixar de avisar um cliente que veio buscar é pior do que uma mensagem
indevida ocasional.

### O que continua em aberto

**O sistema ainda não sabe quando uma mensagem falha.** O 131049 é uma falha assíncrona:
a API aceita, responde OK, e a Meta descarta depois. Enquanto o único registro estiver
no painel da Meta, o time vai continuar descobrindo por reclamação de cliente.

Existia uma tabela para isso — `pickup_codes`, com `whatsapp_sent_at`, `whatsapp_error`
e `raw_order` — criada na migration `20260708144427` e **derrubada 47 minutos depois**
pela `20260708153152`. Quem a projetou tinha entendido o problema. Vale saber por que
foi removida antes de propor o retorno.

**O e-mail está subaproveitado.** Hoje a Shopify manda notificação sem o código único, e
o código só existe no WhatsApp — o canal que a Meta pode cortar unilateralmente. A API
externa já tem o código no momento em que o gera; mandar o e-mail de lá colocaria o
código num canal sem limite de plataforma. Recomendação: **e-mail como canal primário do
código, WhatsApp como reforço.**

**O evento `order_created` continua indo para todos os pedidos.** A Shopify já manda
e-mail de confirmação; um WhatsApp adicional na compra é o mais próximo de marketing em
todo o fluxo. Vale discutir se ele deve existir.

---

## 2. Autenticação das edge functions

### Problema

Seis das treze edge functions não verificavam quem as chamava.

### Causa

O `verify_jwt` padrão do Supabase parece proteção, mas não é: a `anon key` é um JWT
válido e é **pública** — está no bundle do frontend. Ela prova apenas que quem chamou
tem a chave pública, não que existe um usuário logado.

Três functions aceitavam o e-mail **do corpo da requisição** em vez do token.

### Solução

| Function | Estava exposto | Agora |
|---|---|---|
| `customer-portal` | abria o portal de cobrança Stripe de **qualquer** cliente — ver faturas, trocar cartão, cancelar assinatura | e-mail vem do JWT |
| `check-subscription` | respondia se qualquer e-mail era membro do clube | e-mail vem do JWT |
| `create-checkout` | criava assinatura em nome de terceiros | e-mail vem do JWT |
| `pickup-resend-last` | reenviava WhatsApp a cliente real, sem autenticação | exige admin |
| `pickup-test-send` | enviava WhatsApp a telefone arbitrário | exige admin |
| `shopify-webhooks-admin` | proxy aberto da Admin API: listava pedidos com nome e telefone de clientes, registrava e removia webhooks da loja | exige admin |

O padrão ficou em `_shared/auth.ts` (`requireUser` / `requireAdmin`), seguindo a ordem
que as functions corretas já usavam: identidade vem do JWT → checa papel → só então
`service_role`.

### O que muda concretamente

As treze functions autenticam. Nenhuma mudança foi necessária no frontend:
`check-subscription` já era chamada apenas com usuário logado, e o e-mail que o
`SubscriptionContext` envia no corpo passa a ser ignorado.

**Atenção operacional:** `shopify-webhooks-admin` respondia a qualquer requisição por
query string (`?action=list_orders`, `?action=delete&id=`). Se alguém usava isso pelo
navegador para depurar webhooks, agora precisa de sessão de admin.

---

## 3. Duplicação e ausência de testes

### Problema

`subscriber-checkout` e `franchise-checkout` eram ~85% idênticas — 400 linhas para
executar o mesmo fluxo, divergindo em três pontos. `corsHeaders` estava declarado em 10
arquivos, com listas de `Access-Control-Allow-Headers` **diferentes entre si**.

Nenhuma edge function validava entrada: `quantity` ia direto para a Shopify, então valor
negativo, fracionário ou absurdo passava sem checagem.

### Solução

Criado `supabase/functions/_shared/`:

| Módulo | Conteúdo |
|---|---|
| `cors.ts` | cabeçalhos únicos + helpers de resposta |
| `auth.ts` | `requireUser` / `requireAdmin` |
| `checkout.ts` | fluxo de checkout parametrizado |
| `pricing.ts` | cálculo de desconto — **puro, sem Deno** |
| `shopify.ts` | chamadas à Shopify |
| `pickup.ts` | regras da retirada — **puro** |
| `validation.ts` | validação de entrada — **puro** |

A separação entre módulos puros e módulos com I/O é deliberada: é o que permite testar a
lógica de negócio pelo vitest, já que o `tsconfig` só cobre `src/` e as edge functions
não são verificadas por `npx tsc --noEmit`.

Sobre os `corsHeaders`: a versão unificada é a **união** de tudo que já era permitido,
não uma substituição. Liberar um cabeçalho a mais nunca quebra chamada que funcionava;
remover um derruba o preflight na hora.

### O que muda concretamente

Os dois checkouts passaram de 207 e 193 linhas para 25 e 22 — são configuração sobre um
fluxo comum. **Comportamento preservado deliberadamente**, incluindo particularidades
que poderiam parecer descuido:

- o `note` de franquia continua com o e-mail sem normalizar
- o fallback de token `SHOPIFY_ONLINE_ACCESS_TOKEN:user:...` segue apenas em
  `subscriber-checkout`
- as duas mensagens distintas de erro do draft order foram mantidas

As 22 constantes de comportamento (mensagens, tags, tabelas, rótulos) foram conferidas
uma a uma após a mudança. Única divergência intencional: o SDK do Supabase ficou em
2.75.0 nas duas (uma usava 2.49.1).

Carrinho com `quantity` negativo, fracionário ou acima do limite passa a ser rejeitado
com 400 antes de virar Draft Order. Carrinho vazio mantém a mensagem `"Carrinho vazio"`,
porque o frontend já depende dela.

---

## 4. Busca do catálogo

### Problema

Buscar `"golden"` trazia **"Brinquedo de Corda"**.

### Causa

Em `fuzzySearch.ts`, `term.includes(word)` pontuava 0.75 sem exigir nada da palavra do
texto. Como `"golden"` contém `"de"`, qualquer título com `"de"` casava. As stop words
eram descartadas apenas do lado da busca, nunca do lado do texto — então um título como
"Shampoo **a** Seco" casava com qualquer busca contendo a letra "a".

Foi encontrado por acaso: um teste escrito para documentar o comportamento existente
falhou.

### Solução e o que muda

Casamento por prefixo ou substring passa a exigir palavra do texto com ao menos 3
caracteres e que não seja stop word. Casamento exato continua valendo para qualquer
palavra — buscar "para" ainda encontra "Ração para Cães".

Resultados irrelevantes somem da busca do cliente. Coberto por 21 testes que verificam
os dois lados: os falsos positivos desaparecem e prefixo/substring legítimos continuam
funcionando.

---

## 5. O que não foi feito, e por quê

### HMAC do webhook da Shopify

`shopify-pickup-webhook` calcula a assinatura HMAC corretamente e **ignora o resultado**:

```ts
if (!valid) {
  console.warn("HMAC inválido — prosseguindo mesmo assim (verificação desabilitada temporariamente)");
}
```

Qualquer um pode forjar um payload e fazer o sistema disparar um WhatsApp — com um
código de retirada válido — para o telefone que escolher.

**Não foi corrigido de propósito.** A correção é de três linhas, mas se
`SHOPIFY_WEBHOOK_SECRET` estiver ausente ou errado em produção, passar a rejeitar
derruba o fluxo de retirada inteiro.

Caminho seguro: registrar em log se o HMAC *bateria*, sem bloquear; observar alguns
dias; só então passar a rejeitar.

**Este é o item mais importante da lista de pendências**, e a razão é o modelo de
negócio: o código de retirada substitui a assinatura do canhoto — ele **é** o
comprovante de entrega da mercadoria. Um comprovante que aceita payload forjado, sem
registro no Supabase e sem log de envio, não é auditável.

### Verificação de execução

Deno e Supabase CLI não estavam instalados na máquina de desenvolvimento, e o `tsconfig`
cobre apenas `src/`. **As edge functions não foram executadas nem type-checkadas.**

O que existe: testes unitários da lógica pura extraída, conferência das constantes de
comportamento, e revisão manual. É consistente, mas não substitui execução.

**Antes de abrir PR para a `main`, rodar `supabase functions serve` e fazer um smoke
test** — principalmente dos dois checkouts e do webhook de retirada.

---

## 6. Decisões que dependem do time

1. **Categoria do template de WhatsApp** — mudar de MARKETING para UTILITY no WhatsApp
   Manager. É a correção de maior impacto no problema do 131049 e não está no código.
2. **A API externa honra `idempotency_key`?** Sem isso, a proteção contra duplicata é
   parcial.
3. **E-mail com o código único** — a API externa já tem o código; enviá-lo por e-mail
   tira a dependência exclusiva de um canal que a Meta controla.
4. **`SHOPIFY_WEBHOOK_SECRET` está configurado e correto em produção?** Bloqueia a
   correção do HMAC.
5. **Quatro functions órfãs** — `create-checkout`, `customer-portal`, `pickup-test-send`
   e `shopify-webhooks-admin` não são chamadas por ninguém. `customer-portal` aponta
   para `/clube`, rota que não existe mais. Remover ou restaurar a tela?
6. **Registro de envio** — ressuscitar `pickup_codes` ou equivalente, para que falha de
   entrega deixe de ser invisível.
7. **`order_created` no WhatsApp** deve continuar existindo, dado que a Shopify já manda
   e-mail de confirmação?
8. **CORS `*`** é necessário, ou dá para restringir aos domínios da loja?

---

## 7. Como verificar

```bash
npm run test        # 64 testes
npx tsc --noEmit    # sem erros
npm run lint
```

Documentos relacionados:

- [`docs/edge-functions-auth.md`](edge-functions-auth.md) — matriz de autenticação das 13
  functions, o padrão da casa, e por que `verify_jwt` não é controle de acesso
