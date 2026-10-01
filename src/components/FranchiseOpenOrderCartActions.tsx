import { Archive, Clock3, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useFranchiseOpenOrder, type OpenOrderInputItem } from "@/hooks/useFranchiseOpenOrder";

interface Props {
  enabled: boolean;
  items: OpenOrderInputItem[];
  disabled?: boolean;
  onSaved: () => void;
}

export function FranchiseOpenOrderCartActions({ enabled, items, disabled, onSaved }: Props) {
  const { order, loading, busy, save, add } = useFranchiseOpenOrder(enabled);
  if (!enabled) return null;

  const submit = async () => {
    try {
      await (order ? add(items) : save(items));
      onSaved();
      toast.success(order ? "Itens adicionados ao pedido em aberto" : "Pedido salvo e estoque reservado");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o pedido");
    }
  };

  return (
    <div className="space-y-2">
      {order && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="flex items-center gap-1.5 font-semibold">
            <Clock3 className="h-3.5 w-3.5" /> Pedido em aberto com estoque reservado
          </span>
          <Link to="/meus-pedidos" className="shrink-0 font-bold underline underline-offset-2">Gerenciar</Link>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        className="w-full rounded-full font-display font-bold"
        disabled={disabled || loading || busy || items.length === 0}
        onClick={() => void submit()}
      >
        {loading || busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Archive className="mr-2 h-4 w-4" />}
        {order ? "Adicionar ao pedido existente" : "Salvar pedido"}
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">
        Ao salvar, os produtos ficam reservados por até 72 horas.
      </p>
    </div>
  );
}
