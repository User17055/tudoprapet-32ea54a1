import { ShopifyProduct } from "@/lib/shopify";
import { useCartStore } from "@/stores/cartStore";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useSubscriberPrices } from "@/hooks/useSubscriberPrices";
import { ShoppingCart, Loader2, Zap, Crown, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  product: ShopifyProduct;
}

export const ProductCard = ({ product }: Props) => {
  const addItem = useCartStore((s) => s.addItem);
  const getCheckoutUrl = useCartStore((s) => s.getCheckoutUrl);
  const isLoading = useCartStore((s) => s.isLoading);
  const { isSubscribed, loading: subscriptionLoading } = useSubscription();
  const { getSubscriberPrice } = useSubscriberPrices();
  const [buyingNow, setBuyingNow] = useState(false);
  const { node } = product;
  const variant = node.variants.edges[0]?.node;
  const image = node.images.edges[0]?.node;
  const price = parseFloat(variant?.price?.amount || "0");
  const compareAtPrice = variant?.compareAtPrice
    ? parseFloat(variant.compareAtPrice.amount)
    : null;
  const hasDiscount = compareAtPrice && compareAtPrice > price;
  const discountPercent = hasDiscount
    ? Math.round(((compareAtPrice - price) / compareAtPrice) * 100)
    : 0;

  const subscriberPrice = variant ? getSubscriberPrice(variant.id) : null;

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!variant) return;
    await addItem({
      product,
      variantId: variant.id,
      variantTitle: variant.title,
      price: variant.price,
      quantity: 1,
      selectedOptions: variant.selectedOptions || [],
    });
    toast.success("Adicionado ao carrinho!", {
      description: node.title,
      position: "top-center",
    });
  };

  const handleBuyNow = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!variant) return;
    setBuyingNow(true);

    if (isSubscribed) {
      try {
        const { data, error } = await supabase.functions.invoke(
          "subscriber-checkout",
          {
            body: { items: [{ variantId: variant.id, quantity: 1 }] },
          }
        );
        if (error) throw error;
        if (data?.checkoutUrl) {
          window.open(data.checkoutUrl, "_blank");
          setBuyingNow(false);
          return;
        }
      } catch (err) {
        console.error("Subscriber checkout failed:", err);
        toast.error("Erro ao aplicar desconto do clube.");
      }
    }

    await addItem({
      product,
      variantId: variant.id,
      variantTitle: variant.title,
      price: variant.price,
      quantity: 1,
      selectedOptions: variant.selectedOptions || [],
    });
    const checkoutUrl = getCheckoutUrl();
    if (checkoutUrl) {
      window.open(checkoutUrl, "_blank");
    }
    setBuyingNow(false);
  };

  return (
    <Link
      to={`/product/${node.handle}`}
      className="group relative rounded-xl bg-card border border-border overflow-hidden flex flex-col transition-shadow hover:shadow-lg"
    >
      {/* Discount badge */}
      {hasDiscount && discountPercent > 0 && (
        <span className="absolute top-2 left-2 z-10 bg-accent text-accent-foreground text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-md shadow-sm">
          {discountPercent}% OFF
        </span>
      )}

      {/* Image + Add to cart button */}
      <div className="relative aspect-[4/5] sm:aspect-square bg-muted overflow-hidden">
        {image ? (
          <img
            src={image.url}
            alt={image.altText || node.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ShoppingCart className="h-10 w-10" />
          </div>
        )}

        {/* Floating add-to-cart button */}
        <button
          onClick={handleAddToCart}
          disabled={isLoading || !variant?.availableForSale}
          className="absolute bottom-2 right-2 z-10 bg-foreground text-background rounded-full w-9 h-9 sm:w-10 sm:h-10 flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 transition-transform disabled:opacity-50"
        >
          {isLoading && !buyingNow ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-5 w-5" />
          )}
        </button>
      </div>

      {/* Info */}
      <div className="p-3 sm:p-4 flex flex-col flex-1 gap-1.5">
        <h3 className="font-display font-bold text-xs sm:text-sm leading-tight line-clamp-2 min-h-[2.5em] tracking-tight">
          {node.title}
        </h3>

        <div className="mt-auto pt-1">
          {hasDiscount && (
            <p className="font-sans text-[11px] sm:text-sm text-muted-foreground line-through leading-tight tabular-nums">
              R$ {compareAtPrice.toFixed(2)}
            </p>
          )}
          <p className="font-sans font-bold text-lg sm:text-xl text-foreground leading-none tabular-nums tracking-tight">
            R$ {price.toFixed(2)}
          </p>

          {subscriberPrice !== null && (
            <div className="mt-1.5">
              <div className="flex items-center gap-1">
                <span className="font-sans font-bold text-base sm:text-lg text-sky-500 leading-none tabular-nums tracking-tight">
                  R$ {subscriberPrice.toFixed(2)}
                </span>
                <Crown className="h-3.5 w-3.5 text-sky-500 flex-shrink-0" />
              </div>
              <span className="font-sans text-[10px] sm:text-xs text-sky-500/80 font-medium leading-tight">
                para assinantes
              </span>
            </div>
          )}

          <button
            onClick={handleBuyNow}
            disabled={isLoading || buyingNow || subscriptionLoading || !variant?.availableForSale}
            className="mt-2 w-full flex items-center justify-center gap-1 bg-accent text-accent-foreground font-display font-bold text-xs sm:text-sm py-1.5 sm:py-2 rounded-lg hover:bg-accent/90 active:scale-[0.97] transition-all disabled:opacity-50"
          >
            {buyingNow ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Zap className="h-3.5 w-3.5" /> Comprar Agora
              </>
            )}
          </button>
        </div>
      </div>
    </Link>
  );
};
