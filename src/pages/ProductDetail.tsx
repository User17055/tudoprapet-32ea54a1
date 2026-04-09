import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { storefrontApiRequest, PRODUCT_BY_HANDLE_QUERY, ShopifyProduct } from "@/lib/shopify";
import { useCartStore } from "@/stores/cartStore";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useSubscriberPrices } from "@/hooks/useSubscriberPrices";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Loader2, ArrowLeft, Zap, Crown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const ProductDetail = () => {
  const { handle } = useParams<{ handle: string }>();
  const [product, setProduct] = useState<ShopifyProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(0);
  const addItem = useCartStore((s) => s.addItem);
  const getCheckoutUrl = useCartStore((s) => s.getCheckoutUrl);
  const isLoading = useCartStore((s) => s.isLoading);
  const applyDiscount = useCartStore((s) => s.applyDiscount);
  const { isSubscribed } = useSubscription();
  const { getSubscriberPrice } = useSubscriberPrices();
  const [buyingNow, setBuyingNow] = useState(false);

  useEffect(() => {
    const fetchProduct = async () => {
      try {
        const data = await storefrontApiRequest(PRODUCT_BY_HANDLE_QUERY, { handle });
        const p = data?.data?.productByHandle;
        if (p) setProduct({ node: p });
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchProduct();
  }, [handle]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <p className="text-xl font-display">Produto não encontrado</p>
            <Link to="/"><Button variant="outline"><ArrowLeft className="h-4 w-4 mr-2" />Voltar</Button></Link>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const { node } = product;
  const variant = node.variants.edges[selectedVariantIdx]?.node;
  const images = node.images.edges;
  const price = parseFloat(variant?.price?.amount || "0");
  const compareAtPrice = variant?.compareAtPrice ? parseFloat(variant.compareAtPrice.amount) : null;
  const hasDiscount = compareAtPrice && compareAtPrice > price;
  const subscriberPrice = variant ? getSubscriberPrice(variant.id) : null;

  const handleAdd = async () => {
    if (!variant) return;
    await addItem({
      product,
      variantId: variant.id,
      variantTitle: variant.title,
      price: variant.price,
      quantity: 1,
      selectedOptions: variant.selectedOptions || [],
    });
    toast.success("Adicionado ao carrinho!", { description: node.title, position: "top-center" });
  };

  const handleBuyNow = async () => {
    if (!variant) return;
    setBuyingNow(true);

    if (isSubscribed && subscriberPrice !== null) {
      try {
        const { data, error } = await supabase.functions.invoke("subscriber-checkout", {
          body: { items: [{ variantId: variant.id, quantity: 1 }] },
        });
        if (error) throw error;
        if (data?.checkoutUrl) {
          window.open(data.checkoutUrl, '_blank');
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
      window.open(checkoutUrl, '_blank');
    }
    setBuyingNow(false);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto py-8">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-6">
          <ArrowLeft className="h-4 w-4" /> Voltar para a loja
        </Link>
        <div className="grid md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <div className="aspect-square bg-muted rounded-2xl overflow-hidden">
              {images[0] && (
                <img src={images[0].node.url} alt={images[0].node.altText || node.title} className="w-full h-full object-cover" />
              )}
            </div>
            {images.length > 1 && (
              <div className="grid grid-cols-4 gap-2">
                {images.slice(1, 5).map((img, i) => (
                  <div key={i} className="aspect-square bg-muted rounded-lg overflow-hidden">
                    <img src={img.node.url} alt={img.node.altText || ""} loading="lazy" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-6">
            <h1 className="font-display font-900 text-3xl">{node.title}</h1>
            <p className="text-muted-foreground">{node.description}</p>
            
            <div className="space-y-2">
              {hasDiscount && (
                <p className="text-lg text-muted-foreground line-through">
                  R$ {compareAtPrice.toFixed(2)}
                </p>
              )}
              <p className="font-display font-900 text-3xl text-primary">
                R$ {price.toFixed(2)}
              </p>
              {subscriberPrice !== null && (
                <div className="flex items-center gap-3 bg-blue-50 dark:bg-blue-950/30 rounded-xl px-5 py-3 border border-blue-200 dark:border-blue-800">
                  <Crown className="h-6 w-6 text-blue-600 flex-shrink-0" />
                  <div>
                    <span className="font-display font-900 text-2xl text-blue-600">
                      R$ {subscriberPrice.toFixed(2)}
                    </span>
                    <p className="text-sm text-blue-600/70 font-medium">Preço exclusivo do clube</p>
                  </div>
                </div>
              )}
            </div>

            {node.variants.edges.length > 1 && (
              <div className="space-y-2">
                <p className="font-medium text-sm">Variantes:</p>
                <div className="flex flex-wrap gap-2">
                  {node.variants.edges.map((v, i) => (
                    <button
                      key={v.node.id}
                      onClick={() => setSelectedVariantIdx(i)}
                      className={`px-4 py-2 rounded-full border text-sm font-medium transition-colors ${
                        i === selectedVariantIdx
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      {v.node.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <Button size="lg" className="w-full btn-bounce text-lg py-6 rounded-full bg-secondary text-secondary-foreground hover:bg-secondary/90" onClick={handleBuyNow} disabled={isLoading || !variant?.availableForSale}>
                {buyingNow ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Zap className="h-5 w-5 mr-2" /> Comprar Agora
                  </>
                )}
              </Button>
              <Button size="lg" variant="outline" className="w-full text-lg py-6 rounded-full" onClick={handleAdd} disabled={isLoading || !variant?.availableForSale}>
                {isLoading && !buyingNow ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <ShoppingCart className="h-5 w-5 mr-2" /> Adicionar ao Carrinho
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default ProductDetail;
