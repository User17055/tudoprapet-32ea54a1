import { CheckCircle2, FileWarning, Landmark, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface SalesFiscalIssue {
  id: string;
  created_at: string;
  customer_type: "common" | "subscriber" | "franchise" | string;
  total: number | null;
  currency: string | null;
  olist_order_number: string | null;
  customer_name: string;
  issue: "invoice" | "settlement" | "receivable";
  origin?: "site" | "olist";
  invoice_status: string | null;
  reason: string;
}

export interface SalesFiscalHealth {
  without_invoice: number;
  unsettled_paid: number;
  without_receivable?: number;
  items: SalesFiscalIssue[];
}

const ISSUE_LABELS: Record<SalesFiscalIssue["issue"], string> = {
  invoice: "Sem nota",
  settlement: "Sem baixa",
  receivable: "Sem boleto",
};

const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  common: "Cliente",
  subscriber: "Assinante",
  franchise: "Franquia",
};

const money = (value: number | null, currency?: string | null) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(Number(value) || 0);

const age = (iso: string) => {
  const hours = Math.floor((Date.now() - Date.parse(iso)) / 3_600_000);
  if (hours < 1) return "há menos de 1 h";
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} dias`;
};

/**
 * Toda venda tem que ter NF-e e venda paga no site não pode ficar com conta em
 * aberto na Olist. Os dois contadores precisam estar em zero.
 */
export function SalesFiscalHealthCard({
  health,
  loading,
  error,
}: {
  health: SalesFiscalHealth | null;
  loading: boolean;
  error: string | null;
}) {
  const counters = [
    { label: "Vendas sem nota fiscal", value: health?.without_invoice ?? 0, icon: FileWarning },
    { label: "Pagas com conta em aberto", value: health?.unsettled_paid ?? 0, icon: Landmark },
    { label: "Franquia sem boleto", value: health?.without_receivable ?? 0, icon: Receipt },
  ];
  const allClear = !!health && counters.every((counter) => counter.value === 0);

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Nota fiscal e baixa</CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Vendas do site e pedidos de venda da Olist há mais de 30 minutos. Todos os números precisam estar em zero.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {counters.map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-4",
                !loading && value > 0 ? "border-rose-200 bg-rose-50/70" : "border-border/80",
              )}
            >
              <span
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                  !loading && value > 0 ? "bg-rose-100 text-rose-700" : "bg-emerald-50 text-emerald-700",
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              <div>
                {loading ? (
                  <Skeleton className="h-7 w-10" />
                ) : (
                  <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
                )}
                <p className="text-sm font-medium text-muted-foreground">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {error && <p className="text-sm text-destructive">Não foi possível carregar as pendências: {error}</p>}

        {!loading && allClear && (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Todas as vendas estão com nota emitida e baixa confirmada.
          </p>
        )}

        {!loading && health && health.items.length > 0 && (
          <ul className="divide-y divide-border/70 text-sm">
            {health.items.map((item) => (
              <li key={`${item.id}-${item.issue}`} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">
                    {ISSUE_LABELS[item.issue] || item.issue}
                    <span className="font-normal text-muted-foreground">
                      {" · "}
                      {item.origin === "olist" ? "Pedido de venda · " : ""}
                      {CUSTOMER_TYPE_LABELS[item.customer_type] || "Cliente não identificado"}
                      {item.customer_name ? ` · ${item.customer_name}` : ""}
                      {item.olist_order_number ? ` · Pedido de venda ${item.olist_order_number}` : ""}
                    </span>
                  </p>
                  <p className="break-words text-xs text-muted-foreground">{item.reason}</p>
                </div>
                <div className="flex shrink-0 gap-3 text-xs text-muted-foreground sm:flex-col sm:items-end sm:gap-0.5">
                  <span className="font-semibold tabular-nums text-foreground">{money(item.total, item.currency)}</span>
                  <span>{age(item.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
