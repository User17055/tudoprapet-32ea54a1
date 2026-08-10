# TudoPraPet Impressão

Programa local para Windows que recebe ZPL do painel e envia em modo RAW para a Zebra. A configuração inicial aponta para `ZDesigner ZD220-203dpi ZPL (Copiar 1)`, detectada neste computador.

O modelo normal enviado pelo admin é identificado por `TPP-ZPL-V2`, usa a logo da TudoPraPet e destaca o método de entrega escolhido pelo cliente. O agente só informa sucesso ao site depois que o Windows aceita o ZPL e a nuvem confirma o retorno.

No computador conectado à impressora, extraia o ZIP e dê dois cliques em `INSTALAR.cmd`. O instalador lista as impressoras daquela máquina, inicia o programa escondido e configura a abertura automática com o Windows. O computador do administrador não precisa ficar ligado e o painel não precisa permanecer aberto.

Ao concluir, o instalador abre o painel local **TudoPraPet Impressão** e cria um atalho na área de trabalho. A tela mostra os últimos 50 pedidos recebidos, horário, origem (automático ou botão imprimir) e resultado. Ela também pode ser aberta em `http://127.0.0.1:17891/` no computador da impressora.

Na mesma tela é possível selecionar um pedido recente e gerar a etiqueta diretamente, sem carregar XML. Os dados vêm da Shopify e o destaque usa o método de entrega escolhido no pedido, como `RETIRADA`, `PAC`, `SEDEX` ou `MOTOBOY`, sem depender do status de separação. A tela permite gerar, baixar o ZPL ou imprimir diretamente.

Para a impressão automática, configure no Supabase um segredo chamado `PRINT_AGENT_TOKEN`; coloque o mesmo valor em `config.json` e altere `autoPrint` para `true`. Na primeira conexão o agente apenas sincroniza o histórico, sem imprimir. Depois disso, imprime somente pedidos criados após a ativação. `state.json` evita duplicidade. Impressões solicitadas manualmente no painel chegam por uma fila segura na nuvem.

A4 usa a janela normal do navegador, permitindo escolher Epson ou PDF. Para testar o agente, abra `http://127.0.0.1:17891/status`.
