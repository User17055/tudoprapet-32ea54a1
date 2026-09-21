import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchAllShopifyProducts, type ShopifyProduct } from "@/lib/shopify";
import { findPossibleDuplicates } from "@/lib/productDuplicates";
import { normalizeText } from "@/lib/fuzzySearch";

const PAGE_SIZE = 20;

export default function DuplicatesTab() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      setProducts(await fetchAllShopifyProducts());
    } catch (error) {
      toast.error("Não foi possível conferir os produtos", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const pairs = useMemo(() => findPossibleDuplicates(products.map(({ node }) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
    sku: node.variants.edges[0]?.node.sku,
  }))), [products]);
  const filtered = useMemo(() => {
    const term = normalizeText(query);
    return !term ? pairs : pairs.filter(({ first, second }) =>
      normalizeText(`${first.title} ${second.title} ${first.sku || ""} ${second.sku || ""}`).includes(term));
  }, [pairs, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Possíveis duplicados</CardTitle>
          <CardDescription className="mt-1">
            {pairs.length} pares suspeitos entre {products.length} produtos. Compara nomes parecidos e exige a mesma apresentação, peso ou dosagem. Confira antes de alterar na Shopify.
          </CardDescription>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Atualizar
        </Button>
      </CardHeader>
      <CardContent>
        <div className="relative mb-4 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar nome ou SKU" className="pl-9" />
        </div>
        {loading ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
          : visible.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Nenhum possível duplicado encontrado.</p>
          : <div className="space-y-3">
            {visible.map((pair) => <div key={`${pair.first.id}:${pair.second.id}`} className="rounded-lg border p-4">
              <p className="mb-3 text-xs font-semibold text-amber-700">
                {pair.reason === "sku" ? "Mesmo SKU e apresentação" : pair.reason === "same_name" ? "Nome e apresentação equivalentes" : "Nome muito parecido e mesma apresentação"}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {[pair.first, pair.second].map((product) => <div key={product.id} className="min-w-0 rounded-md bg-muted/50 p-3">
                  <p className="font-medium">{product.title}</p>
                  {product.sku && <p className="mt-1 text-xs text-muted-foreground">SKU {product.sku}</p>}
                  <a href={`/product/${product.handle}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    Ver produto <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>)}
              </div>
            </div>)}
          </div>}
        {pages > 1 && <div className="mt-5 flex items-center justify-end gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</Button>
          Página {page} de {pages}
          <Button variant="outline" size="sm" disabled={page === pages} onClick={() => setPage(page + 1)}>Próxima</Button>
        </div>}
      </CardContent>
    </Card>
  );
}
