import { useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { cachedStorefrontApiRequest, fetchShopifyProductByHandle, getCachedShopifyProductByHandle, PRODUCT_RECOMMENDATIONS_QUERY, PRODUCTS_QUERY, ShopifyProduct, createInstantCheckoutUrl } from "@/lib/shopify";
import { ProductCard } from "@/components/ProductCard";
import { useCartStore } from "@/stores/cartStore";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useSubscriberPrices } from "@/hooks/useSubscriberPrices";
import { useFranchisePrices } from "@/hooks/useFranchisePrices";
import { useProductAudience } from "@/hooks/useProductAudience";
import { useProductVariations } from "@/hooks/useProductVariations";
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
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { goToCheckout } from "@/lib/checkout";
import { ProductImage } from "@/components/ProductImage";
import { customCheckoutEnabled, startCustomCheckout } from "@/lib/customCheckout";

const ProductDetail = () => {
  const navigate = useNavigate();
  const { handle } = useParams<{ handle: string }>();
  const [product, setProduct] = useState<ShopifyProduct | null>(
    () => getCachedShopifyProductByHandle(handle),
  );
  const [loading, setLoading] = useState(() => !getCachedShopifyProductByHandle(handle));
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(0);
  const [selectedImageIdx, setSelectedImageIdx] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [recommended, setRecommended] = useState<ShopifyProduct[]>([]);
  const [customContent, setCustomContent] = useState<{ description: string | null; specifications: string | null } | null>(null);
  const [productDetails, setProductDetails] = useState<{
    categories: { id: string; name: string; path: string }[];
    brand: { id: string; name: string } | null;
    attributes: { key: string; value: string }[];
  }>({ categories: [], brand: null, attributes: [] });
  const addItem = useCartStore((s) => s.addItem);
  const openCartOnFirstAdd = useCartStore((s) => s.openCartOnFirstAdd);
  // (carrinho NÃO é tocado pelo botão Comprar Agora)
  const isLoading = useCartStore((s) => s.isLoading);
  const { isSubscribed, loading: subscriptionLoading } = useSubscription();
  const { getSubscriberPrice } = useSubscriberPrices();
  const {
    getFranchisePrice,
    isFranchisee,
    loading: franchiseAccessLoading,
  } = useFranchisePrices();
  const { isVisibleTo, loading: audienceLoading } = useProductAudience();
  const { getVariations } = useProductVariations();
  const [buyingNow, setBuyingNow] = useState(false);
  const thumbsRef = useRef<HTMLDivElement>(null);
  const [thumbsOverflow, setThumbsOverflow] = useState(false);

  useEffect(() => {
    const el = thumbsRef.current;
    if (!el) return;
    const check = () => setThumbsOverflow(el.scrollHeight > el.clientHeight + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [product]);

  const scrollThumbs = (dir: 1 | -1) => {
    const el = thumbsRef.current;
    if (!el) return;
    el.scrollBy({ top: dir * 180, behavior: "smooth" });
  };

  useEffect(() => {
    let active = true;
    const fetchProduct = async () => {
      setSelectedVariantIdx(0);
      setSelectedImageIdx(0);
      const cachedProduct = getCachedShopifyProductByHandle(handle);
      if (cachedProduct) {
        if (active) {
          setProduct(cachedProduct);
          setLoading(false);
        }
        if (handle) {
          fetchShopifyProductByHandle(handle, false)
            .then((detailedProduct) => {
              if (active && detailedProduct) setProduct(detailedProduct);
            })
            .catch(console.error);
        }
        return;
      }
      setLoading(true);
      try {
        const nextProduct = handle ? await fetchShopifyProductByHandle(handle) : null;
        if (active) setProduct(nextProduct);
      } catch (err) {
        console.error(err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchProduct();
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    return () => {
      active = false;
    };
  }, [handle]);

  useEffect(() => {
    const fetchRecommended = async () => {
      if (!product?.node?.id) return;
      try {
        const data = await cachedStorefrontApiRequest(PRODUCT_RECOMMENDATIONS_QUERY, {
          productId: product.node.id,
        });
        const recs = data?.data?.productRecommendations || [];
        let mapped: ShopifyProduct[] = recs
          .filter((p: { handle: string }) => p.handle !== handle)
          .map((node: ShopifyProduct["node"]) => ({ node }));

        // Fallback: if Shopify didn't return recommendations, show recent products
        if (mapped.length === 0) {
          const fb = await cachedStorefrontApiRequest(PRODUCTS_QUERY, { first: 12, query: null });
          const edges: ShopifyProduct[] = fb?.data?.products?.edges || [];
          mapped = edges.filter((p) => p.node.handle !== handle);
        }
        setRecommended(mapped.slice(0, 8));
      } catch (err) {
        console.error("Failed to load recommendations:", err);
      }
    };
    fetchRecommended();
  }, [handle, product?.node?.id]);

  useEffect(() => {
    const fetchCustomContent = async () => {
      if (!product?.node?.id) return;
      const pid = product.node.id;
      const { data } = await supabase
        .from("product_content")
        .select("description, specifications")
        .eq("shopify_product_id", pid)
        .maybeSingle();
      setCustomContent(data || null);

      // Fetch categories, brand, attributes
      const [pcRes, contentRes, attrsRes, catsAllRes, brandsAllRes] = await Promise.all([
        supabase.from("product_categories").select("category_id").eq("shopify_product_id", pid),
        supabase.from("product_content").select("brand_id").eq("shopify_product_id", pid).maybeSingle(),
        supabase.from("product_attributes").select("attr_key, attr_value").eq("shopify_product_id", pid).order("sort_order"),
        supabase.from("categories").select("id, name, parent_id"),
        supabase.from("brands").select("id, name"),
      ]);
      const allCats = (catsAllRes.data || []) as { id: string; name: string; parent_id: string | null }[];
      const allBrands = (brandsAllRes.data || []) as { id: string; name: string }[];
      const linkedIds = ((pcRes.data || []) as { category_id: string }[]).map((r) => r.category_id);
      const buildPath = (id: string): string => {
        const cat = allCats.find((c) => c.id === id);
        if (!cat) return "";
        const parts = [cat.name];
        let cur = cat;
        const seen = new Set([cur.id]);
        while (cur.parent_id) {
          const p = allCats.find((c) => c.id === cur.parent_id);
          if (!p || seen.has(p.id)) break;
          seen.add(p.id);
          parts.unshift(p.name);
          cur = p;
        }
        return parts.join(" › ");
      };
      const cats = linkedIds.map((id) => {
        const c = allCats.find((x) => x.id === id);
        return c ? { id, name: c.name, path: buildPath(id) } : null;
      }).filter(Boolean) as { id: string; name: string; path: string }[];
      const bId = (contentRes.data as { brand_id: string | null } | null)?.brand_id;
      const brand = bId ? allBrands.find((b) => b.id === bId) || null : null;
      const attributes = ((attrsRes.data || []) as { attr_key: string; attr_value: string }[]).map((a) => ({
        key: a.attr_key,
        value: a.attr_value,
      }));
      setProductDetails({ categories: cats, brand: brand ? { id: brand.id, name: brand.name } : null, attributes });
    };
    fetchCustomContent();
  }, [product?.node?.id]);

  if (loading || audienceLoading || franchiseAccessLoading) {
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

  // Block access if product audience doesn't match viewer
  const productAllowed = isVisibleTo(product.node.id, isFranchisee);
  if (!productAllowed) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <p className="text-xl font-display">Produto indisponível</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Este produto não está disponível para o seu perfil.
            </p>
            <Link to="/catalogo">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Ver catálogo
              </Button>
            </Link>
          </div>
        </div>
        <Footer />
      </div>
    );
  }



  const { node } = product;
  const productVariations = getVariations(node.id).filter((item) =>
    isVisibleTo(item.shopify_product_id, isFranchisee),
  );
  const variant = node.variants.edges[selectedVariantIdx]?.node;
  const images = node.images.edges;
  const visibleRecommended = recommended.filter((item) =>
    isVisibleTo(item.node.id, isFranchisee),
  );
  const mainImage = images[selectedImageIdx]?.node || images[0]?.node;
  const price = parseFloat(variant?.price?.amount || "0");
  const compareAtPrice = variant?.compareAtPrice ? parseFloat(variant.compareAtPrice.amount) : null;
  const hasDiscount = compareAtPrice && compareAtPrice > price;
  const discountPercent = hasDiscount
    ? Math.round(((compareAtPrice - price) / compareAtPrice) * 100)
    : 0;
  const subscriberPrice = variant ? getSubscriberPrice(variant.id) : null;
  const franchisePrice = variant ? getFranchisePrice(variant.id) : null;
  const hasFranchiseDiscount = isFranchisee && franchisePrice !== null && franchisePrice < price;
  const hasSubscriberDiscount =
    !isFranchisee &&
    subscriberPrice !== null &&
    subscriberPrice < price;
  const installment = (price / 2).toFixed(2).replace(".", ",");

  

  const handleAdd = async () => {
    if (!variant) return;
    const addPromise = addItem({
      product,
      variantId: variant.id,
      variantTitle: variant.title,
      price: variant.price,
      quantity,
      selectedOptions: variant.selectedOptions || [],
    });
    openCartOnFirstAdd();
    await addPromise;
    toast.success("Adicionado à sacola!", { description: node.title, position: "top-center" });
  };

  const handleBuyNow = async () => {
    if (!variant) return;
    setBuyingNow(true);

    if (customCheckoutEnabled) {
      startCustomCheckout(navigate, [{ variantId: variant.id, quantity }], "buy_now");
      setBuyingNow(false);
      return;
    }

    if (isFranchisee) {
      try {
        const { data, error } = await supabase.functions.invoke("franchise-checkout", {
          body: { items: [{ variantId: variant.id, quantity }] },
        });
        if (error) throw error;
        if (data?.checkoutUrl) {
          goToCheckout(data.checkoutUrl);
          setBuyingNow(false);
          return;
        }
      } catch (err) {
        console.error("Franchise checkout failed:", err);
        toast.error("Erro ao aplicar preço de franquia.");
      }
    } else if (isSubscribed) {
      try {
        const { data, error } = await supabase.functions.invoke("subscriber-checkout", {
          body: { items: [{ variantId: variant.id, quantity }] },
        });
        if (error) throw error;
        if (data?.checkoutUrl) {
          goToCheckout(data.checkoutUrl);
          setBuyingNow(false);
          return;
        }
      } catch (err) {
        console.error("Subscriber checkout failed:", err);
        toast.error("Erro ao aplicar desconto do clube.");
      }
    }

    // Fallback: checkout instantâneo sem afetar o carrinho
    const checkoutUrl = await createInstantCheckoutUrl([
      { variantId: variant.id, quantity },
    ]);
    if (checkoutUrl) {
      goToCheckout(checkoutUrl);
    } else {
      toast.error("Não foi possível iniciar o checkout.");
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
      // Bullet: -, –, —, • require a space; * requires space AND must not be ** (bold marker)
      const bulletMatch = /^(?:[-–—•]|\*(?!\*))\s+(.+)/.exec(line) || /^\d+[.)]\s+(.+)/.exec(line);
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

  const descriptionBlocks = parseDescription(customContent?.description || node.description || "");
  

  // Render **bold** and *italic* markers as <strong>/<em>
  const renderInline = (text: string) => {
    const parts: (string | JSX.Element)[] = [];
    const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    let key = 0;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
      if (m[2] !== undefined) {
        parts.push(<strong key={key++} className="font-bold text-foreground">{m[2]}</strong>);
      } else if (m[3] !== undefined) {
        parts.push(<em key={key++} className="italic">{m[3]}</em>);
      }
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f6f7f9]">
      <Header />
      <main className="container mx-auto flex-1 px-4 py-5 lg:py-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Voltar para a loja
        </Link>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_430px] lg:gap-8">
          {/* Gallery */}
          <div className="rounded-3xl border border-border/70 bg-white p-3 shadow-sm sm:p-5">
            {/* Mobile: Carousel */}
            <div className="lg:hidden">
              <div className="relative aspect-square overflow-hidden rounded-2xl bg-white">
                {hasDiscount && (
                  <span className="absolute top-3 left-3 z-10 bg-accent text-accent-foreground text-xs font-bold px-2.5 py-1 rounded-lg shadow-sm">
                    {discountPercent}% OFF
                  </span>
                )}
                <span className="absolute top-3 right-3 z-10 bg-background/90 backdrop-blur text-[10px] font-medium px-2 py-1 rounded-md border border-border">
                  Imagens ilustrativas
                </span>
                <div
                  className="flex h-full w-full snap-x snap-mandatory overflow-x-auto scroll-smooth"
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    const idx = Math.round(el.scrollLeft / el.clientWidth);
                    if (idx !== selectedImageIdx) setSelectedImageIdx(idx);
                  }}
                >
                  {images.map((img, i) => (
                    <div
                      key={i}
                      className="flex-shrink-0 w-full h-full snap-center"
                    >
                      <ProductImage
                        src={img.node.url}
                        alt={img.node.altText || `${node.title} ${i + 1}`}
                        targetFill={0.82}
                        className="h-full w-full object-contain transition-transform duration-300"
                      />
                    </div>
                  ))}
                </div>
              </div>
              {/* Dots */}
              {images.length > 1 && (
                <div className="flex justify-center gap-1.5 mt-3">
                  {images.map((_, i) => (
                    <span
                      key={i}
                      className={`h-1.5 rounded-full transition-all ${
                        i === selectedImageIdx ? "w-6 bg-primary" : "w-1.5 bg-border"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Desktop: Thumbnails + main */}
            <div className="hidden lg:grid grid-cols-[140px_1fr] gap-4">
              <div className="relative">
                {thumbsOverflow && (
                  <button
                    onClick={() => scrollThumbs(-1)}
                    className="absolute -top-2 left-1/2 -translate-x-1/2 z-10 h-7 w-7 rounded-full bg-background border border-border shadow-sm flex items-center justify-center hover:bg-muted transition-colors"
                    aria-label="Anterior"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                )}
                <div
                  ref={thumbsRef}
                  className="flex flex-col gap-3 max-h-[600px] overflow-y-auto scroll-smooth scrollbar-hide"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {images.map((img, i) => (
                    <button
                      key={i}
                      onClick={() => setSelectedImageIdx(i)}
                      className={`aspect-square w-[140px] rounded-xl overflow-hidden border-2 transition-all flex-shrink-0 bg-white ${
                        i === selectedImageIdx
                          ? "border-primary shadow-md"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <ProductImage
                        src={img.node.url}
                        alt={img.node.altText || `${node.title} ${i + 1}`}
                        targetFill={0.78}
                        className="h-full w-full object-contain transition-transform duration-300"
                      />
                    </button>
                  ))}
                </div>
                {thumbsOverflow && (
                  <button
                    onClick={() => scrollThumbs(1)}
                    className="absolute -bottom-2 left-1/2 -translate-x-1/2 z-10 h-7 w-7 rounded-full bg-background border border-border shadow-sm flex items-center justify-center hover:bg-muted transition-colors"
                    aria-label="Próximo"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="relative aspect-square overflow-hidden rounded-2xl bg-white">
                {hasDiscount && (
                  <span className="absolute top-4 left-4 z-10 bg-accent text-accent-foreground text-sm font-bold px-3 py-1.5 rounded-lg shadow-sm">
                    {discountPercent}% OFF
                  </span>
                )}
                <span className="absolute top-4 right-4 z-10 bg-background/90 backdrop-blur text-xs font-medium px-3 py-1.5 rounded-lg border border-border">
                  Imagens ilustrativas
                </span>
                {mainImage && (
                  <ProductImage
                    src={mainImage.url}
                    alt={mainImage.altText || node.title}
                    targetFill={0.82}
                    className="h-full w-full object-contain transition-transform duration-300"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Buy Box */}
          <div className="space-y-5 rounded-3xl border border-border/70 bg-white p-5 shadow-sm lg:sticky lg:top-24 lg:p-6">
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
              {hasFranchiseDiscount && franchisePrice !== null && (
                <div className="flex items-center gap-1.5 pt-1">
                  <Crown className="h-4 w-4 text-emerald-600" />
                  <span className="font-display font-900 text-xl text-emerald-600 tabular-nums">
                    R$ {franchisePrice.toFixed(2).replace(".", ",")}
                  </span>
                  <span className="text-xs text-emerald-600/80 font-medium">preço franquia</span>
                </div>
              )}
              {hasSubscriberDiscount && (
                <div className="flex flex-col items-start gap-1 pt-1">
                  <span className="font-display font-900 text-xl text-sky-500 tabular-nums">
                    R$ {subscriberPrice.toFixed(2).replace(".", ",")}
                  </span>
                  <span className="text-xs font-medium text-sky-600">
                    No <strong className="font-black uppercase text-[#00a896]">Pix</strong> para assinantes
                  </span>
                </div>
              )}
            </div>

            {productVariations.length > 1 && (
              <div className="space-y-2">
                <p className="font-medium text-sm text-foreground">Tamanho:</p>
                <div className="flex flex-wrap gap-2">
                  {productVariations.map((item) => {
                    const active = item.shopify_product_id === node.id;
                    return (
                      <Link
                        key={item.id}
                        to={`/product/${item.shopify_product_handle}`}
                        title={item.shopify_product_title}
                        aria-current={active ? "page" : undefined}
                        className={`rounded-lg border-2 px-4 py-2 text-sm font-semibold transition-all ${
                          active
                            ? "border-[#171717] bg-[#171717] text-white"
                            : "border-border bg-background text-foreground hover:border-primary/60"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

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
        <section className="mt-10 max-w-4xl rounded-3xl border border-border/70 bg-white p-5 shadow-sm lg:mt-12 lg:p-8">
          <div>
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
                        {renderInline(block.text)}
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
                            <span>{renderInline(item)}</span>
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
                      {renderInline(block.text)}
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
        {visibleRecommended.length > 0 && (
          <section className="mt-12 lg:mt-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-10 w-1.5 bg-accent rounded-full" />
              <h2 className="font-display font-900 text-2xl lg:text-3xl">
                Você também pode gostar
              </h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {visibleRecommended.map((p) => (
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
