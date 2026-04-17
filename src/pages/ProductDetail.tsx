import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { storefrontApiRequest, PRODUCT_BY_HANDLE_QUERY, PRODUCT_RECOMMENDATIONS_QUERY, PRODUCTS_QUERY, ShopifyProduct } from "@/lib/shopify";
import { ProductCard } from "@/components/ProductCard";
import { useCartStore } from "@/stores/cartStore";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useSubscriberPrices } from "@/hooks/useSubscriberPrices";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import {
  ShoppingBag,
  Loader2,
  ArrowLeft,
  Crown,
  Minus,
  Plus,
  Truck,
  ShieldCheck,
  RotateCcw,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const ProductDetail = () => {
  const { handle } = useParams<{ handle: string }>();
  const [product, setProduct] = useState<ShopifyProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(0);
  const [selectedImageIdx, setSelectedImageIdx] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [recommended, setRecommended] = useState<ShopifyProduct[]>([]);
  const addItem = useCartStore((s) => s.addItem);
  const getCheckoutUrl = useCartStore((s) => s.getCheckoutUrl);
  const isLoading = useCartStore((s) => s.isLoading);
  const { isSubscribed, loading: subscriptionLoading } = useSubscription();
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
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [handle]);

  useEffect(() => {
    const fetchRecommended = async () => {
      try {
        const data = await storefrontApiRequest(PRODUCTS_QUERY, { first: 12, query: null });
        const edges: ShopifyProduct[] = data?.data?.products?.edges || [];
        const filtered = edges.filter((p) => p.node.handle !== handle).slice(0, 8);
        setRecommended(filtered);
      } catch (err) {
        console.error(err);
      }
    };
    fetchRecommended();
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
            <Link to="/">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Voltar
              </Button>
            </Link>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const { node } = product;
  const variant = node.variants.edges[selectedVariantIdx]?.node;
  const images = node.images.edges;
  const mainImage = images[selectedImageIdx]?.node || images[0]?.node;
  const price = parseFloat(variant?.price?.amount || "0");
  const compareAtPrice = variant?.compareAtPrice ? parseFloat(variant.compareAtPrice.amount) : null;
  const hasDiscount = compareAtPrice && compareAtPrice > price;
  const discountPercent = hasDiscount
    ? Math.round(((compareAtPrice - price) / compareAtPrice) * 100)
    : 0;
  const subscriberPrice = variant ? getSubscriberPrice(variant.id) : null;
  const installment = (price / 2).toFixed(2).replace(".", ",");

  const handleAdd = async () => {
    if (!variant) return;
    await addItem({
      product,
      variantId: variant.id,
      variantTitle: variant.title,
      price: variant.price,
      quantity,
      selectedOptions: variant.selectedOptions || [],
    });
    toast.success("Adicionado à sacola!", { description: node.title, position: "top-center" });
  };

  const handleBuyNow = async () => {
    if (!variant) return;
    setBuyingNow(true);

    if (isSubscribed) {
      try {
        const { data, error } = await supabase.functions.invoke("subscriber-checkout", {
          body: { items: [{ variantId: variant.id, quantity }] },
        });
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
      quantity,
      selectedOptions: variant.selectedOptions || [],
    });
    const checkoutUrl = getCheckoutUrl();
    if (checkoutUrl) {
      window.open(checkoutUrl, "_blank");
    }
    setBuyingNow(false);
  };

  // Parse description into structured blocks (headings, bullet lists, paragraphs)
  type Block =
    | { type: "heading"; text: string }
    | { type: "list"; items: string[] }
    | { type: "paragraph"; text: string };

  const parseDescription = (raw: string): Block[] => {
    if (!raw) return [];
    // Normalize: convert block-level tags into newlines, strip remaining HTML
    let text = raw
      .replace(/\r/g, "")
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<\s*\/\s*(p|div|li|h[1-6]|ul|ol)\s*>/gi, "\n")
      .replace(/<\s*li[^>]*>/gi, "\n- ")
      .replace(/<\s*p[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#39;/gi, "'")
      .replace(/&quot;/gi, '"');

    // Split on inline bullet separators like ";-" used by some Shopify imports
    text = text.replace(/\s*;\s*(?=[-–—*•]\s)/g, "\n");
    // Also split when a new bullet starts mid-line
    text = text.replace(/\s+(?=[-–—*•]\s)/g, "\n");

    const lines = text
      .split(/\n+/)
      .map((l) => l.replace(/\s+/g, " ").trim())
      .map((l) => l.replace(/[;\s]+$/, "")) // remove trailing ; and spaces
      .filter(Boolean);

    const blocks: Block[] = [];
    let currentList: string[] | null = null;

    const flushList = () => {
      if (currentList && currentList.length) {
        blocks.push({ type: "list", items: currentList });
      }
      currentList = null;
    };

    for (const line of lines) {
      const bulletMatch = /^[-–—*•]\s*(.+)/.exec(line) || /^\d+[.)]\s+(.+)/.exec(line);
      if (bulletMatch) {
        const item = bulletMatch[1].trim();
        if (item) {
          if (!currentList) currentList = [];
          currentList.push(item);
        }
        continue;
      }
      flushList();
      // Heading: ends with ":" and is short
      if (/[:：]$/.test(line) && line.length <= 80) {
        blocks.push({ type: "heading", text: line.replace(/[:：]$/, "").trim() });
        continue;
      }
      blocks.push({ type: "paragraph", text: line });
    }
    flushList();
    return blocks;
  };

  const descriptionBlocks = parseDescription(node.description || "");

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-6 lg:py-10">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar para a loja
        </Link>

        <div className="grid lg:grid-cols-[1fr_420px] gap-8 lg:gap-12">
          {/* Gallery */}
          <div className="grid grid-cols-[80px_1fr] gap-3 lg:gap-4">
            {/* Thumbnails */}
            <div className="flex flex-col gap-2 max-h-[500px] overflow-y-auto">
              {images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedImageIdx(i)}
                  className={`aspect-square w-20 rounded-xl overflow-hidden border-2 transition-all flex-shrink-0 ${
                    i === selectedImageIdx
                      ? "border-primary shadow-md"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <img
                    src={img.node.url}
                    alt={img.node.altText || `${node.title} ${i + 1}`}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>

            {/* Main image */}
            <div className="relative aspect-square bg-muted/40 rounded-2xl overflow-hidden border border-border">
              {hasDiscount && (
                <span className="absolute top-4 left-4 z-10 bg-accent text-accent-foreground text-sm font-bold px-3 py-1.5 rounded-lg shadow-sm">
                  {discountPercent}% OFF
                </span>
              )}
              <span className="absolute top-4 right-4 z-10 bg-background/90 backdrop-blur text-xs font-medium px-3 py-1.5 rounded-lg border border-border">
                Imagens ilustrativas
              </span>
              {mainImage && (
                <img
                  src={mainImage.url}
                  alt={mainImage.altText || node.title}
                  className="w-full h-full object-contain p-6"
                />
              )}
            </div>
          </div>

          {/* Buy Box */}
          <div className="space-y-5">
            <div>
              <h1 className="font-display font-900 text-2xl lg:text-3xl leading-tight">
                {node.title}
              </h1>
            </div>

            {/* Price block */}
            <div className="space-y-2 pb-5 border-b border-border">
              {hasDiscount && (
                <p className="text-sm text-muted-foreground line-through">
                  R$ {compareAtPrice.toFixed(2).replace(".", ",")}
                </p>
              )}
              <div className="flex items-baseline gap-3 flex-wrap">
                <p className="font-display font-900 text-4xl text-foreground">
                  R$ {price.toFixed(2).replace(".", ",")}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                ou 2x de <span className="font-semibold text-foreground">R$ {installment}</span> sem juros
              </p>
            </div>

            {/* Variant selector */}
            {node.variants.edges.length > 1 && (
              <div className="space-y-2">
                <p className="font-medium text-sm text-foreground">Opção:</p>
                <div className="flex flex-wrap gap-2">
                  {node.variants.edges.map((v, i) => (
                    <button
                      key={v.node.id}
                      onClick={() => setSelectedVariantIdx(i)}
                      className={`px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                        i === selectedVariantIdx
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      {v.node.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quantity */}
            <div className="space-y-2">
              <p className="font-medium text-sm text-foreground">Quantidade:</p>
              <div className="inline-flex items-center border-2 border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  className="px-4 py-3 hover:bg-muted transition-colors"
                  aria-label="Diminuir"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-12 text-center font-display font-bold text-lg">{quantity}</span>
                <button
                  onClick={() => setQuantity((q) => q + 1)}
                  className="px-4 py-3 hover:bg-muted transition-colors"
                  aria-label="Aumentar"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* CTAs */}
            <div className="flex flex-col gap-3 pt-2">
              <Button
                size="lg"
                className="w-full h-14 text-base font-display font-bold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 shadow-md"
                onClick={handleAdd}
                disabled={isLoading || !variant?.availableForSale}
              >
                {isLoading && !buyingNow ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <ShoppingBag className="h-5 w-5 mr-2" /> Adicionar à sacola
                  </>
                )}
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="w-full h-12 text-sm font-display font-bold rounded-xl border-2"
                onClick={handleBuyNow}
                disabled={isLoading || buyingNow || subscriptionLoading || !variant?.availableForSale}
              >
                {buyingNow ? <Loader2 className="h-5 w-5 animate-spin" /> : "Comprar agora"}
              </Button>
            </div>

            {/* Subscriber Club Card */}
            <div className="rounded-2xl border-2 border-sky-400/40 bg-sky-50/50 dark:bg-sky-950/20 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-sky-500" />
                <h3 className="font-display font-900 text-base text-sky-600 dark:text-sky-400">
                  Assine pra não faltar
                </h3>
              </div>
              {subscriberPrice !== null ? (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs text-muted-foreground">Preço do clube:</span>
                    <span className="font-display font-900 text-2xl text-sky-500">
                      R$ {subscriberPrice.toFixed(2).replace(".", ",")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Receba na frequência que seu pet precisa, sem custo de envio. Cancele quando quiser.
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Receba os produtos na frequência que seu pet precisa e sem custos. Cancele quando quiser.
                </p>
              )}
              <Link
                to="/clube"
                className="inline-flex items-center gap-1 text-sm font-bold text-sky-600 hover:text-sky-700 dark:text-sky-400"
              >
                Assinar agora →
              </Link>
            </div>

            {/* Trust badges */}
            <div className="grid grid-cols-3 gap-2 pt-3">
              <div className="flex flex-col items-center text-center gap-1 p-2">
                <Truck className="h-5 w-5 text-primary" />
                <span className="text-[11px] text-muted-foreground leading-tight">Entrega rápida</span>
              </div>
              <div className="flex flex-col items-center text-center gap-1 p-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <span className="text-[11px] text-muted-foreground leading-tight">Compra segura</span>
              </div>
              <div className="flex flex-col items-center text-center gap-1 p-2">
                <RotateCcw className="h-5 w-5 text-primary" />
                <span className="text-[11px] text-muted-foreground leading-tight">Troca fácil</span>
              </div>
            </div>
          </div>
        </div>

        {/* Description section */}
        <section className="mt-12 lg:mt-16 max-w-4xl">
          <div className="border-t border-border pt-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-10 w-1.5 bg-primary rounded-full" />
              <h2 className="font-display font-900 text-2xl lg:text-3xl">
                Sobre o produto
              </h2>
            </div>

            {descriptionBlocks.length > 0 ? (
              <div className="space-y-5">
                {descriptionBlocks.map((block, idx) => {
                  if (block.type === "heading") {
                    return (
                      <h3
                        key={idx}
                        className="font-display font-900 text-lg lg:text-xl text-foreground mt-6 first:mt-0"
                      >
                        {block.text}
                      </h3>
                    );
                  }
                  if (block.type === "list") {
                    return (
                      <ul key={idx} className="space-y-2.5">
                        {block.items.map((item, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-3 text-base text-foreground/80 leading-relaxed"
                          >
                            <Check className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    );
                  }
                  return (
                    <p
                      key={idx}
                      className="text-base leading-relaxed text-foreground/80"
                    >
                      {block.text}
                    </p>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground italic">
                Em breve mais informações sobre este produto.
              </p>
            )}
          </div>
        </section>

        {/* Recommended products */}
        {recommended.length > 0 && (
          <section className="mt-12 lg:mt-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-10 w-1.5 bg-accent rounded-full" />
              <h2 className="font-display font-900 text-2xl lg:text-3xl">
                Você também pode gostar
              </h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {recommended.map((p) => (
                <ProductCard key={p.node.id} product={p} />
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default ProductDetail;
