import { useState } from "react";
import { BadgePercent, Loader2, TicketPercent, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCartStore } from "@/stores/cartStore";
import { toast } from "sonner";

export const CouponInput = () => {
  const { discountCode, applyDiscount, removeDiscount } = useCartStore();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

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
      <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-pet-green/50 bg-pet-green/10 p-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-pet-green/15">
            <BadgePercent className="h-[18px] w-[18px] text-pet-green" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-bold uppercase tracking-wide text-pet-green">
              {discountCode}
            </p>
            <p className="text-[11px] leading-tight text-muted-foreground">
              Cupom aplicado — desconto no checkout
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-shrink-0 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          onClick={handleRemove}
          disabled={busy}
          aria-label="Remover cupom"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-primary/35 bg-primary/5 p-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <TicketPercent className="h-4 w-4 text-primary" />
        Tem um cupom?
      </p>
      <div className="flex items-center gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && handleApply()}
          placeholder="Digite o código"
          disabled={busy}
          className="h-9 flex-1 rounded-full bg-background text-sm font-semibold tracking-wide placeholder:font-normal placeholder:tracking-normal"
          aria-label="Cupom de desconto"
        />
        <Button
          onClick={handleApply}
          disabled={busy || !code.trim()}
          className="h-9 flex-shrink-0 rounded-full px-4 font-display text-sm font-bold btn-bounce"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aplicar"}
        </Button>
      </div>
    </div>
  );
};
