/**
 * Classificação dos erros da Olist para as retentativas e para o painel
 * "Revisão Olist":
 *  - precisa de ação: só se resolve quando alguém corrige na Olist (total
 *    diferente, nota sem conta, conta duplicada, nota cancelada/denegada,
 *    rejeição fiscal). Nova tentativa só uma vez por dia — ou na hora, pelo
 *    botão "Já corrigi, tentar agora" do painel;
 *  - passageiro: limite/bloqueio da API, tempo esgotado, falha de rede ou
 *    5xx. Fica "aguardando" e é tentado de novo na próxima rodada.
 *
 * O mesmo padrão de "precisa de ação" está em public.admin_sales_fiscal_health
 * (migration 20261113120000); mantenha os dois iguais.
 */

export const NEEDS_ACTION_RETRY_HOURS = 24;

const NEEDS_ACTION_PATTERN =
  /diverge|existe nota fiscal gerada|duplicidade|cancelad|denegad|confirmar o cliente/i;

const TRANSIENT_PATTERN =
  /api bloqueada|limite de chamadas|tempo esgotado|olist respondeu http 5\d\d|fetch failed|network|timed out|econn|connection (?:reset|refused|closed)/i;

export function needsAction(message: unknown): boolean {
  return NEEDS_ACTION_PATTERN.test(String(message ?? ""));
}

export function isTransientOlistError(message: unknown): boolean {
  return TRANSIENT_PATTERN.test(String(message ?? ""));
}

export function nextDailyRetry(now = Date.now()): string {
  return new Date(now + NEEDS_ACTION_RETRY_HOURS * 60 * 60_000).toISOString();
}
