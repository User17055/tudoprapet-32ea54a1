import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShopifyProduct, storefrontApiRequest, PRODUCTS_QUERY } from "@/lib/shopify";
import { ProductCard } from "@/components/ProductCard";
import { Loader2, PackageOpen } from "lucide-react";

export const ProductGrid = () => {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <section className="py-10 md:py-14 bg-muted/40">
      <div className="container mx-auto">
        <div className="flex items-end justify-between mb-6">
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
          <Link
            to="/catalogo"
            className="hidden md:inline text-sm font-bold text-primary hover:underline shrink-0"
          >
            Ver todos →
          </Link>
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">
            {products.map((product) => (
              <ProductCard key={product.node.id} product={product} />
            ))}
          </div>
        )}

        <div className="mt-8 text-center md:hidden">
          <Link
            to="/catalogo"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-display font-bold px-6 py-3 rounded-full"
          >
            Ver todos os produtos →
          </Link>
        </div>
      </div>
    </section>
  );
};
