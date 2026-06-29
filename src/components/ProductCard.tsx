import { ShopifyProduct, createInstantCheckoutUrl } from "@/lib/shopify";
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

    // Não-assinante: cria carrinho temporário, sem afetar o carrinho do usuário
    const checkoutUrl = await createInstantCheckoutUrl([
      { variantId: variant.id, quantity: 1 },
    ]);
    if (checkoutUrl) {
      window.open(checkoutUrl, "_blank");
    } else {
      toast.error("Não foi possível iniciar o checkout.");
    }
    setBuyingNow(false);
  };

  const vendor = (node as any).vendor as string | undefined;

  return (
    <Link
      to={`/product/${node.handle}`}
      className="group relative rounded-xl bg-white p-2.5 shadow-[0_10px_28px_rgba(17,24,39,0.08)] hover:shadow-[0_14px_32px_rgba(17,24,39,0.14)] transition-shadow flex flex-col"
    >
      {/* Image area */}
      <div className="relative h-44 sm:h-52 rounded-[10px] border border-[#e9edf3] bg-[#f8fafc] overflow-hidden">
        {hasDiscount && discountPercent > 0 && (
          <span className="absolute top-2.5 right-2.5 z-[2] inline-flex items-center justify-center min-w-[72px] h-[30px] px-2.5 rounded-full bg-[#0054a6] text-white text-[12px] font-semibold leading-none shadow-[0_6px_16px_rgba(0,84,166,0.2)]">
            {discountPercent}% OFF
          </span>
        )}

        {vendor && (
          <span className="absolute left-3 bottom-3 z-[2] text-[11px] font-semibold uppercase tracking-wider text-[#374151]">
            {vendor}
          </span>
        )}

        {image ? (
          <img
            src={image.url}
            alt={image.altText || node.title}
            loading="lazy"
            className="absolute left-1/2 top-2 -translate-x-1/2 h-[90%] w-[90%] object-contain transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ShoppingCart className="h-10 w-10" />
          </div>
        )}

        <button
          onClick={handleAddToCart}
          disabled={isLoading || !variant?.availableForSale}
          aria-label="Adicionar ao carrinho"
          className="absolute bottom-3 right-3 z-[2] h-[42px] w-[42px] rounded-xl bg-[#1d1d1f] text-white flex items-center justify-center shadow-lg hover:bg-[#0054a6] hover:-translate-y-0.5 active:scale-95 transition-all disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-7 w-7" strokeWidth={2.25} />}
        </button>
      </div>

      {/* Title */}
      <h3 className="mt-3.5 text-[13px] sm:text-sm font-normal leading-[1.45] text-[#111827] line-clamp-2 min-h-[2.9em]">
        {node.title}
      </h3>

      {/* Prices */}
      <div className="mt-4 flex flex-col items-start gap-[3px]">
        {hasDiscount && (
          <span className="text-[12px] font-normal text-[#6b7280] line-through tabular-nums leading-none">
            R$ {compareAtPrice.toFixed(2)}
          </span>
        )}
        <span className="text-[16px] font-bold text-[#111827] tabular-nums leading-none">
          R$ {price.toFixed(2)}
        </span>

        {subscriberPrice !== null && (
          <div className="flex flex-col items-start gap-[2px] mt-[3px]">
            <span className="text-[16px] font-bold text-[#0054a6] tabular-nums leading-none">
              R$ {subscriberPrice.toFixed(2)}
            </span>
            <span className="text-[12px] font-normal text-[#0054a6] leading-none">
              para assinantes
            </span>
          </div>
        )}
      </div>

      <button
        onClick={handleBuyNow}
        disabled={isLoading || buyingNow || subscriptionLoading || !variant?.availableForSale}
        className="mt-3 w-full flex items-center justify-center gap-1.5 bg-accent text-accent-foreground font-display font-bold text-xs sm:text-sm py-2 rounded-lg hover:bg-accent/90 active:scale-[0.97] transition-all disabled:opacity-50"
      >
        {buyingNow ? <Loader2 className="h-4 w-4 animate-spin" /> : (<><Zap className="h-3.5 w-3.5" /> Comprar Agora</>)}
      </button>
    </Link>
  );
};
