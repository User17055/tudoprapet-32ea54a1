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

## Ainda nao validado

- [x] criar a venda e abrir o modal de recebimento (venda 110245);
- [x] leitura do codigo da venda pela linha `Codigo:` do resumo;
- [ ] modal de recebimento: escolher `Vindi`, preencher o valor e clicar em `#btn_baixar`;
- [ ] confirmacao de sucesso: o status da venda e um `span.badge` ("Em atendimento" antes
      do recebimento). O `config.env` ainda usa `text=Baixado`, que pega o primeiro
      elemento com esse texto na pagina; se falhar, trocar por
      `span.badge:visible:text-is("Baixado")`.

Para isso, use uma fatura paga que **ainda nao** tenha sido lancada manualmente no
SimplesVet, com `SIMPLESVET_HEADLESS=0` ou acompanhando as capturas. Se o worker
falhar depois do clique, a tarefa vai para revisao manual, sem nova tentativa.

Outros pontos de atencao:

- **Preco:** o worker nao altera o preco do item (`SIMPLESVET_SALE_PRICE_SELECTOR`
  vazio). O preco do produto no SimplesVet precisa ser igual ao valor do item na
  Vindi, senao a tarefa para em "Total divergente".
- **Login:** em alguns testes o formulario de login nao apareceu em 45 s; o worker
  tenta 3 vezes (num dos testes entrou so na terceira, apos 142 s). Se a falha for em
  "abrir tela de login", o problema e esse.
- **Conciliacao:** em 01/10 havia 2 produtos da Vindi pendentes de conciliacao. Faturas
  com esses produtos ficam na fila ate serem classificados.

## Nao reenviar a fatura 549518144

A tarefa da fatura Vindi `549518144` esta em revisao manual. Essa fatura ja tem a
venda **110239** no SimplesVet (lancada as 18:17 de 01/10, "Baixado", mesmo valor).
Usar `retry_now` nela criaria uma venda duplicada.

## Como desfazer

Os arquivos anteriores ficaram com o sufixo `.bak-20261001-cliente`:

```sh
cd /opt/lisontech-simplesvet
cp -p rpa/simplesvet-sales-worker.js.bak-20261001-cliente rpa/simplesvet-sales-worker.js
cp -p secure/config.env.bak-20261001-cliente secure/config.env
cp -p secure/config.env.example.bak-20261001-cliente secure/config.env.example
```

Se a publicacao automatica do Lis-onTech enviar arquivos para a VPS, aplique a mesma
mudanca no repositorio de origem do worker; caso contrario a proxima publicacao
desfaz a correcao.
