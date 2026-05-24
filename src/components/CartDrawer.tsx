import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ShoppingCart, Minus, Plus, Trash2, ExternalLink, Loader2, Crown, ShieldCheck, Truck, ArrowRight } from "lucide-react";
import { useCartStore } from "@/stores/cartStore";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const CartDrawer = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const { items, isLoading, isSyncing, updateQuantity, removeItem, getCheckoutUrl, syncCart, clearCart } = useCartStore();
  const { isSubscribed, loading: subscriptionLoading } = useSubscription();

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = items.reduce((sum, item) => sum + (parseFloat(item.price.amount) * item.quantity), 0);

  useEffect(() => { if (isOpen) syncCart(); }, [isOpen, syncCart]);

  const handleCheckout = async () => {
    setCheckingOut(true);
    try {
      if (isSubscribed) {
        try {
          const lineItems = items.map((item) => ({ variantId: item.variantId, quantity: item.quantity }));
          const { data, error } = await supabase.functions.invoke("subscriber-checkout", { body: { items: lineItems } });
          if (error) throw error;
          if (data?.checkoutUrl) {
            window.open(data.checkoutUrl, '_blank');
            clearCart();
            setIsOpen(false);
            return;
          }
        } catch (err) {
          console.error("Subscriber checkout failed:", err);
          toast.error("Erro ao aplicar desconto do clube. Usando checkout normal.");
        }
      }
      const checkoutUrl = getCheckoutUrl();
      if (checkoutUrl) {
        window.open(checkoutUrl, '_blank');
        setIsOpen(false);
      }
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative rounded-full hover:bg-primary/10">
          <ShoppingCart className="h-5 w-5" />
          {totalItems > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 min-w-[20px] rounded-full p-0 px-1 flex items-center justify-center text-[11px] font-bold bg-secondary text-secondary-foreground border-2 border-card shadow">
              {totalItems}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg flex flex-col h-full p-0 gap-0">
        {/* Header */}
        <SheetHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border bg-gradient-to-br from-primary/5 to-transparent">
          <SheetTitle className="font-display text-2xl flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-primary" />
            Meu carrinho
          </SheetTitle>
          <SheetDescription className="text-sm">
            {totalItems === 0 ? "Seu carrinho está vazio" : `${totalItems} ${totalItems === 1 ? "item" : "itens"} • R$ ${totalPrice.toFixed(2).replace('.', ',')}`}
          </SheetDescription>

          {isSubscribed && items.length > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-700 dark:text-sky-300 px-3 py-2 text-xs font-semibold">
              <Crown className="h-4 w-4" />
              Preço de assinante será aplicado no checkout
            </div>
          )}
        </SheetHeader>

        {/* Content */}
        <div className="flex flex-col flex-1 min-h-0">
          {items.length === 0 ? (
            <div className="flex-1 flex items-center justify-center px-6 py-10">
              <div className="text-center max-w-xs">
                <div className="mx-auto w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <ShoppingCart className="h-10 w-10 text-primary" />
                </div>
                <h3 className="font-display font-bold text-lg text-foreground">Seu carrinho está vazio</h3>
                <p className="text-sm text-muted-foreground mt-1 mb-5">Que tal mimar seu pet com algo especial hoje?</p>
                <Button asChild className="rounded-full font-display font-bold btn-bounce" onClick={() => setIsOpen(false)}>
                  <Link to="/catalogo">
                    Ver catálogo <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
                <div className="space-y-3">
                  {items.map((item) => {
                    const lineTotal = parseFloat(item.price.amount) * item.quantity;
                    return (
                      <div
                        key={item.variantId}
                        className="flex gap-3 p-3 rounded-2xl border border-border bg-card hover:border-primary/30 hover:shadow-sm transition"
                      >
                        <div className="w-20 h-20 bg-muted rounded-xl overflow-hidden flex-shrink-0">
                          {item.product.node.images?.edges?.[0]?.node && (
                            <img
                              src={item.product.node.images.edges[0].node.url}
                              alt={item.product.node.title}
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col">
                          <h4 className="font-bold text-sm leading-tight line-clamp-2 text-foreground">
                            {item.product.node.title}
                          </h4>
                          {item.selectedOptions.length > 0 && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                              {item.selectedOptions.map(o => o.value).join(' • ')}
                            </p>
                          )}
                          <div className="flex items-end justify-between mt-auto pt-2">
                            <div className="flex items-center gap-1 rounded-full border border-border bg-background p-0.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-full hover:bg-primary hover:text-primary-foreground"
                                onClick={() => updateQuantity(item.variantId, item.quantity - 1)}
                                disabled={isLoading}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-7 text-center text-sm font-bold">{item.quantity}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-full hover:bg-primary hover:text-primary-foreground"
                                onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                                disabled={isLoading}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                            <p className="font-display font-bold text-primary text-base">
                              R$ {lineTotal.toFixed(2).replace('.', ',')}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full flex-shrink-0"
                          onClick={() => removeItem(item.variantId)}
                          aria-label="Remover"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Footer / checkout */}
              <div className="flex-shrink-0 border-t border-border bg-card px-6 py-4 space-y-3 shadow-[0_-4px_20px_-8px_rgba(0,0,0,0.08)]">
                <div className="flex justify-between items-baseline">
                  <span className="text-sm font-medium text-muted-foreground">Subtotal</span>
                  <span className="font-display font-900 text-2xl text-primary">
                    R$ {totalPrice.toFixed(2).replace('.', ',')}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground -mt-1">Frete e descontos calculados no checkout.</p>

                <Button
                  onClick={handleCheckout}
                  className="w-full btn-bounce rounded-full font-display font-bold text-base py-6 shadow-md"
                  size="lg"
                  disabled={items.length === 0 || isLoading || isSyncing || subscriptionLoading || checkingOut}
                >
                  {checkingOut || isLoading || isSyncing ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      Finalizar compra
                      <ExternalLink className="w-4 h-4 ml-2" />
                    </>
                  )}
                </Button>

                <button
                  onClick={() => setIsOpen(false)}
                  className="w-full text-xs text-muted-foreground hover:text-primary font-semibold py-1 transition-colors"
                >
                  Continuar comprando
                </button>

                <div className="flex items-center justify-center gap-4 pt-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5 text-pet-green" /> Compra segura</span>
                  <span className="flex items-center gap-1"><Truck className="h-3.5 w-3.5 text-primary" /> Entrega rápida</span>
                </div>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};
