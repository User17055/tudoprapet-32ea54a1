import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, RotateCcw, History, Package, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type LineItem = { title?: string; variant_title?: string; quantity?: number; sku?: string };
type ValidatedOrder = {
  order_number?: string;
  customer_name?: string;
  status?: string;
  items?: LineItem[];
  [k: string]: unknown;
};

type HistoryItem = {
  id: number;
  order_number: string | number;
  name: string;
  customer_name: string;
  created_at: string;
  fulfilled_at: string | null;
  total_price: number;
  currency: string;
  items_count: number;
  items: LineItem[];
};

const formatCurrency = (v: number, c = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: c }).format(v);

const formatDate = (iso: string | null) => {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

async function extractError(error: unknown): Promise<string> {
  const err = error as { message?: string; context?: { text?: () => Promise<string> } };
  let details = err?.message || "Erro desconhecido";
  if (err?.context?.text) {
    try {
      const txt = await err.context.text();
      const parsed = JSON.parse(txt);
      details = parsed.error || parsed.message || txt;
    } catch { /* ignore */ }
  }
  return details;
}

export default function RetiradaTab() {
  const [code, setCode] = useState("");
  const [validating, setValidating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [order, setOrder] = useState<ValidatedOrder | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const handleResendLast = async () => {
    setResending(true);
    try {
      const { data, error } = await supabase.functions.invoke("pickup-resend-last", { body: {} });
      if (error) { toast.error(await extractError(error)); return; }
      if (data?.error) { toast.error(String(data.error)); return; }
      toast.success(`Código reenviado para ${data?.customer_name || "cliente"} (${data?.order_number || ""})`);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setResending(false);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("pickup-history");
      if (error) {
        toast.error(await extractError(error));
        return;
      }
      if (data?.error) {
        toast.error(String(data.error));
        return;
      }
      setHistory((data?.history || []) as HistoryItem[]);
    } catch (err) {
      toast.error(String(err));
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const reset = () => {
    setCode("");
    setOrder(null);
    setErrorMsg(null);
    setCompleted(false);
  };

  const handleValidate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      toast.error("Digite o código");
      return;
    }
    setValidating(true);
    setOrder(null);
    setErrorMsg(null);
    setCompleted(false);
    try {
      const { data, error } = await supabase.functions.invoke("pickup-validate", {
        body: { code: trimmed },
      });
      if (error) {
        setErrorMsg(await extractError(error));
        return;
      }
      if (data?.error) {
        setErrorMsg(String(data.error));
        return;
      }
      setOrder((data?.order || data) as ValidatedOrder);
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setValidating(false);
    }
  };

  const handleComplete = async () => {
    setConfirming(true);
    try {
      const { data, error } = await supabase.functions.invoke("pickup-complete", {
        body: { code: code.trim() },
      });
      if (error) {
        toast.error(await extractError(error));
        return;
      }
      if (data?.error) {
        toast.error(String(data.error));
        return;
      }
      setCompleted(true);
      toast.success("Retirada confirmada!");
      loadHistory();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Código de retirada</CardTitle>
          <CardDescription>O cliente recebeu o código por WhatsApp.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleValidate} className="flex gap-2">
            <Input
              autoFocus
              placeholder="Ex: LT-483920"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={validating || completed}
              className="text-center text-lg font-bold tracking-widest uppercase"
            />
            <Button type="submit" disabled={validating || !code.trim() || completed}>
              {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validar"}
            </Button>
          </form>

          {errorMsg && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>{errorMsg}</p>
            </div>
          )}

          {order && !completed && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                Código válido
              </div>
              <dl className="text-sm space-y-1">
                {order.order_number && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Pedido</dt>
                    <dd className="font-semibold">#{String(order.order_number)}</dd>
                  </div>
                )}
                {order.customer_name && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Cliente</dt>
                    <dd className="font-semibold">{String(order.customer_name)}</dd>
                  </div>
                )}
                {order.status && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Status</dt>
                    <dd className="font-semibold">{String(order.status)}</dd>
                  </div>
                )}
              </dl>
              {order.items && order.items.length > 0 && (
                <div className="mt-3 border-t border-primary/20 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Itens a entregar ({order.items.reduce((s, i) => s + (i.quantity || 0), 0)})
                  </p>
                  <ul className="space-y-1.5 text-sm">
                    {order.items.map((it, idx) => (
                      <li key={idx} className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <p className="font-medium leading-tight">{it.title}</p>
                          {it.variant_title && it.variant_title !== "Default Title" && (
                            <p className="text-xs text-muted-foreground">{it.variant_title}</p>
                          )}
                          {it.sku && <p className="text-[10px] text-muted-foreground">SKU: {it.sku}</p>}
                        </div>
                        <span className="shrink-0 rounded bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                          {it.quantity}x
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Button
                onClick={handleComplete}
                disabled={confirming}
                className="w-full mt-2"
                size="lg"
              >
                {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar retirada"}
              </Button>
            </div>
          )}

          {completed && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-center space-y-3">
              <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
              <p className="font-bold text-emerald-700">Pedido retirado com sucesso!</p>
              <Button onClick={reset} variant="outline" size="sm">
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                Novo código
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Histórico de retiradas
            </CardTitle>
            <CardDescription>Últimos pedidos marcados como retirados.</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadHistory}
            disabled={historyLoading}
          >
            {historyLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </CardHeader>
        <CardContent>
          {historyLoading && history.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
              Carregando...
            </div>
          ) : history.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Nenhuma retirada registrada ainda.
            </div>
          ) : (
            <ul className="divide-y">
              {history.map((h) => (
                <li key={h.id} className="py-3 flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm truncate">
                        {h.name || `#${h.order_number}`}
                        <span className="ml-2 text-muted-foreground font-normal">
                          {h.customer_name}
                        </span>
                      </p>
                      <p className="text-sm font-bold whitespace-nowrap">
                        {formatCurrency(h.total_price, h.currency)}
                      </p>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-xs text-muted-foreground">
                        {formatDate(h.fulfilled_at || h.created_at)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {h.items_count} {h.items_count === 1 ? "item" : "itens"}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
