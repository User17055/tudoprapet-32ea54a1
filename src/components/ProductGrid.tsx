import { useEffect, useState } from "react";
import { fetchAllShopifyProducts, type ShopifyProduct } from "@/lib/shopify";
import { ProductCard } from "@/components/ProductCard";
import { ProductCardSkeleton } from "@/components/ProductCardSkeleton";
import { PackageOpen } from "lucide-react";
import useEmblaCarousel from "embla-carousel-react";
import { useProductAudience } from "@/hooks/useProductAudience";
import { useIsFranchisee } from "@/hooks/useIsFranchisee";
import { useProductVariations } from "@/hooks/useProductVariations";
import { isProductAvailable } from "@/lib/productAvailability";
import { useClientSaleVisibility } from "@/hooks/useClientSaleVisibility";
import { isClientProductVisible } from "@/lib/clientSaleVisibility";
import { fetchAllRowsResult } from "@/lib/fetchAllRows";

interface FeaturedProduct {
  shopify_product_id: string;
}

export const ProductGrid = () => {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [allProducts, setAllProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const { isVisibleTo, loading: audienceLoading } = useProductAudience();
  const { isFranchisee, loading: franchiseeLoading } = useIsFranchisee();
  const { blockedVariantIds, loading: saleVisibilityLoading } = useClientSaleVisibility();
  const {
    getVariations,
    loading: variationsLoading,
  } = useProductVariations();
  const [emblaRef] = useEmblaCarousel({
    align: "start",
    loop: false,
    dragFree: true,
    containScroll: "trimSnaps",
  });

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const [shopifyData, featuredData] = await Promise.all([
          fetchAllShopifyProducts(),
          fetchAllRowsResult<{ shopify_product_id: string }>("featured_products", "id,shopify_product_id", {
            orderBy: ["sort_order", "id"],
          }),
        ]);

        const shopifyProducts = shopifyData || [];
        setAllProducts(shopifyProducts);
        if (featuredData.error) {
          console.error("Failed to fetch featured products:", featuredData.error);
          setProducts(shopifyProducts.filter(isProductAvailable).slice(0, 12));
          return;
        }

        const featuredIds = ((featuredData.data || []) as FeaturedProduct[]).map(
          (item) => item.shopify_product_id
        );

        if (featuredIds.length === 0) {
          setProducts(shopifyProducts.filter(isProductAvailable).slice(0, 12));
          return;
        }

        const productById = new Map(
          shopifyProducts.map((product: ShopifyProduct) => [product.node.id, product])
        );
        setProducts(
          featuredIds
            .map((id) => productById.get(id))
            .filter((product): product is ShopifyProduct => Boolean(product))
        );
      } catch (error) {
        console.error("Failed to fetch products:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, []);

  return (
    <section className="bg-white py-10 md:py-14">
      <div className="container mx-auto">
        <div className="mb-4">
          <span className="text-xs font-bold uppercase tracking-wider text-secondary">
            Selecionados pra voce
          </span>
          <h2 className="font-display text-2xl font-900 md:text-3xl">
            Destaques da semana
          </h2>
          <p className="text-sm text-muted-foreground">
            Os mais vendidos com os melhores precos
          </p>
        </div>

        {loading || audienceLoading || franchiseeLoading || variationsLoading || saleVisibilityLoading ? (
          <div className="overflow-hidden" aria-label="Carregando produtos">
            <div className="flex gap-2 md:gap-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="w-[45%] flex-shrink-0 flex-grow-0 md:w-[200px]"
                >
                  <ProductCardSkeleton />
                </div>
              ))}
            </div>
          </div>
        ) : (() => {
          const audienceVisible = products.filter((p) => isVisibleTo(p.node.id, isFranchisee)
            && isClientProductVisible(p, blockedVariantIds, isFranchisee));
          const available = audienceVisible.filter(isProductAvailable);
          const visibleIds = new Set(available.map((product) => product.node.id));
          const visible = available.filter((product) => {
            const group = getVariations(product.node.id);
            const representative = group.find((item) => visibleIds.has(item.shopify_product_id));
            return !representative || representative.shopify_product_id === product.node.id;
          });
          if (visible.length === 0) {
            return (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <PackageOpen className="mb-4 h-16 w-16 text-muted-foreground" />
                <h3 className="font-display mb-2 text-xl font-bold">Nenhum produto encontrado</h3>
                <p className="max-w-md text-muted-foreground">
                  A loja ainda nao tem produtos cadastrados.
                </p>
              </div>
            );
          }
          return (
            <div className="overflow-hidden" ref={emblaRef}>
              <div className="flex gap-2 md:gap-3">
                {visible.map((product) => (
                  <div
                    key={product.node.id}
                    className="w-[45%] flex-shrink-0 flex-grow-0 md:w-[200px]"
                  >
                    <ProductCard product={product} products={allProducts} />
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </section>
  );
};
