import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, XCircle, RotateCcw } from "lucide-react";
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
    } catch (err) {
      toast.error(String(err));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="max-w-xl">
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
    </div>
  );
}
