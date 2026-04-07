import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { storefrontApiRequest, PRODUCT_BY_HANDLE_QUERY, ShopifyProduct } from "@/lib/shopify";
import { useCartStore } from "@/stores/cartStore";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { ShoppingCart, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

const ProductDetail = () => {
  const { handle } = useParams<{ handle: string }>();
  const [product, setProduct] = useState<ShopifyProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedVariantIdx, setSelectedVariantIdx] = useState(0);
  const addItem = useCartStore((s) => s.addItem);
  const isLoading = useCartStore((s) => s.isLoading);

  useEffect(() => {
    const fetch = async () => {
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
    fetch();
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
            <p className="font-display font-900 text-3xl text-primary">R$ {price.toFixed(2)}</p>

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

            <Button size="lg" className="w-full btn-bounce text-lg py-6 rounded-full" onClick={handleAdd} disabled={isLoading || !variant?.availableForSale}>
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <ShoppingCart className="h-5 w-5 mr-2" /> Adicionar ao Carrinho
                </>
              )}
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default ProductDetail;
