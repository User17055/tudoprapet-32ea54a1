import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Level = "ok" | "warn" | "error" | "idle";

interface Counts { [key: string]: number | undefined }

export interface AutomationStatus {
  now: string;
  reconcile: {
    last_run: string | null;
    details: {
      invoices?: Counts;
      customerInvoices?: Counts;
      asaasBridge?: Counts;
      outOfTime?: boolean;
      callsPerMinute?: number;
    } | null;
  } | null;
  sales_sync: {
    last_run: string | null;
    last_scan: string | null;
    details: { queue?: Counts; scan?: { error?: string }; events?: Counts } | null;
    orders: number;
    queue: number;
    waiting: number;
    with_errors: number;
    franchise: number;
    automated: number;
    automated_issued: number;
  };
  webhooks: { total: number; last_received: string | null; pending: number; failed: number };
  olist_api: {
    calls_today: number;
    blocks_today: number;
    throttled_today: number;
    last_blocked_at: string | null;
    blocked_until: string | null;
  } | null;
  price_reviews: { open: number; requested: number };
}

const DOT: Record<Level, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  error: "bg-rose-500",
  idle: "bg-slate-300",
};

function minutesSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
}

function ago(minutes: number | null): string {
  if (minutes === null) return "nunca";
  if (minutes < 1) return "agora há pouco";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `há ${hours} h` : `há ${Math.floor(hours / 24)} dias`;
}

/** Nível do "rodou recentemente?" para um job que roda a cada 10 minutos. */
function freshness(minutes: number | null): Level {
  if (minutes === null) return "error";
  if (minutes <= 25) return "ok";
  return minutes <= 60 ? "warn" : "error";
}

const sum = (counts: Counts | undefined, key: string) => Number(counts?.[key] || 0);

function Row({ level, title, status, children }: { level: Level; title: string; status: string; children?: React.ReactNode }) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", DOT[level])} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground">{status}</p>
          </div>
          {children && <div className="mt-1 text-xs text-muted-foreground">{children}</div>}
        </div>
      </div>
    </li>
  );
}

/**
 * Situação das automações da Olist: conciliação (notas e baixas), vendas
 * lançadas na Olist, webhooks, limite da API e revisões de preço de franquia.
 */
export function AutomationStatusCard({
  status,
  loading,
  error,
}: {
  status: AutomationStatus | null;
  loading: boolean;
  error: string | null;
}) {
  const now = status ? Date.parse(status.now) : Date.now();
  const reconcileAgo = minutesSince(status?.reconcile?.last_run, now);
  const salesAgo = minutesSince(status?.sales_sync.last_run, now);
  const scanAgo = minutesSince(status?.sales_sync.last_scan, now);
  const details = status?.reconcile?.details;
  const api = status?.olist_api;
  const blockedNow = !!api?.blocked_until && Date.parse(api.blocked_until) > now;
  const webhooks = status?.webhooks;
  const sales = status?.sales_sync;

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" /> Automações da Olist
        </CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Rodam sozinhas a cada 10 minutos. Verde: em dia; amarelo: atenção; vermelho: parada; cinza: não configurado.
        </p>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">
            Não foi possível ler a situação das automações ({error}). Confira se a migration
            {" "}<code>20261112190000_olist_rate_limit_and_automation_status.sql</code> foi aplicada.
          </p>
        ) : loading && !status ? (
          <div className="space-y-3">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-10 w-full" />)}</div>
        ) : status ? (
          <ul className="divide-y divide-border/70">
            <Row
              level={freshness(reconcileAgo)}
              title="Conciliação: notas e baixas"
              status={`Última execução ${ago(reconcileAgo)}`}
            >
              {details ? (
                <>
                  Notas na última rodada: {sum(details.invoices, "issued") + sum(details.customerInvoices, "issued")} emitidas,
                  {" "}{sum(details.invoices, "pending") + sum(details.customerInvoices, "pending")} aguardando,
                  {" "}{sum(details.invoices, "rejected") + sum(details.customerInvoices, "rejected")} recusadas ·
                  {" "}Baixas: {sum(details.asaasBridge, "settled")} feitas, {sum(details.asaasBridge, "awaitingImport")} aguardando importação
                  {details.outOfTime && " · rodada encerrada pelo tempo (continua na próxima)"}
                </>
              ) : "Ainda sem registro de execução (aparece após a primeira rodada com a versão nova)."}
            </Row>

            {sales && (
              <Row
                level={sales.with_errors > 0 ? "warn" : freshness(salesAgo)}
                title="Vendas lançadas na Olist"
                status={`Última execução ${ago(salesAgo)} · varredura ${ago(scanAgo)}`}
              >
                {sales.orders} pedidos espelhados ({sales.franchise} de franquia) · {sales.queue} na fila
                {sales.with_errors > 0 && ` · ${sales.with_errors} com erro (nova tentativa automática)`} ·
                {" "}automação: {sales.automated_issued} de {sales.automated} com nota emitida
              </Row>
            )}

            {webhooks && (
              <Row
                level={webhooks.total === 0 ? "idle" : webhooks.failed > 0 ? "warn" : "ok"}
                title="Webhooks da Olist (tempo real)"
                status={webhooks.total === 0 ? "Nenhum aviso recebido" : `Último aviso ${ago(minutesSince(webhooks.last_received, now))}`}
              >
                {webhooks.total === 0
                  ? "Cadastre os webhooks na Olist para atualizar na hora. Sem eles, a varredura de hora em hora mantém tudo em dia."
                  : `${webhooks.total} avisos recebidos · ${webhooks.pending} pendentes${webhooks.failed ? ` · ${webhooks.failed} com falha (reprocessados sozinhos)` : ""}`}
              </Row>
            )}

            {api && (
              <Row
                level={blockedNow ? "error" : api.blocks_today > 0 ? "warn" : "ok"}
                title="Limite da API da Olist"
                status={blockedNow ? `Bloqueada até ${new Date(api.blocked_until!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "Liberada"}
              >
                Hoje: {api.calls_today} chamadas · {api.blocks_today} bloqueios da Olist · {api.throttled_today} esperas pelo limite
                {details?.callsPerMinute ? ` · limite configurado: ${details.callsPerMinute}/min (70% para automações)` : ""}
              </Row>
            )}

            <Row
              level={status.price_reviews.requested > 0 ? "warn" : "ok"}
              title="Revisão de preço de franquia"
              status={status.price_reviews.open === 0 ? "Nada pendente" : `${status.price_reviews.open} produto(s) em aberto`}
            >
              {status.price_reviews.requested > 0
                ? `${status.price_reviews.requested} com pedido de revisão de franquia — veja o cartão "Revisão de preço de franquia".`
                : "Produtos sem custo são resolvidos sozinhos pela Olist quando possível."}
            </Row>
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
