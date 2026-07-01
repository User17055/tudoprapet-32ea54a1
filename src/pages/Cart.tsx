import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Crown,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useSubscriberPrices } from "@/hooks/useSubscriberPrices";
import { supabase } from "@/integrations/supabase/client";
import { getDisplayOptions } from "@/lib/shopify";
import { goToCheckout } from "@/lib/checkout";
import { useCartStore } from "@/stores/cartStore";
import { toast } from "sonner";

const Cart = () => {
  const [checkingOut, setCheckingOut] = useState(false);
  const {
    items,
    isLoading,
    isSyncing,
    updateQuantity,
    removeItem,
    getCheckoutUrl,
    syncCart,
    clearCart,
    setCartOpen,
  } = useCartStore();
  const { isSubscribed, loading: subscriptionLoading } = useSubscription();
  const { getSubscriberPrice } = useSubscriberPrices();

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = items.reduce(
    (sum, item) => sum + parseFloat(item.price.amount) * item.quantity,
    0,
  );
  const clubTotalPrice = items.reduce((sum, item) => {
    const regularPrice = parseFloat(item.price.amount);
    const subscriberPrice = getSubscriberPrice(item.variantId);
    const price = isSubscribed && subscriberPrice !== null && subscriberPrice < regularPrice
      ? subscriberPrice
      : regularPrice;

    return sum + price * item.quantity;
  }, 0);
  const clubDiscount = isSubscribed ? Math.max(0, totalPrice - clubTotalPrice) : 0;
  const displayTotalPrice = isSubscribed ? clubTotalPrice : totalPrice;

  const itemsListRef = useRef<HTMLElement>(null);
  const subtotalRef = useRef<HTMLSpanElement>(null);
  const emptyIconRef = useRef<HTMLDivElement>(null);
  const hasAnimatedRef = useRef(false);
  const prevTotalRef = useRef(displayTotalPrice);

  useEffect(() => {
    setCartOpen(false);
    syncCart();
  }, [setCartOpen, syncCart]);

  useEffect(() => {
    if (hasAnimatedRef.current || items.length === 0 || !itemsListRef.current) return;
    hasAnimatedRef.current = true;
    const rows = itemsListRef.current.querySelectorAll("[data-cart-row]");
    gsap.fromTo(rows, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.35, stagger: 0.06, ease: "power2.out" });
  }, [items.length]);

  useEffect(() => {
    if (items.length !== 0 || !emptyIconRef.current) return;
    const tween = gsap.to(emptyIconRef.current, { y: -6, duration: 1.1, ease: "sine.inOut", yoyo: true, repeat: -1 });
    return () => { tween.kill(); };
  }, [items.length]);

  useEffect(() => {
    if (prevTotalRef.current !== displayTotalPrice && subtotalRef.current) {
      gsap.fromTo(subtotalRef.current, { scale: 1.18 }, { scale: 1, duration: 0.35, ease: "back.out(3)" });
    }
    prevTotalRef.current = displayTotalPrice;
  }, [displayTotalPrice]);

  const handleCheckout = async () => {
    setCheckingOut(true);
    try {
      if (isSubscribed) {
        try {
          const lineItems = items.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
          }));
          const { data, error } = await supabase.functions.invoke(
            "subscriber-checkout",
            { body: { items: lineItems } },
          );
          if (error) throw error;
          if (data?.checkoutUrl) {
            clearCart();
            goToCheckout(data.checkoutUrl);
            return;
          }
        } catch (err) {
          console.error("Subscriber checkout failed:", err);
          toast.error("Erro ao aplicar desconto do clube. Usando checkout normal.");
        }
      }

      const checkoutUrl = getCheckoutUrl();
      if (checkoutUrl) goToCheckout(checkoutUrl);
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <div className="min-h-dvh bg-muted/30 flex flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-3">
          <Button asChild variant="ghost" size="icon" className="rounded-full">
            <Link to="/">
              <ArrowLeft className="h-5 w-5" />
              <span className="sr-only">Voltar</span>
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-900 leading-tight">
              Carrinho
            </h1>
            <p className="text-xs text-muted-foreground">
              {totalItems === 0
                ? "Nenhum produto adicionado"
                : `${totalItems} ${totalItems === 1 ? "item" : "itens"}`}
            </p>
          </div>
        </div>
      </header>

      {isSubscribed && items.length > 0 && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-700 dark:text-sky-300">
          <Crown className="h-4 w-4" />
          {clubDiscount > 0
            ? `Plano ativo: voce economiza R$ ${clubDiscount.toFixed(2).replace(".", ",")}`
            : "Plano ativo: beneficios aplicados no checkout"}
        </div>
      )}

      {items.length === 0 ? (
        <main className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="max-w-xs text-center">
            <div ref={emptyIconRef} className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
              <ShoppingCart className="h-10 w-10 text-primary" />
            </div>
            <h2 className="font-display text-lg font-bold text-foreground">
              Seu carrinho esta vazio
            </h2>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">
              Adicione produtos para finalizar sua compra.
            </p>
            <Button asChild className="rounded-full font-display font-bold">
              <Link to="/catalogo">
                Ver catalogo <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </main>
      ) : (
        <>
          <main className="flex-1 px-3 py-3 pb-40">
            <section ref={itemsListRef} aria-label="Produtos no carrinho" className="space-y-2.5">
              {items.map((item) => {
                const regularPrice = parseFloat(item.price.amount);
                const subscriberPrice = getSubscriberPrice(item.variantId);
                const hasSubscriberPrice = isSubscribed && subscriberPrice !== null && subscriberPrice < regularPrice;
                const itemPrice = hasSubscriberPrice ? subscriberPrice : regularPrice;
                const regularLineTotal = regularPrice * item.quantity;
                const lineTotal = itemPrice * item.quantity;
                const image = item.product.node.images?.edges?.[0]?.node;

                return (
                  <article
                    key={item.variantId}
                    data-cart-row
                    className="grid grid-cols-[76px_minmax(0,1fr)_32px] gap-3 rounded-xl border border-border bg-background p-2.5 shadow-sm"
                  >
                    <div className="h-[76px] w-[76px] overflow-hidden rounded-lg bg-muted">
                      {image && (
                        <img
                          src={image.url}
                          alt={item.product.node.title}
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>

                    <div className="flex min-w-0 flex-col">
                      <h2 className="line-clamp-2 text-[13px] font-bold leading-tight text-foreground">
                        {item.product.node.title}
                      </h2>
                      {getDisplayOptions(item.selectedOptions).length > 0 && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {getDisplayOptions(item.selectedOptions).map((option) => option.value).join(" / ")}
                        </p>
                      )}

                      <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                        <div className="flex items-center gap-1 rounded-full border border-border bg-background p-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-full btn-bounce"
                            onClick={() =>
                              updateQuantity(item.variantId, item.quantity - 1)
                            }
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
                            className="h-7 w-7 rounded-full btn-bounce"
                            onClick={() =>
                              updateQuantity(item.variantId, item.quantity + 1)
                            }
                            disabled={isLoading}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>

                        <div className="text-right">
                          {hasSubscriberPrice && (
                            <p className="whitespace-nowrap text-[11px] leading-none text-muted-foreground line-through">
                              R$ {regularLineTotal.toFixed(2).replace(".", ",")}
                            </p>
                          )}
                          <p className="whitespace-nowrap font-display text-sm font-bold text-primary">
                            R$ {lineTotal.toFixed(2).replace(".", ",")}
                          </p>
                          {hasSubscriberPrice && (
                            <p className="whitespace-nowrap text-[10px] font-semibold leading-none text-primary">
                              assinatura
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full text-muted-foreground btn-bounce hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => removeItem(item.variantId)}
                      aria-label="Remover"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </article>
                );
              })}
            </section>
          </main>

          <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background px-4 py-3 shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.35)] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-lg space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-muted-foreground">
                  Subtotal
                </span>
                <div className="text-right">
                  {clubDiscount > 0 && (
                    <span className="block text-sm text-muted-foreground line-through">
                      R$ {totalPrice.toFixed(2).replace(".", ",")}
                    </span>
                  )}
                  <span ref={subtotalRef} className="inline-block font-display text-2xl font-900 text-primary">
                    R$ {displayTotalPrice.toFixed(2).replace(".", ",")}
                  </span>
                  {clubDiscount > 0 && (
                    <span className="block text-[11px] font-semibold text-primary">
                      valor com assinatura
                    </span>
                  )}
                </div>
              </div>

              {isSyncing && (
                <p className="-mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Atualizando preços…
                </p>
              )}

              <Button
                onClick={handleCheckout}
                className="w-full rounded-full py-6 font-display text-base font-bold shadow-md"
                size="lg"
                disabled={
                  items.length === 0 ||
                  isLoading ||
                  isSyncing ||
                  subscriptionLoading ||
                  checkingOut
                }
              >
                {checkingOut || isLoading || isSyncing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    Finalizar compra
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>

              <Button asChild variant="ghost" className="w-full rounded-full">
                <Link to="/catalogo">Continuar comprando</Link>
              </Button>

              <div className="flex items-center justify-center gap-4 pt-0.5 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-pet-green" /> Compra segura
                </span>
                <span className="flex items-center gap-1">
                  <Truck className="h-3.5 w-3.5 text-primary" /> Entrega rápida
                </span>
              </div>
            </div>
          </footer>
        </>
      )}
    </div>
  );
};

export default Cart;
