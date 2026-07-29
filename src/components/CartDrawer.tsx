import { useState, useEffect, useRef } from "react";
import { gsap } from "gsap";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ShoppingCart, Minus, Plus, Trash2, ExternalLink, Loader2, Crown, ShieldCheck, Truck, ArrowRight, Store } from "lucide-react";
import { useCartStore } from "@/stores/cartStore";
import { CouponInput } from "@/components/CouponInput";
import { getDisplayOptions } from "@/lib/shopify";
import { goToCheckout } from "@/lib/checkout";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useSubscriberPrices } from "@/hooks/useSubscriberPrices";
import { useFranchisePrices } from "@/hooks/useFranchisePrices";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";

export const CartDrawer = () => {
  const [checkingOut, setCheckingOut] = useState(false);
  const { items, isLoading, isSyncing, updateQuantity, removeItem, getCheckoutUrl, syncCart, clearCart, isCartOpen, setCartOpen } = useCartStore();
  const { isSubscribed, loading: subscriptionLoading } = useSubscription();
  const { getSubscriberPrice } = useSubscriberPrices();
  const { isFranchisee, getFranchisePrice, loading: franchiseLoading } = useFranchisePrices();
  const isMobile = useIsMobile();
  const customerIsSubscribed = isSubscribed && !isFranchisee;

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = items.reduce((sum, item) => sum + (parseFloat(item.price.amount) * item.quantity), 0);
  const clubTotalPrice = items.reduce((sum, item) => {
    const regularPrice = parseFloat(item.price.amount);
    const subscriberPrice = getSubscriberPrice(item.variantId);
    const price = customerIsSubscribed && subscriberPrice !== null && subscriberPrice < regularPrice
      ? subscriberPrice
      : regularPrice;

    return sum + price * item.quantity;
  }, 0);
  const franchiseTotalPrice = items.reduce((sum, item) => {
    const regularPrice = parseFloat(item.price.amount);
    const franchisePrice = getFranchisePrice(item.variantId);
    const price = isFranchisee && franchisePrice !== null && franchisePrice < regularPrice
      ? franchisePrice
      : regularPrice;
    return sum + price * item.quantity;
  }, 0);
  const clubDiscount = customerIsSubscribed ? Math.max(0, totalPrice - clubTotalPrice) : 0;
  const franchiseDiscount = isFranchisee ? Math.max(0, totalPrice - franchiseTotalPrice) : 0;
  const displayTotalPrice = isFranchisee
    ? franchiseTotalPrice
    : customerIsSubscribed
    ? clubTotalPrice
    : totalPrice;

  const itemsListRef = useRef<HTMLDivElement>(null);
  const subtotalRef = useRef<HTMLSpanElement>(null);
  const emptyIconRef = useRef<HTMLDivElement>(null);
  const prevTotalRef = useRef(displayTotalPrice);

  const closeCart = () => {
    setCartOpen(false);
    window.setTimeout(() => { document.body.style.pointerEvents = ''; }, 100);
  };

  useEffect(() => { if (isCartOpen) syncCart(); }, [isCartOpen, syncCart]);

  useEffect(() => {
    if (!isCartOpen || !itemsListRef.current) return;
    const rows = itemsListRef.current.querySelectorAll("[data-cart-row]");
    gsap.fromTo(rows, { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.35, stagger: 0.06, ease: "power2.out" });
  }, [isCartOpen]);

  useEffect(() => {
    if (isCartOpen && items.length === 0 && emptyIconRef.current) {
      const tween = gsap.to(emptyIconRef.current, { y: -6, duration: 1.1, ease: "sine.inOut", yoyo: true, repeat: -1 });
      return () => { tween.kill(); };
    }
  }, [isCartOpen, items.length]);

  useEffect(() => {
    if (prevTotalRef.current !== displayTotalPrice && subtotalRef.current) {
      gsap.fromTo(subtotalRef.current, { scale: 1.18 }, { scale: 1, duration: 0.35, ease: "back.out(3)" });
    }
    prevTotalRef.current = displayTotalPrice;
  }, [displayTotalPrice]);

  const handleCheckout = async () => {
    setCheckingOut(true);
    try {
      if (isFranchisee) {
        try {
          const lineItems = items.map((item) => ({ variantId: item.variantId, quantity: item.quantity }));
          const { data, error } = await supabase.functions.invoke("franchise-checkout", { body: { items: lineItems } });
          if (error) throw error;
          if (data?.checkoutUrl) {
            clearCart();
            setCartOpen(false);
            goToCheckout(data.checkoutUrl);
            return;
          }
        } catch (err) {
          console.error("Franchise checkout failed:", err);
          toast.error("Erro ao aplicar preço de franquia. Usando checkout normal.");
        }
      } else if (customerIsSubscribed) {
        try {
          const lineItems = items.map((item) => ({ variantId: item.variantId, quantity: item.quantity }));
          const { data, error } = await supabase.functions.invoke("subscriber-checkout", { body: { items: lineItems } });
          if (error) throw error;
          if (data?.checkoutUrl) {
            clearCart();
            setCartOpen(false);
            goToCheckout(data.checkoutUrl);
            return;
          }
        } catch (err) {
          console.error("Subscriber checkout failed:", err);
          toast.error("Erro ao aplicar desconto do clube. Usando checkout normal.");
        }
      }
      const checkoutUrl = getCheckoutUrl();
      if (checkoutUrl) {
        setCartOpen(false);
        goToCheckout(checkoutUrl);
      }
    } finally {
      setCheckingOut(false);
    }
  };

  if (isMobile) {
    return (
      <Button asChild variant="ghost" size="icon" className="relative translate-y-0.5 bg-transparent text-[#d5aa00] hover:bg-transparent hover:text-[#b89000]">
        <Link to="/carrinho">
          <ShoppingCart className="h-7 w-7" strokeWidth={2.2} />
          {totalItems > 0 && (
            <Badge className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-card bg-primary p-0 px-1 text-[11px] font-bold text-primary-foreground shadow">
              {totalItems}
            </Badge>
          )}
          <span className="sr-only">Abrir carrinho</span>
        </Link>
      </Button>
    );
  }

  return (
    <Sheet open={isCartOpen} onOpenChange={(open) => open ? setCartOpen(true) : closeCart()}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-12 w-12 bg-transparent text-[#d5aa00] shadow-none hover:bg-transparent hover:text-[#b89000]">
          <ShoppingCart className="h-8 w-8" strokeWidth={2.2} />
          {totalItems > 0 && (
            <Badge className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-card bg-primary p-0 px-1 text-[11px] font-bold text-primary-foreground shadow">
              {totalItems}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent
        onClose={closeCart}
        onEscapeKeyDown={closeCart}
        className="w-full max-w-none sm:max-w-lg flex flex-col h-full p-0 gap-0"
      >
        {/* Header */}
        <SheetHeader className="flex-shrink-0 px-4 sm:px-6 pt-5 sm:pt-6 pb-3 sm:pb-4 border-b border-border bg-gradient-to-br from-primary/5 to-transparent text-left">
          <SheetTitle className="font-display text-xl sm:text-2xl flex items-center gap-2 pr-8">
            <ShoppingCart className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
            Meu carrinho
          </SheetTitle>
          <SheetDescription className="text-sm">
            {totalItems === 0 ? "Seu carrinho está vazio" : `${totalItems} ${totalItems === 1 ? "item" : "itens"} • R$ ${displayTotalPrice.toFixed(2).replace('.', ',')}`}
          </SheetDescription>

          {isFranchisee && items.length > 0 ? (
            <div className="mt-3 hidden sm:flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 px-3 py-2 text-xs font-semibold">
              <Store className="h-4 w-4" />
              {franchiseDiscount > 0
                ? `Conta franquia: economia de R$ ${franchiseDiscount.toFixed(2).replace('.', ',')}`
                : "Conta franquia: preços exclusivos aplicados no checkout"}
            </div>
          ) : customerIsSubscribed && items.length > 0 && (
            <div className="mt-3 hidden sm:flex items-center gap-2 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-700 dark:text-sky-300 px-3 py-2 text-xs font-semibold">
              <Crown className="h-4 w-4" />
              {clubDiscount > 0
                ? `Plano ativo: voce economiza R$ ${clubDiscount.toFixed(2).replace('.', ',')}`
                : "Plano ativo: beneficios aplicados no checkout"}
            </div>
          )}
        </SheetHeader>

        {/* Content */}
        <div className="flex flex-col flex-1 min-h-0 bg-muted/25 sm:bg-background">
          {items.length === 0 ? (
            <div className="flex-1 flex items-center justify-center px-6 py-10">
              <div className="text-center max-w-xs">
                <div ref={emptyIconRef} className="mx-auto w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <ShoppingCart className="h-10 w-10 text-primary" />
                </div>
                <h3 className="font-display font-bold text-lg text-foreground">Seu carrinho está vazio</h3>
                <p className="text-sm text-muted-foreground mt-1 mb-5">Que tal mimar seu pet com algo especial hoje?</p>
                <Button asChild className="rounded-full font-display font-bold btn-bounce" onClick={() => setCartOpen(false)}>
                  <Link to="/catalogo">
                    Ver catálogo <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <>
              <section className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 sm:py-4 min-h-0" aria-label="Produtos no carrinho">
                <div className="mb-3 flex items-center justify-between sm:hidden">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Produtos
                  </p>
                  <p className="text-xs font-semibold text-primary">
                    {totalItems} {totalItems === 1 ? "item" : "itens"}
                  </p>
                </div>
                <div ref={itemsListRef} className="space-y-2.5 sm:space-y-3">
                  {items.map((item) => {
                    const regularPrice = parseFloat(item.price.amount);
                    const subscriberPrice = getSubscriberPrice(item.variantId);
                    const franchisePrice = getFranchisePrice(item.variantId);
                    const hasFranchisePrice = isFranchisee && franchisePrice !== null && franchisePrice < regularPrice;
                    const hasSubscriberPrice = customerIsSubscribed && subscriberPrice !== null && subscriberPrice < regularPrice;
                    const itemPrice = hasFranchisePrice
                      ? franchisePrice
                      : hasSubscriberPrice
                      ? subscriberPrice
                      : regularPrice;
                    const regularLineTotal = regularPrice * item.quantity;
                    const lineTotal = itemPrice * item.quantity;
                    return (
                      <div
                        key={item.variantId}
                        data-cart-row
                        className="grid grid-cols-[72px_minmax(0,1fr)_32px] gap-2.5 sm:flex sm:gap-3 p-2.5 sm:p-3 rounded-xl sm:rounded-2xl border border-border bg-background sm:bg-card hover:border-primary/30 hover:shadow-sm transition"
                      >
                        <div className="w-[72px] h-[72px] sm:w-20 sm:h-20 bg-muted rounded-lg sm:rounded-xl overflow-hidden flex-shrink-0">
                          {item.product.node.images?.edges?.[0]?.node && (
                            <img
                              src={item.product.node.images.edges[0].node.url}
                              alt={item.product.node.title}
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col">
                          <h4 className="font-bold text-[13px] sm:text-sm leading-tight line-clamp-2 text-foreground">
                            {item.product.node.title}
                          </h4>
                          {getDisplayOptions(item.selectedOptions).length > 0 && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                              {getDisplayOptions(item.selectedOptions).map(o => o.value).join(' • ')}
                            </p>
                          )}
                          <div className="flex items-end justify-between gap-2 mt-auto pt-2">
                            <div className="flex items-center gap-1 rounded-full border border-border bg-background p-0.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-full btn-bounce hover:bg-primary hover:text-primary-foreground"
                                onClick={() => updateQuantity(item.variantId, item.quantity - 1)}
                                disabled={isLoading}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                key={`qty-${item.variantId}-${item.quantity}`}
                                defaultValue={item.quantity}
                                disabled={isLoading}
                                aria-label={`Quantidade de ${item.product.node.title}`}
                                onBlur={(e) => {
                                  const next = parseInt(e.target.value, 10);
                                  if (!Number.isNaN(next) && next > 0 && next !== item.quantity) {
                                    updateQuantity(item.variantId, next);
                                  }
                                }}
                                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                                className="w-9 text-center text-sm font-bold bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-md [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-full btn-bounce hover:bg-primary hover:text-primary-foreground"
                                onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                                disabled={isLoading}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                            <div className="text-right whitespace-nowrap">
                              {(hasFranchisePrice || hasSubscriberPrice) && (
                                <p className="text-[11px] leading-none text-muted-foreground line-through">
                                  R$ {regularLineTotal.toFixed(2).replace('.', ',')}
                                </p>
                              )}
                              <p className="font-display font-bold text-primary text-sm sm:text-base">
                                R$ {lineTotal.toFixed(2).replace('.', ',')}
                              </p>
                              {hasSubscriberPrice && (
                                <p className="text-[10px] font-semibold leading-none text-primary">
                                  assinatura
                                </p>
                              )}
                              {hasFranchisePrice && (
                                <p className="text-[10px] font-semibold leading-none text-emerald-600">
                                  franquia
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full btn-bounce flex-shrink-0"
                          onClick={() => removeItem(item.variantId)}
                          aria-label="Remover"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Footer / checkout */}
              <div className="flex-shrink-0 border-t border-border bg-card px-6 py-4 space-y-3 shadow-[0_-4px_20px_-8px_rgba(0,0,0,0.08)]">
                <CouponInput />

                <div className="flex justify-between items-baseline gap-3">
                  <span className="text-sm font-medium text-muted-foreground">Subtotal</span>
                  <div className="text-right">
                    <span ref={subtotalRef} className="inline-block font-display font-900 text-2xl text-primary">
                      R$ {displayTotalPrice.toFixed(2).replace('.', ',')}
                    </span>
                    {franchiseDiscount > 0 ? (
                      <span className="block text-[11px] font-semibold text-emerald-600">
                        valor de franquia
                      </span>
                    ) : clubDiscount > 0 ? (
                      <span className="block text-[11px] font-semibold text-primary">
                        valor com assinatura
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground -mt-1 flex items-center gap-1.5">
                  {isSyncing ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" /> Atualizando preços…
                    </>
                  ) : (
                    "Frete e descontos calculados no checkout."
                  )}
                </p>

                <Button
                  onClick={handleCheckout}
                  className="w-full btn-bounce rounded-full font-display font-bold text-base py-6 shadow-md"
                  size="lg"
                  disabled={items.length === 0 || isLoading || isSyncing || subscriptionLoading || franchiseLoading || checkingOut}
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
                  onClick={() => setCartOpen(false)}
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
