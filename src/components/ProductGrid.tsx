import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { ShopifyProduct, storefrontApiRequest, PRODUCTS_QUERY } from "@/lib/shopify";
import { ProductCard } from "@/components/ProductCard";
import { Loader2, PackageOpen, ChevronLeft, ChevronRight } from "lucide-react";
import useEmblaCarousel from "embla-carousel-react";

export const ProductGrid = () => {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    loop: false,
    dragFree: true,
    containScroll: "trimSnaps",
  });
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(true);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const data = await storefrontApiRequest(PRODUCTS_QUERY, { first: 12 });
        setProducts(data?.data?.products?.edges || []);
      } catch (error) {
        console.error("Failed to fetch products:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, []);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
  }, [emblaApi, onSelect]);

  const scrollPrev = useCallback(() => emblaApi && emblaApi.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi && emblaApi.scrollNext(), [emblaApi]);

  return (
    <section className="py-10 md:py-14 bg-white">
      <div className="container mx-auto">
        <div className="flex items-end justify-between mb-4">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-secondary">
              Selecionados pra você
            </span>
            <h2 className="font-display font-900 text-2xl md:text-3xl">
              Destaques da semana
            </h2>
            <p className="text-sm text-muted-foreground">
              Os mais vendidos com os melhores preços
            </p>
          </div>
          <div className="hidden md:flex items-center gap-2">
            <button
              onClick={scrollPrev}
              disabled={!canScrollPrev}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow border border-border text-primary hover:bg-primary hover:text-white transition disabled:opacity-40"
              aria-label="Anterior"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={scrollNext}
              disabled={!canScrollNext}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white shadow border border-border text-primary hover:bg-primary hover:text-white transition disabled:opacity-40"
              aria-label="Próximo"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <PackageOpen className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="font-display font-bold text-xl mb-2">Nenhum produto encontrado</h3>
            <p className="text-muted-foreground max-w-md">
              A loja ainda não tem produtos cadastrados.
            </p>
          </div>
        ) : (
          <div className="relative">
            <div className="overflow-hidden" ref={emblaRef}>
              <div className="flex gap-2 md:gap-3">
                {products.map((product) => (
                  <div
                    key={product.node.id}
                    className="flex-shrink-0 flex-grow-0 w-[48%] md:w-[200px]"
                  >
                    <ProductCard product={product} />
                  </div>
                ))}
              </div>
            </div>

            {/* Mobile arrows */}
            <div className="flex md:hidden items-center justify-center gap-3 mt-4">
              <button
                onClick={scrollPrev}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow border border-border text-primary active:bg-primary active:text-white transition"
                aria-label="Anterior"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <Link
                to="/catalogo"
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-display font-bold px-5 py-2.5 rounded-full text-sm"
              >
                Ver todos
              </Link>
              <button
                onClick={scrollNext}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow border border-border text-primary active:bg-primary active:text-white transition"
                aria-label="Próximo"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          </div>
        )}

      </div>
    </section>
  );
};
