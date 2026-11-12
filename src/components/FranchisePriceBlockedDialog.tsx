import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, SearchCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCartStore } from "@/stores/cartStore";
import { closeFranchisePriceBlocked, useFranchisePriceBlocked } from "@/lib/franchisePriceBlocked";

/**
 * Aviso para a franquia quando um produto está sem preço de franquia (o
 * sistema já tentou buscar o custo na Olist e não conseguiu). Ela pode remover
 * o item e fechar o resto do pedido, ou pedir a revisão do produto.
 */
export function FranchisePriceBlockedDialog() {
  const items = useFranchisePriceBlocked();
  const removeItem = useCartStore((state) => state.removeItem);
  const [busy, setBusy] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  useEffect(() => {
    setRequested(new Set());
    setRemoved(new Set());
  }, [items]);

  const requestReview = async (variantId: string) => {
    setBusy(`review:${variantId}`);
    const { data, error } = await supabase.functions.invoke("franchise-price-review", {
      body: { action: "request", variantId },
    });
    setBusy(null);
    if (error || data?.error) {
      toast.error(data?.error || "Não foi possível pedir a revisão agora.");
      return;
    }
    setRequested((previous) => new Set(previous).add(variantId));
    toast.success("Revisão solicitada. Avisaremos no seu painel de pedidos.");
  };

  const remove = async (variantId: string) => {
    setBusy(`remove:${variantId}`);
    try {
      await removeItem(variantId);
      setRemoved((previous) => new Set(previous).add(variantId));
    } finally {
      setBusy(null);
    }
  };

  const allRemoved = items.length > 0 && items.every((item) => removed.has(item.variantId));

  return (
    <Dialog open={items.length > 0} onOpenChange={(open) => !open && closeFranchisePriceBlocked()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Produto sem preço de franquia</DialogTitle>
          <DialogDescription>
            Para não cobrar o preço cheio, estes produtos não entram no pedido agora. Remova-os para
            finalizar o restante, ou peça a revisão para a nossa equipe.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-3">
          {items.map((item) => {
            const isRequested = requested.has(item.variantId) || !item.canRequestReview && item.reviewStatus === "requested";
            const isRemoved = removed.has(item.variantId);
            return (
              <li key={item.variantId} className="rounded-xl border border-border p-3">
                <p className="text-sm font-semibold text-foreground">{item.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {requested.has(item.variantId)
                    ? "Revisão solicitada. Avisaremos no seu painel quando o produto for liberado."
                    : item.message}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    disabled={isRemoved || busy !== null}
                    onClick={() => void remove(item.variantId)}
                  >
                    {busy === `remove:${item.variantId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isRemoved ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                    {isRemoved ? "Removido do carrinho" : "Remover do carrinho"}
                  </Button>
                  {(item.canRequestReview || requested.has(item.variantId)) && (
                    <Button
                      size="sm"
                      className="gap-1"
                      disabled={isRequested || busy !== null}
                      onClick={() => void requestReview(item.variantId)}
                    >
                      {busy === `review:${item.variantId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isRequested ? <CheckCircle2 className="h-3.5 w-3.5" /> : <SearchCheck className="h-3.5 w-3.5" />}
                      {isRequested ? "Revisão solicitada" : "Pedir revisão"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button variant={allRemoved ? "default" : "outline"} onClick={closeFranchisePriceBlocked}>
            {allRemoved ? "Continuar com o restante" : "Fechar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
