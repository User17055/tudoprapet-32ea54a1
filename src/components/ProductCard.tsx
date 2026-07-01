import { ShopifyProduct } from "@/lib/shopify";
import { useCartStore } from "@/stores/cartStore";
import { useSubscriberPrices } from "@/hooks/useSubscriberPrices";
import { Loader2, Plus, ShoppingCart } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

interface Props {
  product: ShopifyProduct;
}

const formatPrice = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

export const ProductCard = ({ product }: Props) => {
  const addItem = useCartStore((s) => s.addItem);
  const isLoading = useCartStore((s) => s.isLoading);
  const { getSubscriberPrice } = useSubscriberPrices();
  const { node } = product;
  const variant = node.variants.edges[0]?.node;
  const image = node.images.edges[0]?.node;
  const price = parseFloat(variant?.price?.amount || "0");
  const compareAtPrice = variant?.compareAtPrice
    ? parseFloat(variant.compareAtPrice.amount)
    : null;
  const hasDiscount = Boolean(compareAtPrice && compareAtPrice > price);
  const discountPercent =
    hasDiscount && compareAtPrice
      ? Math.round(((compareAtPrice - price) / compareAtPrice) * 100)
      : 0;
  const isOutOfStock = !variant?.availableForSale;

  const subscriberPrice = variant ? getSubscriberPrice(variant.id) : null;
  const hasSubscriberDiscount =
    subscriberPrice !== null && subscriberPrice < price;
  const subscriberDiscountPercent = hasSubscriberDiscount
    ? Math.round(((price - subscriberPrice) / price) * 100)
    : 0;
  const badgePercent = hasDiscount
    ? discountPercent
    : hasSubscriberDiscount
    ? subscriberDiscountPercent
    : 0;
  const showOriginalPrice = hasDiscount;
  const originalPrice = compareAtPrice;

  const openCartOnFirstAdd = useCartStore((s) => s.openCartOnFirstAdd);

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

    openCartOnFirstAdd();

    toast.success("Adicionado ao carrinho!", {
      description: node.title,
      position: "top-center",
    });
  };

  return (
    <Link
      to={`/product/${node.handle}`}
      className="group relative z-[3] flex w-full flex-col overflow-visible rounded-xl bg-white p-1.5"
    >
      <div className="relative aspect-square overflow-hidden rounded-[10px] border border-[#e9edf3] bg-white">
        {badgePercent > 0 && (
          <span className="absolute right-2.5 top-2.5 z-[2] inline-flex h-[30px] min-w-[72px] items-center justify-center rounded-full bg-[#0054a6] px-2.5 text-[12px] font-semibold leading-none text-white shadow-[0_6px_16px_rgba(0,84,166,0.2)]">
            {badgePercent}% OFF
          </span>
        )}

        {isOutOfStock && (
          <span className="absolute left-2.5 top-2.5 z-[2] inline-flex h-[26px] items-center justify-center rounded-full bg-[#1d1d1f]/85 px-2.5 text-[11px] font-semibold leading-none text-white">
            Esgotado
          </span>
        )}

        {image ? (
          <img
            src={image.url}
            alt={image.altText || node.title}
            loading="lazy"
            className={`absolute inset-0 z-[1] h-full w-full object-contain p-2 transition-transform duration-500 group-hover:scale-105 ${
              isOutOfStock ? "opacity-40 grayscale" : "opacity-100"
            }`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ShoppingCart className="h-10 w-10" />
          </div>
        )}

        <button
          onClick={handleAddToCart}
          disabled={isLoading || !variant?.availableForSale}
          aria-label="Adicionar ao carrinho"
          className="absolute bottom-3 right-3 z-[2] flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-[#1d1d1f] text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-[#0054a6] active:scale-95 disabled:opacity-50"
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Plus className="h-7 w-7" strokeWidth={2.25} />
          )}
        </button>
      </div>

      <h3 className="mt-3.5 line-clamp-2 min-h-[2.9em] text-sm font-normal leading-[1.45] text-[#111827]">
        {node.title}
      </h3>

      <div className="mt-[18px] flex flex-col items-start gap-[3px]">
        {showOriginalPrice && originalPrice && (
          <span className="text-[12px] font-normal leading-none text-[#6b7280] line-through tabular-nums">
            {formatPrice(originalPrice)}
          </span>
        )}

        <span className="text-[16px] font-bold leading-none text-[#111827] tabular-nums">
          {formatPrice(price)}
        </span>

        {subscriberPrice !== null && (
          <div className="mt-[3px] flex flex-col items-start gap-[2px]">
            <span className="text-[16px] font-bold leading-none text-[#0054a6] tabular-nums">
              {formatPrice(subscriberPrice)}
            </span>
            <span className="text-[12px] font-normal leading-none text-[#0054a6]">
              para assinantes
            </span>
          </div>
        )}
      </div>
    </Link>
  );
};
