// Verificacao de origem do servidor local do agente.
//
// Mora fora de `server.mjs` para poder ser testada: aquele arquivo abre porta,
// le config.json e agenda o polling no topo do modulo, entao importa-lo num teste
// levantaria o agente inteiro.
//
// Ate 19/08/2026 o agente recusava o proprio painel. O navegador nao envia
// `Origin` em GET, entao /status, /history e /label-orders passavam e a tela abria
// normalmente; mas envia em POST, mesmo same-origin, e `http://127.0.0.1:17891`
// nunca esteve em `allowedOrigins`. So "gerar etiqueta" falhava, com 403 "Origem
// nao autorizada" -- sintoma estreito o bastante para parecer problema de rede.

export const DEFAULT_PORT = 17891;

/** Enderecos em que o proprio painel do agente e servido. */
export function selfOrigins(port) {
  const resolved = Number(port) || DEFAULT_PORT;
  return [`http://127.0.0.1:${resolved}`, `http://localhost:${resolved}`];
}

/**
 * Derivado de `config.port` de proposito: depender de alguem ter editado o
 * config.json a mao quebraria de novo na proxima instalacao. `allowedOrigins`
 * continua valendo, e agora so para o que ele existe -- origens externas.
 */
export function isOriginAllowed(origin, config) {
  if (!origin) return true;
  if (selfOrigins(config?.port).includes(origin)) return true;
  return (config?.allowedOrigins || []).includes(origin);
}
