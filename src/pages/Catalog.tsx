import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ProductCard } from "@/components/ProductCard";
import { ShopifyProduct, storefrontApiRequest, PRODUCTS_QUERY } from "@/lib/shopify";
import { Loader2, PackageOpen, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

const SORT_OPTIONS = [
  { value: "relevance", label: "Relevância" },
  { value: "price-asc", label: "Menor preço" },
  { value: "price-desc", label: "Maior preço" },
  { value: "name-asc", label: "A - Z" },
  { value: "name-desc", label: "Z - A" },
];

interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
}
interface Brand {
  id: string;
  name: string;
  slug: string;
}

const Catalog = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get("busca") || "");
  const [categorySlug, setCategorySlug] = useState(searchParams.get("categoria") || "all");
  const [brandSlug, setBrandSlug] = useState(searchParams.get("marca") || "all");
  const [attrFilter, setAttrFilter] = useState(searchParams.get("atributo") || "all");
  const [sort, setSort] = useState("relevance");
  const [showFilters, setShowFilters] = useState(false);

  // DB data
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [productCats, setProductCats] = useState<{ shopify_product_id: string; category_id: string }[]>([]);
  const [productBrands, setProductBrands] = useState<{ shopify_product_id: string; brand_id: string | null }[]>([]);
  const [productAttrs, setProductAttrs] = useState<{ shopify_product_id: string; attr_key: string; attr_value: string }[]>([]);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const queryParam = searchParams.get("busca") || undefined;
        const [shop, cats, brs, pc, pcontent, pa] = await Promise.all([
          storefrontApiRequest(PRODUCTS_QUERY, { first: 100, query: queryParam || undefined }),
          supabase.from("categories").select("*").order("sort_order").order("name"),
          supabase.from("brands").select("*").order("name"),
          supabase.from("product_categories").select("shopify_product_id, category_id"),
          supabase.from("product_content").select("shopify_product_id, brand_id"),
          supabase.from("product_attributes").select("shopify_product_id, attr_key, attr_value"),
        ]);
        setProducts(shop?.data?.products?.edges || []);
        setCategories((cats.data || []) as Category[]);
        setBrands((brs.data || []) as Brand[]);
        setProductCats((pc.data || []) as any);
        setProductBrands((pcontent.data || []) as any);
        setProductAttrs((pa.data || []) as any);
      } catch (error) {
        console.error("Failed to fetch products:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, [searchParams]);

  const applyFilters = () => {
    const params: Record<string, string> = {};
    if (search) params.busca = search;
    if (categorySlug !== "all") params.categoria = categorySlug;
    if (brandSlug !== "all") params.marca = brandSlug;
    if (attrFilter !== "all") params.atributo = attrFilter;
    setSearchParams(params);
  };

  const clearFilters = () => {
    setSearch("");
    setCategorySlug("all");
    setBrandSlug("all");
    setAttrFilter("all");
    setSort("relevance");
    setSearchParams({});
  };

  // helpers
  const rootCats = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const selectedCat = useMemo(() => categories.find((c) => c.slug === categorySlug), [categories, categorySlug]);
  const subCats = useMemo(
    () => (selectedCat ? categories.filter((c) => c.parent_id === selectedCat.id) : []),
    [categories, selectedCat]
  );
  // include category + descendants
  const expandCategoryIds = (rootId: string): Set<string> => {
    const ids = new Set<string>([rootId]);
    let frontier = [rootId];
    while (frontier.length) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const c of categories) if (c.parent_id === id && !ids.has(c.id)) {
          ids.add(c.id);
          next.push(c.id);
        }
      }
      frontier = next;
    }
    return ids;
  };

  // Build unique attribute values per key for filter dropdown
  const attrOptions = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const a of productAttrs) {
      if (!map.has(a.attr_key)) map.set(a.attr_key, new Set());
      map.get(a.attr_key)!.add(a.attr_value);
    }
    const out: { value: string; label: string }[] = [];
    for (const [k, vs] of map) for (const v of vs) out.push({ value: `${k}=${v}`, label: `${k}: ${v}` });
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [productAttrs]);

  const filteredProducts = useMemo(() => {
    let result = [...products];

    // Category filter (via DB links + descendants)
    if (categorySlug !== "all") {
      if (categorySlug === "promocoes") {
        result = result.filter((p) => {
          const v = p.node.variants.edges[0]?.node;
          const price = parseFloat(v?.price?.amount || "0");
          const cmp = v?.compareAtPrice ? parseFloat(v.compareAtPrice.amount) : 0;
          return cmp > price;
        });
      } else if (selectedCat) {
        const allowed = expandCategoryIds(selectedCat.id);
        const productIds = new Set(
          productCats.filter((pc) => allowed.has(pc.category_id)).map((pc) => pc.shopify_product_id)
        );
        result = result.filter((p) => productIds.has(p.node.id));
      }
    }

    // Brand filter
    if (brandSlug !== "all") {
      const brand = brands.find((b) => b.slug === brandSlug);
      if (brand) {
        const productIds = new Set(
          productBrands.filter((pb) => pb.brand_id === brand.id).map((pb) => pb.shopify_product_id)
        );
        result = result.filter((p) => productIds.has(p.node.id));
      }
    }

    // Attribute filter
    if (attrFilter !== "all") {
      const [k, v] = attrFilter.split("=");
      const productIds = new Set(
        productAttrs.filter((a) => a.attr_key === k && a.attr_value === v).map((a) => a.shopify_product_id)
      );
      result = result.filter((p) => productIds.has(p.node.id));
    }

    // Sort
    if (sort === "price-asc") {
      result.sort((a, b) => parseFloat(a.node.priceRange.minVariantPrice.amount) - parseFloat(b.node.priceRange.minVariantPrice.amount));
    } else if (sort === "price-desc") {
      result.sort((a, b) => parseFloat(b.node.priceRange.minVariantPrice.amount) - parseFloat(a.node.priceRange.minVariantPrice.amount));
    } else if (sort === "name-asc") {
      result.sort((a, b) => a.node.title.localeCompare(b.node.title));
    } else if (sort === "name-desc") {
      result.sort((a, b) => b.node.title.localeCompare(a.node.title));
    }

    return result;
  }, [products, categorySlug, brandSlug, attrFilter, sort, selectedCat, productCats, productBrands, productAttrs, brands]);

  const hasActiveFilters =
    categorySlug !== "all" || brandSlug !== "all" || attrFilter !== "all" || search || sort !== "relevance";

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <div className="bg-primary/5 border-b border-border">
          <div className="container mx-auto py-8 md:py-12">
            <h1 className="font-display font-900 text-3xl md:text-4xl text-foreground">Catálogo</h1>
            <p className="text-muted-foreground mt-2">Encontre tudo que seu pet precisa</p>
          </div>
        </div>

        <div className="container mx-auto py-6 md:py-8">
          {/* Filters bar */}
          <div className="flex flex-col gap-4 mb-6">
            {/* Desktop filters */}
            <div className="hidden md:flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 max-w-sm min-w-[200px]">
                <Input
                  placeholder="Buscar produtos..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="rounded-full"
                />
              </div>

              <Select value={categorySlug} onValueChange={setCategorySlug}>
                <SelectTrigger className="w-[200px] rounded-full"><SelectValue placeholder="Categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as categorias</SelectItem>
                  <SelectItem value="promocoes">Promoções</SelectItem>
                  {rootCats.map((c) => (
                    <SelectItem key={c.id} value={c.slug}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={brandSlug} onValueChange={setBrandSlug}>
                <SelectTrigger className="w-[180px] rounded-full"><SelectValue placeholder="Marca" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as marcas</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.slug}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {attrOptions.length > 0 && (
                <Select value={attrFilter} onValueChange={setAttrFilter}>
                  <SelectTrigger className="w-[200px] rounded-full"><SelectValue placeholder="Atributo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os atributos</SelectItem>
                    {attrOptions.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-[160px] rounded-full"><SelectValue placeholder="Ordenar" /></SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button onClick={applyFilters} className="rounded-full">Buscar</Button>

              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                  <X className="h-4 w-4 mr-1" /> Limpar
                </Button>
              )}
            </div>

            {/* Mobile filters toggle */}
            <div className="md:hidden flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  placeholder="Buscar..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="rounded-full"
                />
              </div>
              <Button variant="outline" size="icon" className="rounded-full shrink-0" onClick={() => setShowFilters(!showFilters)}>
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
              <Button size="sm" onClick={applyFilters} className="rounded-full shrink-0">Buscar</Button>
            </div>

            {/* Mobile filters panel */}
            {showFilters && (
              <div className="md:hidden flex flex-col gap-3 p-4 rounded-xl bg-muted/50 border border-border animate-fade-in-up">
                <Select value={categorySlug} onValueChange={setCategorySlug}>
                  <SelectTrigger className="rounded-full"><SelectValue placeholder="Categoria" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as categorias</SelectItem>
                    <SelectItem value="promocoes">Promoções</SelectItem>
                    {rootCats.map((c) => (
                      <SelectItem key={c.id} value={c.slug}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={brandSlug} onValueChange={setBrandSlug}>
                  <SelectTrigger className="rounded-full"><SelectValue placeholder="Marca" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as marcas</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.slug}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {attrOptions.length > 0 && (
                  <Select value={attrFilter} onValueChange={setAttrFilter}>
                    <SelectTrigger className="rounded-full"><SelectValue placeholder="Atributo" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os atributos</SelectItem>
                      {attrOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="rounded-full"><SelectValue placeholder="Ordenar" /></SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {hasActiveFilters && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    <X className="h-4 w-4 mr-1" /> Limpar filtros
                  </Button>
                )}
              </div>
            )}

            {/* Category pills (root) */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              <button
                onClick={() => setCategorySlug("all")}
                className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  categorySlug === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Todas
              </button>
              <button
                onClick={() => setCategorySlug("promocoes")}
                className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  categorySlug === "promocoes" ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                Promoções
              </button>
              {rootCats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setCategorySlug(c.slug)}
                  className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    categorySlug === c.slug ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>

            {/* Subcategory pills */}
            {subCats.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {subCats.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCategorySlug(c.slug)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      categorySlug === c.slug ? "bg-primary/10 border-primary text-primary" : "bg-card border-border text-muted-foreground hover:border-primary/50"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Results count */}
          {!loading && (
            <p className="text-sm text-muted-foreground mb-4">
              {filteredProducts.length} produto{filteredProducts.length !== 1 ? "s" : ""} encontrado
              {filteredProducts.length !== 1 ? "s" : ""}
            </p>
          )}

          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <PackageOpen className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="font-display font-bold text-xl mb-2">Nenhum produto encontrado</h3>
              <p className="text-muted-foreground max-w-md">Tente ajustar os filtros ou buscar por outro termo.</p>
              {hasActiveFilters && (
                <Button variant="outline" className="mt-4" onClick={clearFilters}>Limpar filtros</Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
              {filteredProducts.map((product) => (
                <ProductCard key={product.node.id} product={product} />
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Catalog;
