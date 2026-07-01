import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Loader2,
  Minus,
  Plus,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { supabase } from "@/integrations/supabase/client";
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

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = items.reduce(
    (sum, item) => sum + parseFloat(item.price.amount) * item.quantity,
    0,
  );

  useEffect(() => {
    setCartOpen(false);
    syncCart();
  }, [setCartOpen, syncCart]);

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
            window.open(data.checkoutUrl, "_blank");
            clearCart();
            return;
          }
        } catch (err) {
          console.error("Subscriber checkout failed:", err);
          toast.error("Erro ao aplicar desconto do clube. Usando checkout normal.");
        }
      }

      const checkoutUrl = getCheckoutUrl();
      if (checkoutUrl) window.open(checkoutUrl, "_blank");
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col">
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

      {items.length === 0 ? (
        <main className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="max-w-xs text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
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
            <section aria-label="Produtos no carrinho" className="space-y-2.5">
              {items.map((item) => {
                const lineTotal = parseFloat(item.price.amount) * item.quantity;
                const image = item.product.node.images?.edges?.[0]?.node;

                return (
                  <article
                    key={item.variantId}
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
                      {item.selectedOptions.length > 0 && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {item.selectedOptions.map((option) => option.value).join(" / ")}
                        </p>
                      )}

                      <div className="mt-auto flex items-end justify-between gap-2 pt-2">
                        <div className="flex items-center gap-1 rounded-full border border-border bg-background p-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-full"
                            onClick={() =>
                              updateQuantity(item.variantId, item.quantity - 1)
                            }
                            disabled={isLoading}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-7 text-center text-sm font-bold">
                            {item.quantity}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 rounded-full"
                            onClick={() =>
                              updateQuantity(item.variantId, item.quantity + 1)
                            }
                            disabled={isLoading}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>

                        <p className="whitespace-nowrap font-display text-sm font-bold text-primary">
                          R$ {lineTotal.toFixed(2).replace(".", ",")}
                        </p>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
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
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Subtotal
                </span>
                <span className="font-display text-2xl font-900 text-primary">
                  R$ {totalPrice.toFixed(2).replace(".", ",")}
                </span>
              </div>

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
            </div>
          </footer>
        </>
      )}
    </div>
  );
};

export default Cart;
