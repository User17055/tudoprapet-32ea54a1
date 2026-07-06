import { useState } from "react";
import { Check, Loader2, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useCartStore } from "@/stores/cartStore";
import { toast } from "sonner";

export const CouponInput = () => {
  const { discountCode, applyDiscount, removeDiscount } = useCartStore();
  const { isSubscribed } = useSubscription();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  // O checkout do clube (draft order) não aceita cupom do carrinho
  if (isSubscribed) return null;

  const handleApply = async () => {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const ok = await applyDiscount(trimmed);
      if (ok) {
        setCode("");
        toast.success("Cupom aplicado! O desconto aparece no checkout.");
      } else {
        toast.error("Cupom inválido ou expirado.");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await removeDiscount();
    } finally {
      setBusy(false);
    }
  };

  if (discountCode) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-full border border-pet-green/40 bg-pet-green/10 py-1 pl-3 pr-1">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-pet-green">
          <Check className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">Cupom {discountCode} aplicado</span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={handleRemove}
          disabled={busy}
          aria-label="Remover cupom"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Tag className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && handleApply()}
          placeholder="Cupom de desconto"
          disabled={busy}
          className="h-9 rounded-full pl-9 text-sm"
          aria-label="Cupom de desconto"
        />
      </div>
      <Button
        variant="outline"
        onClick={handleApply}
        disabled={busy || !code.trim()}
        className="h-9 rounded-full px-4 font-display text-sm font-bold"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aplicar"}
      </Button>
    </div>
  );
};
