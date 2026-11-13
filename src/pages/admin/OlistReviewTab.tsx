import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  FileWarning,
  Landmark,
  Loader2,
  PlugZap,
  Receipt,
  RefreshCw,
  Search,
  Store,
  Hourglass,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import {
  CUSTOMER_TYPE_LABELS,
  formatAge,
  formatMoney,
  formatNextRetry,
  ISSUE_LABELS,
  type SalesFiscalHealth,
  type SalesFiscalIssue,
} from "@/lib/olistReview";
import { cn } from "@/lib/utils";
import { AutomationStatusCard, type AutomationStatus } from "./AutomationStatusCard";
import { FranchisePriceReviewsCard } from "./FranchisePriceReviewsCard";

type Section = "pending" | "prices" | "automations";
type IssueFilter = "all" | SalesFiscalIssue["issue"];
type OriginFilter = "all" | "site" | "olist";
type StateFilter = "all" | "action" | "waiting";

const ISSUE_STYLES: Record<SalesFiscalIssue["issue"], { bar: string; chip: string; icon: LucideIcon }> = {
  invoice: { bar: "bg-rose-500", chip: "bg-rose-50 text-rose-700 ring-rose-600/20", icon: FileWarning },
  settlement: { bar: "bg-amber-500", chip: "bg-amber-50 text-amber-800 ring-amber-600/20", icon: Landmark },
  receivable: { bar: "bg-violet-500", chip: "bg-violet-50 text-violet-700 ring-violet-600/20", icon: Receipt },
};

/**
 * Tudo o que depende da Olist em um só lugar: vendas sem nota ou sem baixa,
 * franquia sem boleto, revisão de preço de franquia e a saúde das automações.
 */
export default function OlistReviewTab() {
  const [health, setHealth] = useState<SalesFiscalHealth | null>(null);
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [section, setSection] = useState<Section>("pending");
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("all");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [query, setQuery] = useState("");
  const [openReviews, setOpenReviews] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [healthResult, statusResult] = await Promise.all([
      supabase.rpc("admin_sales_fiscal_health"),
      supabase.rpc("admin_automation_status"),
    ]);
    setHealthError(healthResult.error?.message || null);
    setStatusError(statusResult.error?.message || null);
    if (!healthResult.error) setHealth(healthResult.data as unknown as SalesFiscalHealth);
    if (!statusResult.error) setStatus(statusResult.data as unknown as AutomationStatus);
    setUpdatedAt(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const withoutInvoice = health?.without_invoice ?? 0;
  const unsettled = health?.unsettled_paid ?? 0;
  const withoutReceivable = health?.without_receivable ?? 0;
  const priceReviews = openReviews ?? status?.price_reviews.open ?? 0;
  const api = status?.olist_api;
  const apiBlocked = !!api?.blocked_until && Date.parse(api.blocked_until) > Date.now();
  const totalPending = withoutInvoice + unsettled + withoutReceivable + priceReviews;

  const items = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (health?.items ?? []).filter((item) =>
      (issueFilter === "all" || item.issue === issueFilter) &&
      (stateFilter === "all" || (stateFilter === "action") === Boolean(item.needs_action)) &&
      (originFilter === "all" || (item.origin ?? "site") === originFilter) &&
      (!needle ||
        item.customer_name.toLowerCase().includes(needle) ||
        String(item.olist_order_number || "").includes(needle))
    );
  }, [health, issueFilter, originFilter, stateFilter, query]);

  const needsActionCount = health?.needs_action ?? 0;
  const waitingCount = health?.waiting ?? 0;

  // "Já corrigi, tentar agora": antecipa a próxima tentativa do sistema.
  const retryNow = async (item: SalesFiscalIssue) => {
    const { error } = await supabase.rpc("admin_retry_olist_issue", {
      p_id: item.id,
      p_issue: item.issue,
      p_origin: item.origin ?? "site",
    });
    if (error) {
      toast.error("Não foi possível agendar a nova tentativa", { description: error.message });
      return;
    }
    toast.success("Nova tentativa na próxima rodada (até 10 minutos).");
    await load();
  };

  const openPending = (filter: IssueFilter) => {
    setSection("pending");
    setIssueFilter(filter);
  };

  const tiles: Array<{
    key: string;
    label: string;
    value: string | number;
    hint: string;
    icon: LucideIcon;
    alert: boolean;
    active: boolean;
    onClick: () => void;
  }> = [
    {
      key: "invoice",
      label: "Vendas sem nota",
      value: withoutInvoice,
      hint: "Toda venda precisa de NF-e",
      icon: FileWarning,
      alert: withoutInvoice > 0,
      active: section === "pending" && issueFilter === "invoice",
      onClick: () => openPending("invoice"),
    },
    {
      key: "settlement",
      label: "Pagas sem baixa",
      value: unsettled,
      hint: "Pagas no site, conta aberta na Olist",
      icon: Landmark,
      alert: unsettled > 0,
      active: section === "pending" && issueFilter === "settlement",
      onClick: () => openPending("settlement"),
    },
    {
      key: "receivable",
      label: "Franquia sem boleto",
      value: withoutReceivable,
      hint: "Pedido de venda sem conta a receber",
      icon: Receipt,
      alert: withoutReceivable > 0,
      active: section === "pending" && issueFilter === "receivable",
      onClick: () => openPending("receivable"),
    },
    {
      key: "prices",
      label: "Preço de franquia",
      value: priceReviews,
      hint: "Produtos sem custo bloqueados",
      icon: CircleDollarSign,
      alert: priceReviews > 0,
      active: section === "prices",
      onClick: () => setSection("prices"),
    },
    {
      key: "api",
      label: "API da Olist",
      value: apiBlocked ? "Bloqueada" : api ? "Liberada" : "—",
      hint: api ? `${api.calls_today} chamadas hoje · ${api.blocks_today} bloqueios` : "Sem dados ainda",
      icon: PlugZap,
      alert: apiBlocked || (api?.blocks_today ?? 0) > 0,
      active: section === "automations",
      onClick: () => setSection("automations"),
    },
  ];

  const sections: Array<{ id: Section; label: string; count?: number }> = [
    { id: "pending", label: "Pendências", count: withoutInvoice + unsettled + withoutReceivable },
    { id: "prices", label: "Revisão de preço", count: priceReviews },
    { id: "automations", label: "Automações" },
  ];

  return (
    <div className="space-y-6">
      {/* Cabeçalho com a situação em uma frase. */}
      <section className="relative overflow-hidden rounded-2xl bg-[hsl(var(--admin-sidebar))] p-6 text-white sm:p-8">
        <div
          className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-[hsl(var(--admin-gold))]/15 blur-2xl"
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-white/65">Olist · notas, baixas, boletos e preços</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Revisão Olist</h2>
            <p className="mt-2 flex items-center gap-2 text-sm text-white/80">
              {loading && !health ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Conferindo...</>
              ) : totalPending > 0 ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-[hsl(var(--admin-gold))]" />
                  {totalPending === 1 ? "1 pendência precisa de atenção." : `${totalPending} pendências precisam de atenção.`}
                  {health && (
                    <span className="text-white/60">
                      {needsActionCount} precisam de ação · {waitingCount} aguardando o sistema
                    </span>
                  )}
                </>
              ) : (
                <><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Tudo em dia: toda venda com nota, baixa e boleto.</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {updatedAt && (
              <span className="text-xs text-white/60">
                Atualizado às {updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <Button
              size="sm"
              variant="secondary"
              className="gap-2 bg-white/10 text-white ring-1 ring-white/15 hover:bg-white/20"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar
            </Button>
          </div>
        </div>
      </section>

      {/* Indicadores: cada um leva à lista correspondente. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {tiles.map(({ key, label, value, hint, icon: Icon, alert, active, onClick }) => (
          <button
            key={key}
            type="button"
            onClick={onClick}
            className={cn(
              "group rounded-xl border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active && "border-primary/40 ring-2 ring-primary/20",
            )}
          >
            <div className="flex items-start justify-between">
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-xl",
                  alert ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700",
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className={cn("h-2 w-2 rounded-full", alert ? "bg-rose-500" : "bg-emerald-500")} aria-hidden="true" />
            </div>
            {loading && !health ? (
              <Skeleton className="mt-4 h-7 w-14" />
            ) : (
              <p className="mt-4 text-2xl font-bold tabular-nums tracking-tight text-foreground">{value}</p>
            )}
            <p className="mt-0.5 text-sm font-semibold text-foreground">{label}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </button>
        ))}
      </div>

      {/* Seções */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Seções da revisão Olist">
        {sections.map(({ id, label, count }) => (
          <Button
            key={id}
            role="tab"
            aria-selected={section === id}
            size="sm"
            variant={section === id ? "default" : "outline"}
            className="rounded-full"
            onClick={() => setSection(id)}
          >
            {id === "automations" && <Activity className="mr-1.5 h-4 w-4" />}
            {label}
            {count !== undefined && (
              <span
                className={cn(
                  "ml-2 rounded-full px-1.5 text-xs tabular-nums",
                  section === id ? "bg-white/20" : count > 0 ? "bg-rose-100 text-rose-700" : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            )}
          </Button>
        ))}
      </div>

      {section === "pending" && (
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-1.5">
                {(["all", "action", "waiting"] as const).map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={stateFilter === value ? "secondary" : "ghost"}
                    className="h-8 gap-1 rounded-full"
                    onClick={() => setStateFilter(value)}
                  >
                    {value === "action" && <Wrench className="h-3.5 w-3.5" />}
                    {value === "waiting" && <Hourglass className="h-3.5 w-3.5" />}
                    {value === "all" ? "Todas as situações" : value === "action" ? `Precisa de ação (${needsActionCount})` : `Aguardando (${waitingCount})`}
                  </Button>
                ))}
                <span className="mx-1 hidden w-px bg-border sm:block" aria-hidden="true" />
                {(["all", "invoice", "settlement", "receivable"] as const).map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={issueFilter === value ? "secondary" : "ghost"}
                    className="h-8 rounded-full"
                    onClick={() => setIssueFilter(value)}
                  >
                    {value === "all" ? "Todas" : ISSUE_LABELS[value]}
                  </Button>
                ))}
                <span className="mx-1 hidden w-px bg-border sm:block" aria-hidden="true" />
                {(["all", "site", "olist"] as const).map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={originFilter === value ? "secondary" : "ghost"}
                    className="h-8 rounded-full"
                    onClick={() => setOriginFilter(value)}
                  >
                    {value === "all" ? "Todas as origens" : value === "site" ? "Site" : "Pedido de venda"}
                  </Button>
                ))}
              </div>
              <div className="relative lg:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Cliente ou nº do pedido"
                  className="h-9 pl-9"
                  aria-label="Buscar pendência"
                />
              </div>
            </div>

            {healthError ? (
              <p className="text-sm text-destructive">Não foi possível carregar as pendências: {healthError}</p>
            ) : loading && !health ? (
              <div className="space-y-2">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-16 w-full" />)}</div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                </span>
                <p className="font-semibold text-foreground">
                  {(health?.items.length ?? 0) === 0 ? "Nenhuma pendência" : "Nada com esse filtro"}
                </p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Vendas concluídas há mais de 30 minutos com nota, baixa e boleto em dia não aparecem aqui.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {items.map((item) => (
                  <IssueRow key={`${item.id}-${item.issue}`} item={item} onRetry={() => retryNow(item)} />
                ))}
              </ul>
            )}

            {(health?.items.length ?? 0) >= 100 && (
              <p className="text-xs text-muted-foreground">Mostrando as 100 pendências mais antigas.</p>
            )}
            <p className="text-xs text-muted-foreground">
              <strong>Aguardando:</strong> o sistema resolve sozinho, tentando a cada 10 minutos.
              {" "}<strong>Precisa de ação:</strong> só se resolve com ajuste na Olist (rejeição fiscal, total
              diferente, nota sem conta); o sistema tenta uma vez por dia. Depois de corrigir, use
              {" "}"Já corrigi, tentar agora".
            </p>
          </CardContent>
        </Card>
      )}

      {section === "prices" && <FranchisePriceReviewsCard onCountChange={setOpenReviews} />}

      {section === "automations" && (
        <AutomationStatusCard status={status} loading={loading} error={statusError} />
      )}
    </div>
  );
}

function IssueRow({ item, onRetry }: { item: SalesFiscalIssue; onRetry: () => Promise<void> }) {
  const style = ISSUE_STYLES[item.issue];
  const Icon = style.icon;
  const [retrying, setRetrying] = useState(false);
  const nextRetry = formatNextRetry(item.next_retry_at);
  return (
    <li className="relative flex flex-col gap-3 overflow-hidden rounded-xl border border-border/80 bg-card p-4 pl-5 sm:flex-row sm:items-start">
      <span className={cn("absolute inset-y-0 left-0 w-1", style.bar)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-inset", style.chip)}>
            <Icon className="h-3 w-3" /> {ISSUE_LABELS[item.issue]}
          </span>
          {item.needs_action ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-800 ring-1 ring-inset ring-orange-600/20">
              <Wrench className="h-3 w-3" /> Precisa de ação
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700 ring-1 ring-inset ring-sky-600/20">
              <Hourglass className="h-3 w-3" /> Aguardando
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {item.origin === "olist" ? <Store className="h-3 w-3" /> : null}
            {item.origin === "olist" ? "Pedido de venda" : "Site"}
          </span>
          <span className="text-xs text-muted-foreground">
            {CUSTOMER_TYPE_LABELS[item.customer_type] || item.customer_type}
          </span>
        </div>
        <p className="mt-1.5 truncate text-sm font-semibold text-foreground">
          {item.customer_name || CUSTOMER_TYPE_LABELS.unknown}
          {item.olist_order_number && (
            <span className="font-normal text-muted-foreground"> · Pedido de venda nº {item.olist_order_number}</span>
          )}
        </p>
        <p className="mt-0.5 break-words text-xs text-muted-foreground">{item.reason}</p>
        {nextRetry && (
          <p className="mt-0.5 text-xs text-muted-foreground/80">Próxima tentativa automática {nextRetry}</p>
        )}
        {item.needs_action && (
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-7 gap-1 px-2.5 text-xs"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              try {
                await onRetry();
              } finally {
                setRetrying(false);
              }
            }}
          >
            {retrying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Já corrigi, tentar agora
          </Button>
        )}
      </div>
      <div className="flex shrink-0 items-baseline gap-3 sm:flex-col sm:items-end sm:gap-0.5">
        <span className="text-sm font-bold tabular-nums text-foreground">{formatMoney(item.total, item.currency)}</span>
        <span className="text-xs text-muted-foreground">{formatAge(item.created_at)}</span>
      </div>
    </li>
  );
}
