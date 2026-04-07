import { ShopifyProduct } from "@/lib/shopify";
import { useCartStore } from "@/stores/cartStore";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Loader2, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useState } from "react";

interface Props {
  product: ShopifyProduct;
}

export const ProductCard = ({ product }: Props) => {
  const addItem = useCartStore((s) => s.addItem);
  const getCheckoutUrl = useCartStore((s) => s.getCheckoutUrl);
  const isLoading = useCartStore((s) => s.isLoading);
  const [buyingNow, setBuyingNow] = useState(false);
  const { node } = product;
  const variant = node.variants.edges[0]?.node;
  const image = node.images.edges[0]?.node;
  const price = parseFloat(variant?.price?.amount || "0");

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
      window.open(checkoutUrl, '_blank');
    }
    setBuyingNow(false);
  };

  return (
    <Link
      to={`/product/${node.handle}`}
      className="group hover-lift rounded-2xl bg-card border border-border overflow-hidden flex flex-col"
    >
      <div className="aspect-square bg-muted overflow-hidden relative">
        {image ? (
          <img
            src={image.url}
            alt={image.altText || node.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ShoppingCart className="h-12 w-12" />
          </div>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1 gap-2">
        <h3 className="font-display font-bold text-sm line-clamp-2">{node.title}</h3>
        <div className="mt-auto">
          <p className="font-display font-900 text-lg text-primary">
            R$ {price.toFixed(2)}
          </p>
        </div>
        <div className="flex gap-2 mt-1">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={handleAddToCart}
            disabled={isLoading || !variant?.availableForSale}
          >
            {isLoading && !buyingNow ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ShoppingCart className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="sm"
            className="flex-1 btn-bounce bg-secondary text-secondary-foreground hover:bg-secondary/90"
            onClick={handleBuyNow}
            disabled={isLoading || !variant?.availableForSale}
          >
            {buyingNow ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Zap className="h-4 w-4 mr-1" /> Comprar
              </>
            )}
          </Button>
        </div>
      </div>
    </Link>
  );
};
  const addItem = useCartStore((s) => s.addItem);
  const isLoading = useCartStore((s) => s.isLoading);
  const { node } = product;
  const variant = node.variants.edges[0]?.node;
  const image = node.images.edges[0]?.node;
  const price = parseFloat(variant?.price?.amount || "0");
  const currency = variant?.price?.currencyCode || "BRL";

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

  return (
    <Link
      to={`/product/${node.handle}`}
      className="group hover-lift rounded-2xl bg-card border border-border overflow-hidden flex flex-col"
    >
      <div className="aspect-square bg-muted overflow-hidden relative">
        {image ? (
          <img
            src={image.url}
            alt={image.altText || node.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ShoppingCart className="h-12 w-12" />
          </div>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1 gap-2">
        <h3 className="font-display font-bold text-sm line-clamp-2">{node.title}</h3>
        <div className="mt-auto">
          <p className="font-display font-900 text-lg text-primary">
            R$ {price.toFixed(2)}
          </p>
        </div>
        <Button
          size="sm"
          className="w-full btn-bounce mt-1"
          onClick={handleAddToCart}
          disabled={isLoading || !variant?.availableForSale}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <ShoppingCart className="h-4 w-4 mr-1" /> Adicionar
            </>
          )}
        </Button>
      </div>
    </Link>
  );
};
