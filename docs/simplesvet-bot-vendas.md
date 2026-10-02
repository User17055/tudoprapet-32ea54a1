# Bot de vendas no SimplesVet (faturas pagas da Vindi)

Registro do diagnostico e da correcao de 01/10/2026. O bot nao fazia parte deste
repositorio: ele roda na VPS do Lis-onTech, e a VPS recebe os arquivos sem
historico Git. Este documento e o registro versionado do que mudou e por que.

## O que o bot faz

1. A Vindi envia `bill_paid` ao Lis-onTech, que cria uma tarefa unica por fatura.
2. A cada 5 minutos o cron da VPS roda `scripts/simplesvet_sales.sh`, que executa
   `rpa/simplesvet-sales-worker.js` (Playwright + Chromium headless).
3. O worker reserva **uma** tarefa (`action: claim`), entra no SimplesVet com a conta
   exclusiva do bot, abre o PDV, localiza o cliente pelo CPF da Vindi, adiciona os
   produtos conciliados, grava a observacao `VINDI #<bill_id>`, confere o total e
   clica em **Registrar recebimento**.
4. Logo depois que o SimplesVet gera o codigo da venda, o worker grava um
   `checkpoint` na fila. Qualquer falha a partir desse ponto vai para revisao manual,
   para nunca criar a mesma venda duas vezes.

| Item | Onde fica |
|---|---|
| Worker | `/opt/lisontech-simplesvet/rpa/simplesvet-sales-worker.js` |
| Configuracao (seletores, liga/desliga) | `/opt/lisontech-simplesvet/secure/config.env` |
| Usuario/senha do bot | painel Lis-onTech, **Configuracoes > Conta do bot de pagamentos** |
| Log do cron | `/opt/lisontech-simplesvet/logs/simplesvet-cron.log` |
| Capturas de erro | `/opt/lisontech-simplesvet/logs/simplesvet-sales-error-<bill>-tentativa-<n>.png` |
| Liga/desliga | `SIMPLESVET_SALES_ENABLED` (`"0"` desligado) |

## Onde travava

O fluxo foi refeito passo a passo com os mesmos seletores do `config.env`. Login e
abertura do PDV levavam poucos segundos; o problema estava na tela de venda.

| Passo | Problema | Efeito |
|---|---|---|
| Pesquisar cliente | O worker escrevia o CPF no campo "Cliente" do PDV. O SimplesVet copia esse valor para o campo **Responsavel** da gaveta de pesquisa, e a pesquisa combina os campos (E). | "Nenhum cliente foi encontrado", mesmo com o CPF cadastrado. |
| Pesquisar cliente | Quando o Enter chega antes do JavaScript do SimplesVet assumir o formulario, o navegador envia o `<form action="action">` de forma nativa. | Navega para `/principal/pontodevenda/action?...cpf=...` e cai na **pagina 404**. Era intermitente: dependia de o JS carregar a tempo. |
| Ler o resultado | Os resultados abrem no segundo painel da gaveta (`#cliente`), fora de `#pesquisa`. O nome do animal usa a mesma classe `a.item_pesquisa` do responsavel. | O bot contava 0 resultados mesmo com o cliente na tela; sem o filtro, contaria 2 (responsavel + animal). |
| Conferir o total | `#tbodyTotal tr:last-child td:last-child` e a coluna vazia da lixeira. | Esperava 15 s por um `<td>` oculto e falhava. |

## O que foi corrigido

No worker (`locateCustomer`):

- o campo principal fica vazio; na busca por CPF o campo Responsavel e limpo, e na
  busca por nome o campo CPF e limpo;
- antes do Enter, o envio nativo do formulario da gaveta e bloqueado. O AJAX do
  SimplesVet continua funcionando, entao a pesquisa acontece normalmente:

  ```js
  form.addEventListener('submit', (event) => event.preventDefault(), true);
  ```

- o Enter e repetido (ate 5 vezes, 8 s cada) ate aparecer resultado ou
  "Nenhum cliente foi encontrado";
- por CPF, exige exatamente 1 responsavel; por nome (somente se o CPF nao achar),
  recarrega o PDV e aceita apenas nome identico, ignorando acentos e caixa;
- depois do clique, confirma que o PDV preencheu `input[name="pes_int_codigo"]`.

No `config.env`:

```env
SIMPLESVET_SALE_CUSTOMER_RESULTS_SELECTOR='.svslider a.item_pesquisa[data-tipo="C"]'
SIMPLESVET_SALE_TOTAL_SELECTOR="#ven_dec_liquido"
SIMPLESVET_SALE_PAYMENT_SELECTOR="select[name='fpa_int_codigo[]']:visible"
SIMPLESVET_SALE_RECEIVED_AMOUNT_SELECTOR="input[name='vfp_dec_valor[]']:visible"
```

Os campos de pagamento tem ids aleatorios (ex.: `fpa_int_codigo-yjIff`), o que indica
linhas-modelo clonadas ao abrir o recebimento. O `:visible` faz o bot usar a linha que
esta na tela, e nao o modelo oculto.

## Como foi validado

- Ensaio com o codigo real do worker, sem reservar tarefa e com o clique em
  **Registrar recebimento** trocado por um erro: cliente encontrado pelo CPF, produto
  adicionado, total lido corretamente. Parou na conferencia de total, antes de salvar.
  Nenhuma venda foi criada.
- Leitura da tela do PDV, sem clicar: o select de forma de recebimento tem a opcao
  `Vindi`, e `#btn_baixar`, `vfp_dec_valor[]` e `#ven_int_codigo` existem.

## Primeira venda real (01/10/2026 22:28)

O bot foi ligado e processou a fatura `542381263` (R$ 52,00, PLANO SUPER ECONOMICO):
cliente, produto, total e observacao corretos, e o SimplesVet criou a venda **110245**.
Depois disso o worker falhou ao ler o codigo da venda e a tarefa foi para revisao
manual, como previsto. O bot foi desligado de novo.

Causa: `#ven_int_codigo` nao e o codigo da venda. Ha 8 campos com esse nome, todos
ocultos em formularios de modais (orcamento, NFC-e, e-mail); eles guardam um id interno
(ex.: `192695117`), e o primeiro, que o worker lia, fica vazio. O codigo que aparece em
Consulta vendas esta na linha `Codigo:` do resumo da venda. O worker agora le essa linha
(validado na venda 110245: retorna `110245`; no PDV vazio, nada).

A venda 110245 ficou "Em atendimento", sem recebimento. Para concluir: registrar o
recebimento `Vindi` de R$ 52,00 nela e concluir a tarefa na fila com a venda 110245
(sem `retry_now` comum, que criaria outra venda).

## Em producao (desde 01/10/2026 23:10)

Na primeira noite o bot lancou **32 faturas** de ponta a ponta (venda + recebimento
`Vindi` + status "Baixado"), visiveis em **Realizados > Baixas SV**. Cada venda leva de
10 a 30 s.

### Como roda

| O que | Como |
|---|---|
| Inicio | cron **a cada 1 minuto** (`flock` impede duas execucoes ao mesmo tempo) |
| Fila | processa **enquanto houver fatura**, com `SIMPLESVET_SALES_PAUSE_SECONDS=10` entre uma e outra (`SIMPLESVET_SALES_BATCH_SIZE=0` = sem limite) |
| Fatura nova | o webhook cria a tarefa; o bot pega em ate 1 min, ou na sequencia se ja estiver rodando |
| Desligar | `SIMPLESVET_SALES_ENABLED=0` no `config.env` (ou `kill`, sem `-9`): termina a venda atual e para antes da proxima |

### O que o bot trata sozinho

- **Preco da Vindi diferente da tabela:** clica no item, abre "Alterar item da venda"
  (`#edicao-box`) e troca o Preco (`#e__vpr_dec_preco`). O produto precisa ter **preco
  variavel** no cadastro do SimplesVet; sem isso o campo vem bloqueado, e o bot lanca a
  diferenca como desconto no item (so quando o valor da Vindi e menor).
- **Varios produtos:** o SimplesVet coloca o item novo no topo da lista; o bot acha o item
  pelo `data-uid` da linha.
- **"Atencao: este cliente tem outras vendas em aberto":** clica em **Baixar apenas esta
  venda**.
- **Cliente com credito no SimplesVet:** o valor da Vindi passa do "Total a receber" e o
  SimplesVet confirma o credito do troco; o bot aceita a confirmacao (registrada no log
  como `VENDA_SV_CONFIRMACAO`).
- **Codigo da venda:** lido na linha `Codigo:` do resumo (`#ven_int_codigo` e um id interno).
- **Sucesso:** selo de status (`span.badge`) igual a "Baixado".

### Tentativas

- **Qualquer erro antes de salvar a venda:** ate 3 tentativas, reaproveitando o login
  (so reabre o PDV). Novo login apenas se a falha foi no login ou a pagina fechou.
- **Erro depois de salvar:** nunca repete do zero (criaria outra venda). Reabre a mesma
  venda pelo codigo e refaz so o recebimento, ate 3 vezes; se ela ja estiver "Baixado",
  conta como sucesso.
- **Rodadas automaticas:** fatura que falhou **sem criar venda** volta sozinha para a fila
  depois de `SIMPLESVET_SALES_AUTO_RETRY_MINUTES=10`, por ate
  `SIMPLESVET_SALES_AUTO_RETRY_CYCLES=3` rodadas (estado em `rpa/data/sales-auto-retry.json`).
  Fatura com venda criada nunca volta sozinha.

### Pendente

- As faturas `539169997`, `549701746` e `542381263` tiveram a venda criada sem recebimento;
  as vendas (110263, 110271 e 110245) foram excluidas no SimplesVet, mas o `retry_now`
  nao libera tarefa com venda vinculada (`released: 0`). Precisa de uma acao no painel do
  Lis-onTech para liberar.
- Fatura `549518144`: ja tem a venda **110239**, lancada manualmente em 01/10; reenviar
  cria outra venda.

## Como desfazer

Cada mudanca guardou a versao anterior com sufixo `.bak-AAAAMMDD-<motivo>`
(ex.: `rpa/simplesvet-sales-worker.js.bak-20261002-tentativas`,
`secure/config.env.bak-20261002-tentativas`, `/root/crontab.bak-20261002-1min`):

```sh
cd /opt/lisontech-simplesvet
cp -p rpa/simplesvet-sales-worker.js.bak-20261002-tentativas rpa/simplesvet-sales-worker.js
cp -p secure/config.env.bak-20261002-tentativas secure/config.env
crontab /root/crontab.bak-20261002-1min
```

Se a publicacao automatica do Lis-onTech enviar arquivos para a VPS, aplique a mesma
mudanca no repositorio de origem do worker; caso contrario a proxima publicacao
desfaz a correcao.
