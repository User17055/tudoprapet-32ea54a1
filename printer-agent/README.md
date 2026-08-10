# TudoPraPet Impressão

Programa local para Windows que recebe ZPL do painel e envia em modo RAW para a Zebra. A configuração inicial aponta para `ZDesigner ZD220-203dpi ZPL (Copiar 1)`, detectada neste computador.

No computador conectado à impressora, extraia o ZIP e dê dois cliques em `INSTALAR.cmd`. O instalador lista as impressoras daquela máquina, inicia o programa escondido e configura a abertura automática com o Windows. O computador do administrador não precisa ficar ligado e o painel não precisa permanecer aberto.

Para a impressão automática, configure no Supabase um segredo chamado `PRINT_AGENT_TOKEN`; coloque o mesmo valor em `config.json` e altere `autoPrint` para `true`. Na primeira conexão o agente apenas sincroniza o histórico, sem imprimir. Depois disso, imprime somente pedidos criados após a ativação. `state.json` evita duplicidade. Impressões solicitadas manualmente no painel chegam por uma fila segura na nuvem.

A4 usa a janela normal do navegador, permitindo escolher Epson ou PDF. Para testar o agente, abra `http://127.0.0.1:17891/status`.
