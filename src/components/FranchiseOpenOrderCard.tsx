import { Archive, ArrowRight, Clock3, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useFranchiseOpenOrder, type FranchiseOpenOrderItem } from "@/hooks/useFranchiseOpenOrder";
import { startCustomCheckout } from "@/lib/customCheckout";

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export function FranchiseOpenOrderCard({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate();
  const { order, loading, busy, replace, cancel } = useFranchiseOpenOrder(enabled);

  const update = async (variantId: string, quantity: number) => {
    if (!order) return;
    const next = order.items
      .map((item) => item.variantId === variantId ? { ...item, quantity } : item)
      .filter((item) => item.quantity > 0);
    try {
      if (!next.length) await cancel();
      else await replace(next.map(({ variantId: id, quantity: qty }) => ({ variantId: id, quantity: qty })));
      toast.success(next.length ? "Reserva atualizada" : "Pedido em aberto cancelado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o pedido");
    }
  };

  const cancelOrder = async () => {
    if (!window.confirm("Cancelar o pedido em aberto e devolver os itens ao estoque?")) return;
    try {
      await cancel();
      toast.success("Pedido cancelado e estoque liberado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cancelar o pedido");
    }
  };

  if (!enabled || (!loading && !order)) return null;
  if (loading) return <Card><CardContent className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></CardContent></Card>;
  if (!order) return null;
  const total = order.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const totalItems = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const checkout = () => startCustomCheckout(
    navigate,
    order.items.map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
      productTitle: item.title,
      variantTitle: item.variantTitle,
      imageUrl: item.imageUrl,
      unitPrice: item.unitPrice,
    })),
    "open_order",
    order.id,
  );

  return (
    <Card className="overflow-hidden border-amber-300 bg-amber-50/40">
      <CardContent className="p-0">
        <div className="flex flex-col gap-3 border-b border-amber-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-amber-700" />
              <h2 className="font-display text-lg font-bold">Pedido em aberto</h2>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-800">
              <Clock3 className="h-3.5 w-3.5" /> Estoque reservado até {new Date(order.reserved_until).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
            </p>
          </div>
          <span className="text-sm font-semibold text-amber-900">{totalItems} {totalItems === 1 ? "item" : "itens"}</span>
        </div>

        <div className="divide-y divide-amber-200/70 px-5">
          {order.items.map((item: FranchiseOpenOrderItem) => (
            <div key={item.variantId} className="flex items-center gap-3 py-4">
              {item.imageUrl ? <img src={item.imageUrl} alt="" className="h-14 w-14 rounded-lg bg-muted object-cover" /> : <div className="h-14 w-14 rounded-lg bg-muted" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{item.title}</p>
                {item.variantTitle && item.variantTitle !== "Default Title" && <p className="truncate text-xs text-muted-foreground">{item.variantTitle}</p>}
                <p className="mt-1 text-sm font-semibold text-primary">{money(item.unitPrice * item.quantity)}</p>
              </div>
              <div className="flex items-center rounded-full border bg-background p-0.5">
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" disabled={busy} onClick={() => void update(item.variantId, item.quantity - 1)}><Minus className="h-3 w-3" /></Button>
                <span className="w-8 text-center text-sm font-bold">{item.quantity}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" disabled={busy} onClick={() => void update(item.variantId, item.quantity + 1)}><Plus className="h-3 w-3" /></Button>
              </div>
              <Button variant="ghost" size="icon" className="text-destructive" disabled={busy} onClick={() => void update(item.variantId, 0)} aria-label={`Remover ${item.title}`}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-amber-200 bg-background/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs text-muted-foreground">Total reservado</p><p className="font-display text-xl font-bold">{money(total)}</p></div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => void cancelOrder()}>Cancelar pedido</Button>
            <Button className="font-bold" disabled={busy} onClick={checkout}>Ir para pagamento <ArrowRight className="ml-2 h-4 w-4" /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
