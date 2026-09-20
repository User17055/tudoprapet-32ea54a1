import { ShopifyProduct } from "@/lib/shopify";
import { useCartStore } from "@/stores/cartStore";
import { useSubscriberPrices } from "@/hooks/useSubscriberPrices";
import { useFranchisePrices } from "@/hooks/useFranchisePrices";
import { useCustomerPrices } from "@/hooks/useCustomerPrices";
import { useProductAudience } from "@/hooks/useProductAudience";
import { useProductVariations } from "@/hooks/useProductVariations";
import { Loader2, Plus, ShoppingCart, Store } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { ProductImage } from "@/components/ProductImage";
import { notifyCartItemAdded, notifyCartItemAddFailed } from "@/lib/cartNotifications";
import { isProductAvailable } from "@/lib/productAvailability";

interface Props {
  product: ShopifyProduct;
  products?: ShopifyProduct[];
  searchQuery?: string;
  compact?: boolean;
  hideVariations?: boolean;
}

const formatPrice = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

const TWO_INSTALLMENTS_RATE = 0.0859;

const EMPTY_PRODUCTS: ShopifyProduct[] = [];

const extractMeasurements = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l)\b/g)
    ?.map((term) => term.replace(/\s+/g, "").replace(",", ".")) || [];

export const ProductCard = ({
  product,
  products = EMPTY_PRODUCTS,
  searchQuery = "",
  compact = false,
  hideVariations = false,
}: Props) => {
  const navigate = useNavigate();
  const [selectedProduct, setSelectedProduct] = useState(product);

  const addItem = useCartStore((s) => s.addItem);
  const isLoading = useCartStore((s) => s.isLoading);
  const { getSubscriberPrice } = useSubscriberPrices();
  const { getFranchisePrice, isFranchisee } = useFranchisePrices();
  const { getCustomerPrice } = useCustomerPrices();
  const { isVisibleTo } = useProductAudience();
  const { getVariations, getVariationGroupName } = useProductVariations();
  const variationIsAvailable = (productId: string) => {
    const candidate = products.find((item) => item.node.id === productId);
    if (candidate) return isProductAvailable(candidate);
    if (product.node.id === productId) return isProductAvailable(product);
    // Alguns cards de relacionados não recebem o catálogo completo. Nesse
    // caso, o clique navega para a página e ela confirma o estoque novamente.
    return true;
  };
  const initialVariationItems = getVariations(product.node.id).filter((item) =>
    isVisibleTo(item.shopify_product_id, isFranchisee) &&
    variationIsAvailable(item.shopify_product_id),
  );
  const initialVariationKey = initialVariationItems
    .map((item) => `${item.shopify_product_id}:${item.label}`)
    .join("|");

  useEffect(() => {
    const searchedMeasurements = extractMeasurements(searchQuery);
    const matchedVariation = searchedMeasurements.length
      ? initialVariationItems.find((item) => {
          const itemMeasurements = extractMeasurements(`${item.label} ${item.shopify_product_title}`);
          return searchedMeasurements.some((measurement) => itemMeasurements.includes(measurement));
        })
      : null;
    const matchedProduct = matchedVariation
      ? products.find((candidate) => candidate.node.id === matchedVariation.shopify_product_id)
      : null;
    setSelectedProduct(matchedProduct || product);
    // The serialized key reruns this when asynchronously loaded variations change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, products, searchQuery, initialVariationKey]);

  const { node } = selectedProduct;
  const variationItems = getVariations(node.id).filter((item) =>
    isVisibleTo(item.shopify_product_id, isFranchisee),
  );
  const displayTitle = getVariationGroupName(node.id) || node.title;
  const variant = node.variants.edges[0]?.node;
  const image = node.images.edges[0]?.node;
  const shopifyPrice = parseFloat(variant?.price?.amount || "0");
  const price = variant ? getCustomerPrice(variant.id) ?? shopifyPrice : shopifyPrice;
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
  const franchisePrice = variant ? getFranchisePrice(variant.id) : null;
  const hasSubscriberPrice =
    !isFranchisee &&
    subscriberPrice !== null &&
    Number.isFinite(subscriberPrice) &&
    subscriberPrice > 0;
  const hasFranchiseDiscount =
    isFranchisee && franchisePrice !== null && franchisePrice < price;
  const franchiseDiscountPercent = hasFranchiseDiscount && franchisePrice !== null
    ? Math.round(((price - franchisePrice) / price) * 100)
    : 0;
  const hasSubscriberDiscount =
    hasSubscriberPrice &&
    subscriberPrice < price;
  const subscriberDiscountPercent = hasSubscriberDiscount
    ? Math.round(((price - subscriberPrice) / price) * 100)
    : 0;
  const badgePercent = hasDiscount
    ? discountPercent
    : hasFranchiseDiscount
    ? franchiseDiscountPercent
    : hasSubscriberDiscount
    ? subscriberDiscountPercent
    : 0;
  const showOriginalPrice = hasDiscount;
  const originalPrice = compareAtPrice;
  const twoInstallmentPrice = price > 0 ? (price * (1 + TWO_INSTALLMENTS_RATE)) / 2 : null;

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!variant) return;

    const added = await addItem({
      product: selectedProduct,
      variantId: variant.id,
      variantTitle: variant.title,
      price: variant.price,
      quantity: 1,
      selectedOptions: variant.selectedOptions || [],
    });
    if (added) notifyCartItemAdded();
    else notifyCartItemAddFailed();
  };

  return (
    <Link
      to={`/product/${node.handle}`}
      className="group relative z-[3] flex w-full flex-col overflow-visible bg-white"
    >
      <div className="relative aspect-square overflow-hidden rounded-lg border border-[#e5e7eb] bg-white">
        {badgePercent > 0 && (
          <span className="absolute left-0 top-7 z-[2] inline-flex h-9 min-w-[78px] items-center justify-center rounded-r-sm bg-[#ffe9ad] px-3 text-[14px] font-bold leading-none text-[#111827]">
            {badgePercent}% OFF
          </span>
        )}

        {isOutOfStock && (
          <span className="absolute left-2.5 top-2.5 z-[2] inline-flex h-[26px] items-center justify-center rounded-full bg-slate-200 px-2.5 text-[11px] font-semibold leading-none text-slate-600">
            Indisponível
          </span>
        )}

        {image ? (
          <ProductImage
            src={image.url}
            alt={image.altText || node.title}
            loading="lazy"
            targetFill={0.74}
            className={`absolute inset-0 z-[1] h-full w-full object-contain transition-transform duration-300 ${
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
          className="absolute bottom-4 right-4 z-[2] flex h-12 w-12 items-center justify-center rounded-full bg-[#171717] text-white shadow-lg transition-all hover:-translate-y-0.5 hover:bg-primary active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:opacity-100 disabled:shadow-none"
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Plus className="h-7 w-7" strokeWidth={2.25} />
          )}
        </button>
      </div>

      <div className={`${compact ? "mt-2.5" : "mt-4"} flex min-h-[2.9em] flex-col`}>
        <h3
          className={`line-clamp-2 ${compact ? "text-[13px]" : "text-[15px]"} font-normal leading-[1.35] text-[#202633] ${
            variationItems.length > 1 && !hideVariations
              ? "order-2 hoverable:group-hover:hidden"
              : ""
          }`}
        >
          {displayTitle}
        </h3>

        {/* No toque nao existe hover, entao as variacoes ficam sempre visiveis acima
            do titulo. Onde ha mouse, o comportamento continua sendo o de sempre:
            escondidas ate o hover, quando entao substituem o titulo. */}
        {!hideVariations && variationItems.length > 1 && (
          <div className="order-1 flex h-[2.9em] items-center gap-2 overflow-x-auto pr-1 hoverable:hidden hoverable:group-hover:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {variationItems.map((item) => {
              const active = item.shopify_product_id === node.id;
              const available = variationIsAvailable(item.shopify_product_id);
              return (
                <button
                  key={item.id}
                  type="button"
                  title={`${item.label} — ${item.shopify_product_title}`}
                  aria-label={available ? `Selecionar ${item.label}` : `${item.label} indisponível`}
                  aria-pressed={active}
                  disabled={!available}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (active || !available) return;
                    const nextProduct = products.find(
                      (candidate) => candidate.node.id === item.shopify_product_id,
                    );
                    if (nextProduct) {
                      setSelectedProduct(nextProduct);
                    } else {
                      navigate(`/product/${item.shopify_product_handle}`);
                    }
                  }}
                  className={`h-10 shrink-0 rounded-xl border px-3.5 text-[15px] font-bold uppercase leading-none transition-colors ${
                    !available
                      ? "cursor-not-allowed border-[#d7d9dd] bg-[#f3f4f6] text-[#8b8f97]"
                      : active
                      ? "border-[#171717] bg-[#171717] text-white"
                      : "border-[#d7d9dd] bg-white text-[#51545a] hover:border-primary hover:text-primary"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className={`${compact ? "mt-2.5" : "mt-4"} flex flex-col items-start gap-1`}>
        {showOriginalPrice && originalPrice && (
          <span className="text-[13px] font-normal leading-none text-[#777] tabular-nums">
            A partir de <span className="line-through">{formatPrice(originalPrice)}</span>
          </span>
        )}

        <span className="text-[17px] font-bold leading-none text-[#444] tabular-nums">
          {formatPrice(price)}
        </span>

        {twoInstallmentPrice && (
          <span className="text-[12px] leading-none text-[#7a7f89]">
            ou 2 vezes de {formatPrice(twoInstallmentPrice)}
          </span>
        )}

        {hasFranchiseDiscount && franchisePrice !== null ? (
          <div className="mt-1 flex flex-col items-start gap-[2px]">
            <span className="inline-flex items-center gap-1 text-[17px] font-bold leading-none text-emerald-600 tabular-nums">
              {formatPrice(franchisePrice)}
              <Store className="h-3.5 w-3.5" />
            </span>
            <span className="text-[12px] font-normal leading-none text-emerald-600">
              preço franquia
            </span>
          </div>
        ) : hasSubscriberPrice ? (
          <div className="mt-1.5 flex flex-col items-start gap-1">
            <span className="text-[18px] font-extrabold leading-none text-[#0054a6] tabular-nums">
              {formatPrice(subscriberPrice)}
            </span>
            <span className="text-[12px] font-medium leading-none text-[#0054a6]">
              No <strong className="font-black uppercase text-[#00a896]">Pix</strong> para assinantes
            </span>
          </div>
        ) : null}
      </div>
    </Link>
  );
};
