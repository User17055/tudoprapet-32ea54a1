# Relatório técnico — intervenções de agosto/2026

Registro do que foi alterado, por quê, e o que muda na prática. Escrito para quem não
acompanhou as mudanças de perto.

**Escopo:** branch `Guilherme`. A `main` foi integrada à branch (seção 6), mas **nada
foi integrado à `main`** — a decisão de merge é do time.

---

## Resumo

| | Antes | Depois |
|---|---|---|
| Testes automatizados | 7 | **86** |
| Edge functions sem autenticação | 6 de 13 | **0** |
| Assinatura HMAC do webhook | calculada e descartada | verificada, com interruptor |
| `supabase/functions` sob verificação | nenhuma | typecheck + lint (Deno) |
| Cópias de `corsHeaders` | 10 (divergentes) | 1 |
| Linhas nos dois checkouts | 400 | 47 |
| Mensagens de WhatsApp por pedido de retirada | até 4 | 2 |
| Aviso de retirada em pedido de entrega | sim | não |
| `note_attributes` do pedido ao gravar o código | array substituído | preservado |
| Código de retirada ausente | falha silenciosa | log `PICKUP_CODE_AUSENTE` |
| Documentação de arquitetura | nenhuma | 3 documentos |

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

## 5. Autenticação do webhook da Shopify (HMAC)

### Problema

`shopify-pickup-webhook` calculava a assinatura HMAC corretamente e **descartava o
resultado**:

```ts
if (!valid) {
  console.warn("HMAC inválido — prosseguindo mesmo assim (verificação desabilitada temporariamente)");
}
```

Qualquer pessoa capaz de fazer um POST na URL da function podia forjar um payload de
pedido e disparar um WhatsApp — **com um código de retirada válido** — para o telefone
que escolhesse.

Havia um segundo buraco, mais discreto: quando `SHOPIFY_WEBHOOK_SECRET` não estava
configurado, o `if (webhookSecret)` pulava a verificação por completo, sem qualquer
aviso. Segredo ausente e segredo correto eram indistinguíveis nos logs.

### Causa

O comentário dizia "temporariamente", então foi um contorno durante o setup da
integração que nunca foi revertido. É um padrão comum: desliga-se a verificação para
destravar o desenvolvimento e ninguém volta.

Por que importa mais do que parece: **o código de retirada substitui a assinatura do
canhoto** — ele *é* o comprovante de entrega da mercadoria. Um comprovante que pode ser
gerado por payload forjado não sustenta uma divergência de estoque.

### Solução

A verificação passou a valer, com um interruptor explícito
(`SHOPIFY_WEBHOOK_HMAC_MODE`):

| Modo | Assinatura inválida | Segredo ausente |
|---|---|---|
| `monitor` (**padrão**) | registra e processa | registra e processa |
| `enforce` | **401** | **401** |

A política de decisão ficou em `_shared/webhook.ts` (`decideHmac`), separada do cálculo
criptográfico — é o que permite testá-la sem depender de `crypto.subtle`. São 12 testes
cobrindo as seis combinações de modo × estado.

Duas decisões de projeto que valem registro:

**O padrão é `monitor`, não `enforce`.** Não há como confirmar de fora se o segredo está
correto em produção. Se estiver errado, ligar a rejeição derruba a retirada inteira — e
a falha é silenciosa do lado da loja. `monitor` faz a verificação valer como observação
primeiro.

**Segredo ausente com `enforce` ligado é rejeitado**, não aceito em silêncio. Quem liga
o enforce está afirmando que a verificação funciona; aceitar nesse caso reproduziria
exatamente o buraco anterior.

Aproveitando, a comparação da assinatura passou a ser em tempo constante. O `===`
anterior sai no primeiro byte diferente, o que em teoria permite descobrir a assinatura
esperada medindo o tempo de resposta.

### O que muda concretamente

**Hoje, ao fazer o deploy: nada muda no comportamento.** Em `monitor` toda requisição
continua sendo processada exatamente como antes. Isso é intencional — o deploy é seguro
por construção.

**O que muda é que agora dá para saber.** Cada requisição emite uma linha estável:

```
HMAC_CHECK mode=monitor result=valid action=accept topic=fulfillments/create shop=...
```

**A proteção real entra quando o time trocar uma variável de ambiente.** O procedimento
está em `docs/edge-functions-auth.md`: rodar em `monitor` alguns dias, conferir que
todos os `HMAC_CHECK` são `result=valid`, e então definir
`SHOPIFY_WEBHOOK_HMAC_MODE=enforce`.

**Sendo direto sobre o que isso significa:** o E1 está implementado e testado, mas a
loja só fica protegida contra payload forjado quando alguém ligar o `enforce`. Enquanto
estiver em `monitor`, a vulnerabilidade continua aberta — com a diferença de que agora
ela é observável, e ligar a proteção custa uma variável em vez de um deploy.

---

## 6. Integração com a `main`

### Contexto

Enquanto o trabalho acontecia nesta branch, a `main` recebeu 13 commits do Lovable — e
**atacavam o mesmo problema do fluxo de retirada, em paralelo, nas mesmas horas**. Os
dois lados mexeram nos mesmos dois arquivos.

Conflito em apenas um: `shopify-pickup-webhook`. O `pickup-resend-last` fundiu sozinho.

### As duas abordagens, lado a lado

| | Lovable (`main`) | Esta branch |
|---|---|---|
| **Foco** | o sintoma sentido pela loja: código não chega no e-mail | a causa do volume: mensagem demais sendo enviada |
| **Entregou** | código gravado em `note_attributes` → e-mail nativo da Shopify | filtro retirada/entrega, remoção de tópico duplicado, idempotência, HMAC, testes |
| **Acertou onde a outra errou** | resposta sempre 200 | — |
| **Não tocou** | causa do 131049, segurança | o problema do e-mail (só recomendou) |

São complementares, e é por isso que o resultado da fusão é melhor que qualquer um dos
dois isolado.

### Resolução do conflito

O ponto em disputa era a resposta em falha da API externa: esta branch devolvia **502**
em erro 5xx (para a Shopify repetir); a `main` devolve **200 sempre**.

**Ficou a versão da `main`**, por um motivo que não estava escrito lá: além de
retentativa gerar mensagem duplicada — exatamente o problema que se quer resolver —, a
Shopify **remove a inscrição do webhook** após falhas sustentadas. Perder uma
notificação é recuperável pelo botão de reenvio; perder o registro mata o fluxo inteiro
em silêncio.

O raciocínio ficou como comentário no código, para não ser revertido por engano.

### O que a comparação revelou depois

Reler o código da `main` com calma — e não apenas conferir que o merge preservou os dois
lados — mostrou três coisas. Duas foram corrigidas:

**`note_attributes` era substituído por inteiro.** O PUT da Admin API troca o array
todo, então gravar `[{ codigo }]` apagaria qualquer outro atributo do pedido: observação
de presente, dado vindo do checkout, atributo posto por app. Hoje o risco era baixo
porque nada mais escreve ali, mas é o tipo de perda de dado que só aparece quando já
aconteceu.

Agora os atributos existentes são preservados e apenas o do código é sobrescrito
(`mergeNoteAttributes`). Quando o chamador já tem o pedido carregado — caso do
`pickup-resend-last` — eles são passados adiante e evita-se uma leitura extra.

**Código ausente falhava em silêncio.** A extração tentava três nomes de campo
(`pickup_code`, `code`, `data.pickup_code`) e, se nenhum casasse, seguia sem gravar
**sem registrar nada**. O e-mail saía sem código e não havia como saber por quê. Agora
emite `PICKUP_CODE_AUSENTE` com o início da resposta da API externa.

Os três nomes de campo foram mantidos: são herança de não haver documentação do contrato
da API externa deste lado. Ficam como estão até isso ser acertado com quem a mantém.

**A gravação estava duplicada** nas duas functions, com implementações ligeiramente
diferentes. Foi para `_shared/` (`extractPickupCode`, `mergeNoteAttributes`,
`savePickupCodeOnOrder`), com 10 testes novos.

### O que não dá para corrigir deste lado

**Os dois canais estão acoplados.** Em `shopify-pickup-webhook`, a falha do envio do
WhatsApp retorna **antes** da extração e gravação do código. Ou seja: se o WhatsApp
falha, o código nunca chega ao pedido, e **o e-mail também sai sem código**.

Isso anula o propósito de ter um segundo canal — o e-mail deveria funcionar justamente
quando o WhatsApp não funciona.

Não é corrigível aqui: se `/api/whatsapp/send` falha, provavelmente não há código algum
para gravar. A solução é a API externa separar a **geração** do código do **envio** da
mensagem. É conversa com quem mantém a API, não patch neste repositório.

---

## 7. O que não foi feito, e por quê

### Execução das edge functions

O typecheck delas passou a existir (ver seção 7), mas **elas ainda não foram
executadas**. Verificação estática não é a mesma coisa que rodar.

Antes de abrir PR para a `main`, vale um smoke test com `supabase functions serve` —
principalmente dos dois checkouts e do webhook de retirada, que é o que mais mudou.

Ao rodar localmente, aponte `EXTERNAL_API_BASE_URL` para algo descartável. Com os
valores de produção, a function **manda WhatsApp de verdade**.

---

## 8. As edge functions entraram na verificação automática

Até aqui, `supabase/functions/` estava **fora de tudo**: o `tsconfig.app.json` inclui
apenas `src/`, então `npx tsc --noEmit` nunca olhou para a pasta. Sem typecheck, sem
lint, sem teste, sem execução local. Foi por isso que coisas como o HMAC descartado e as
seis functions sem autenticação sobreviveram tanto tempo — nada as examinava.

A causa era o fluxo de trabalho: as functions são geradas e publicadas pelo Lovable, e
ninguém precisou desenvolvê-las na própria máquina. Deno e Supabase CLI nunca fizeram
falta, e portanto nunca foram adicionados.

Agora existem dois scripts:

```bash
npm run check:functions   # deno check — typecheck das 13 functions
npm run lint:functions    # deno lint
```

O Supabase CLI entrou como devDependency, então vem com `npm install`. O Deno é um
runtime e precisa ser instalado na máquina: `winget install DenoLand.Deno`.

**O typecheck encontrou dois erros no primeiro uso** — ambos invisíveis até então:

| Onde | Erro |
|---|---|
| `_shared/checkout.ts` | cast inválido no resultado do postgrest com coluna dinâmica |
| `pickup-complete/index.ts` | parâmetro com `any` implícito (código pré-existente) |

Os dois foram corrigidos.

### Uma armadilha que vale registrar

O `deno.json` precisa de `"nodeModulesDir": "none"`. Com `"auto"` — que é o que o
próprio Deno sugere na mensagem de erro — ele instala cópias próprias das dependências
em `node_modules/.deno/`, e o `vite build` passa a resolver o rollup de lá e **quebra**.
Testes e typecheck continuam passando, então a quebra só aparece no build.

Está comentado dentro do `deno.json`. Não troque para `auto`.

---

## 9. Decisões que dependem do time

1. **Categoria do template de WhatsApp** — mudar de MARKETING para UTILITY no WhatsApp
   Manager. É a correção de maior impacto no problema do 131049 e não está no código.
2. **A API externa honra `idempotency_key`?** Sem isso, a proteção contra duplicata é
   parcial.
3. **Ligar `SHOPIFY_WEBHOOK_HMAC_MODE=enforce`** depois de confirmar nos logs que todos
   os `HMAC_CHECK` são `result=valid`. Enquanto não for ligado, o webhook segue
   aceitando payload forjado — o código está pronto, falta a decisão. Procedimento em
   `docs/edge-functions-auth.md`.
4. **Conferir se o e-mail da Shopify está renderizando o código.** A `main` passou a
   gravar o código em `note_attributes` do pedido justamente para isso, mas o template
   de notificação precisa incluir `{{ attributes["Codigo de retirada"] }}` — é
   configuração em Settings → Notifications, não código.
5. **Separar geração do código do envio da mensagem** na API externa. Hoje, se o envio
   do WhatsApp falha, o código nunca é gravado no pedido e o e-mail também sai sem
   código — os dois canais caem juntos, o que anula o propósito de ter o segundo.
   Ver seção 6.
6. **Quatro functions órfãs** — `create-checkout`, `customer-portal`, `pickup-test-send`
   e `shopify-webhooks-admin` não são chamadas por ninguém. `customer-portal` aponta
   para `/clube`, rota que não existe mais. Remover ou restaurar a tela?
7. **Registro de envio** — ressuscitar `pickup_codes` ou equivalente, para que falha de
   entrega deixe de ser invisível.
8. **`order_created` no WhatsApp** deve continuar existindo, dado que a Shopify já manda
   e-mail de confirmação?
9. **CORS `*`** é necessário, ou dá para restringir aos domínios da loja?

---

## 10. Como verificar

```bash
npm run test              # 86 testes
npx tsc --noEmit          # frontend, sem erros
npm run lint              # frontend
npm run check:functions   # edge functions (requer Deno instalado)
npm run lint:functions    # edge functions
npm run build             # confere que o bundle ainda sai
```

Documentos relacionados:

- [`docs/edge-functions-auth.md`](edge-functions-auth.md) — matriz de autenticação das 13
  functions, o padrão da casa, e o procedimento para ligar o `enforce` do HMAC
