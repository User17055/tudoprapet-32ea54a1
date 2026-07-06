import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { storefrontApiRequest, PRODUCTS_QUERY, type ShopifyProduct } from "@/lib/shopify";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowDown, ArrowUp, Loader2, Package, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface FeaturedProduct {
  id: string;
  shopify_product_id: string;
  sort_order: number;
}

export default function FeaturedTab() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [featured, setFeatured] = useState<FeaturedProduct[]>([]);
  const [productId, setProductId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [shop, highlights] = await Promise.all([
        storefrontApiRequest(PRODUCTS_QUERY, { first: 100 }),
        supabase.from("featured_products").select("*").order("sort_order", { ascending: true }),
      ]);

      setProducts(shop?.data?.products?.edges || []);
      if (highlights.error) throw highlights.error;
      setFeatured((highlights.data || []) as FeaturedProduct[]);
    } catch (error: any) {
      toast.error("Erro ao carregar destaques");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const productById = useMemo(() => {
    const map = new Map<string, ShopifyProduct["node"]>();
    products.forEach((product) => map.set(product.node.id, product.node));
    return map;
  }, [products]);

  const selectedProductIds = useMemo(
    () => new Set(featured.map((item) => item.shopify_product_id)),
    [featured]
  );

  const availableProducts = useMemo(
    () => products.filter((product) => !selectedProductIds.has(product.node.id)),
    [products, selectedProductIds]
  );

  const addFeatured = async () => {
    if (!productId) {
      toast.error("Selecione um produto");
      return;
    }

    setSaving(true);
    const nextOrder = (featured[featured.length - 1]?.sort_order ?? 0) + 1;
    const { error } = await supabase.from("featured_products").insert({
      shopify_product_id: productId,
      sort_order: nextOrder,
    });
    setSaving(false);

    if (error) {
      toast.error("Erro ao adicionar destaque: " + error.message);
      return;
    }

    toast.success("Produto adicionado aos destaques");
    setProductId("");
    loadAll();
  };

  const removeFeatured = async (item: FeaturedProduct) => {
    const { error } = await supabase.from("featured_products").delete().eq("id", item.id);
    if (error) {
      toast.error("Erro ao remover destaque");
      return;
    }

    toast.success("Destaque removido");
    setFeatured((current) => current.filter((entry) => entry.id !== item.id));
  };

  const moveFeatured = async (index: number, direction: -1 | 1) => {
    const target = featured[index + direction];
    const current = featured[index];
    if (!target || !current) return;

    const [currentUpdate, targetUpdate] = await Promise.all([
      supabase
        .from("featured_products")
        .update({ sort_order: target.sort_order })
        .eq("id", current.id),
      supabase
        .from("featured_products")
        .update({ sort_order: current.sort_order })
        .eq("id", target.id),
    ]);

    if (currentUpdate.error || targetUpdate.error) {
      toast.error("Erro ao reordenar destaques");
      return;
    }

    loadAll();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Destaques da semana</CardTitle>
        <p className="text-sm text-muted-foreground">
          Escolha os produtos que aparecem na seção de destaques da página inicial.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Select value={productId} onValueChange={setProductId} disabled={loading}>
            <SelectTrigger>
              <SelectValue placeholder="Selecione um produto..." />
            </SelectTrigger>
            <SelectContent>
              {availableProducts.map((product) => (
                <SelectItem key={product.node.id} value={product.node.id}>
                  {product.node.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={addFeatured} disabled={saving || loading || !productId}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Adicionar
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : featured.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum destaque escolhido. Enquanto isso, a home mostra produtos automaticamente.
          </p>
        ) : (
          <div className="space-y-3">
            {featured.map((item, index) => {
              const product = productById.get(item.shopify_product_id);
              const image = product?.images.edges[0]?.node;

              return (
                <div
                  key={item.id}
                  className="grid gap-3 rounded-lg border bg-card p-3 md:grid-cols-[72px_1fr_auto]"
                >
                  <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-md bg-muted">
                    {image ? (
                      <img
                        src={image.url}
                        alt={image.altText || product?.title || ""}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Package className="h-7 w-7 text-muted-foreground" />
                    )}
                  </div>

                  <div className="min-w-0 self-center">
                    <p className="font-medium">{product?.title || "Produto removido da Shopify"}</p>
                    <p className="text-xs text-muted-foreground">
                      Posicao {index + 1}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => moveFeatured(index, -1)}
                      disabled={index === 0}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => moveFeatured(index, 1)}
                      disabled={index === featured.length - 1}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeFeatured(item)}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
