import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ProductCard } from "@/components/ProductCard";
import { ShopifyProduct, storefrontApiRequest, PRODUCTS_QUERY } from "@/lib/shopify";
import { Loader2, PackageOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { STANDARD_ATTR_KEYS } from "@/lib/productAttributes";

const SORT_OPTIONS = [
  { value: "relevance", label: "Relevância" },
  { value: "price-asc", label: "Menor preço" },
  { value: "price-desc", label: "Maior preço" },
  { value: "name-asc", label: "A - Z" },
  { value: "name-desc", label: "Z - A" },
];

const PRICE_RANGES = [
  { label: "R$ 0,00 - R$ 25,00", min: 0, max: 25 },
  { label: "R$ 25,00 - R$ 50,00", min: 25, max: 50 },
  { label: "R$ 50,00 - R$ 100,00", min: 50, max: 100 },
  { label: "R$ 100,00 - R$ 200,00", min: 100, max: 200 },
  { label: "+ R$ 200,00", min: 200, max: Infinity },
];

interface Category { id: string; name: string; slug: string; parent_id: string | null; sort_order: number; }
interface Brand { id: string; name: string; slug: string; }
interface AttrValue { id: string; attr_key: string; attr_value: string; sort_order: number; }

const Catalog = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get("busca") || "");
  const [categorySlug, setCategorySlug] = useState(searchParams.get("categoria") || "all");
  // multi-select brand slugs and attribute values
  const [brandSlugs, setBrandSlugs] = useState<Set<string>>(new Set());
  const [attrValues, setAttrValues] = useState<Record<string, Set<string>>>({});
  const [priceRangeIdxs, setPriceRangeIdxs] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState("relevance");

  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [presetValues, setPresetValues] = useState<AttrValue[]>([]);
  const [productCats, setProductCats] = useState<{ shopify_product_id: string; category_id: string }[]>([]);
  const [productBrands, setProductBrands] = useState<{ shopify_product_id: string; brand_id: string | null }[]>([]);
  const [productAttrs, setProductAttrs] = useState<{ shopify_product_id: string; attr_key: string; attr_value: string }[]>([]);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const queryParam = searchParams.get("busca") || undefined;
        const [shop, cats, brs, pv, pc, pcontent, pa] = await Promise.all([
          storefrontApiRequest(PRODUCTS_QUERY, { first: 100, query: queryParam || undefined }),
          supabase.from("categories").select("*").order("sort_order").order("name"),
          supabase.from("brands").select("*").order("name"),
          supabase.from("attribute_values").select("*").order("attr_key").order("sort_order").order("attr_value"),
          supabase.from("product_categories").select("shopify_product_id, category_id"),
          supabase.from("product_content").select("shopify_product_id, brand_id"),
          supabase.from("product_attributes").select("shopify_product_id, attr_key, attr_value"),
        ]);
        setProducts(shop?.data?.products?.edges || []);
        setCategories((cats.data || []) as Category[]);
        setBrands((brs.data || []) as Brand[]);
        setPresetValues((pv.data || []) as AttrValue[]);
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

  const applySearch = () => {
    const params: Record<string, string> = {};
    if (search) params.busca = search;
    if (categorySlug !== "all") params.categoria = categorySlug;
    setSearchParams(params);
  };

  const clearFilters = () => {
    setSearch("");
    setCategorySlug("all");
    setBrandSlugs(new Set());
    setAttrValues({});
    setPriceRangeIdxs(new Set());
    setSort("relevance");
    setSearchParams({});
  };

  const rootCats = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const selectedCat = useMemo(() => categories.find((c) => c.slug === categorySlug), [categories, categorySlug]);
  const subCats = useMemo(
    () => (selectedCat ? categories.filter((c) => c.parent_id === selectedCat.id) : []),
    [categories, selectedCat]
  );
  const expandCategoryIds = (rootId: string): Set<string> => {
    const ids = new Set<string>([rootId]);
    let frontier = [rootId];
    while (frontier.length) {
      const next: string[] = [];
      for (const id of frontier) for (const c of categories) if (c.parent_id === id && !ids.has(c.id)) { ids.add(c.id); next.push(c.id); }
      frontier = next;
    }
    return ids;
  };

  // Counts per filter — based on products that pass all OTHER filters
  // For simplicity & performance, counts are based on the unfiltered product set.
  const productPrice = (p: ShopifyProduct) => parseFloat(p.node.priceRange.minVariantPrice.amount);
  const productById = useMemo(() => new Map(products.map((p) => [p.node.id, p])), [products]);

  // Build per-key value list (union of preset values + values used on products)
  const valuesByKey = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const a of productAttrs) {
      if (!map.has(a.attr_key)) map.set(a.attr_key, new Set());
      map.get(a.attr_key)!.add(a.attr_value);
    }
    for (const v of presetValues) {
      if (!map.has(v.attr_key)) map.set(v.attr_key, new Set());
      map.get(v.attr_key)!.add(v.attr_value);
    }
    return map;
  }, [productAttrs, presetValues]);

  const customKeys = useMemo(() => {
    const keys: string[] = [];
    for (const k of valuesByKey.keys()) {
      if (!(STANDARD_ATTR_KEYS as readonly string[]).includes(k)) keys.push(k);
    }
    return keys.sort();
  }, [valuesByKey]);

  // count products per brand slug
  const brandCount = useMemo(() => {
    const m = new Map<string, number>();
    const productBrandMap = new Map<string, string>();
    productBrands.forEach((pb) => { if (pb.brand_id) productBrandMap.set(pb.shopify_product_id, pb.brand_id); });
    for (const b of brands) {
      let n = 0;
      for (const p of products) if (productBrandMap.get(p.node.id) === b.id) n++;
      m.set(b.slug, n);
    }
    return m;
  }, [brands, productBrands, products]);

  const priceCount = useMemo(() => {
    return PRICE_RANGES.map((r) => products.filter((p) => {
      const price = productPrice(p);
      return price >= r.min && price <= r.max;
    }).length);
  }, [products]);

  const attrCount = (key: string, value: string) =>
    productAttrs.filter((a) => a.attr_key === key && a.attr_value === value).length;

  const filteredProducts = useMemo(() => {
    let result = [...products];

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
        const productIds = new Set(productCats.filter((pc) => allowed.has(pc.category_id)).map((pc) => pc.shopify_product_id));
        result = result.filter((p) => productIds.has(p.node.id));
      }
    }

    if (brandSlugs.size > 0) {
      const brandIds = new Set(brands.filter((b) => brandSlugs.has(b.slug)).map((b) => b.id));
      const productIds = new Set(productBrands.filter((pb) => pb.brand_id && brandIds.has(pb.brand_id)).map((pb) => pb.shopify_product_id));
      result = result.filter((p) => productIds.has(p.node.id));
    }

    // attribute filters: AND across keys, OR within a key
    for (const [k, set] of Object.entries(attrValues)) {
      if (!set || set.size === 0) continue;
      const productIds = new Set(productAttrs.filter((a) => a.attr_key === k && set.has(a.attr_value)).map((a) => a.shopify_product_id));
      result = result.filter((p) => productIds.has(p.node.id));
    }

    // price ranges (OR)
    if (priceRangeIdxs.size > 0) {
      result = result.filter((p) => {
        const price = productPrice(p);
        for (const idx of priceRangeIdxs) {
          const r = PRICE_RANGES[idx];
          if (price >= r.min && price <= r.max) return true;
        }
        return false;
      });
    }

    if (sort === "price-asc") result.sort((a, b) => productPrice(a) - productPrice(b));
    else if (sort === "price-desc") result.sort((a, b) => productPrice(b) - productPrice(a));
    else if (sort === "name-asc") result.sort((a, b) => a.node.title.localeCompare(b.node.title));
    else if (sort === "name-desc") result.sort((a, b) => b.node.title.localeCompare(a.node.title));

    return result;
  }, [products, categorySlug, brandSlugs, attrValues, priceRangeIdxs, sort, selectedCat, productCats, productBrands, productAttrs, brands]);

  const totalAttrSelected = Object.values(attrValues).reduce((n, s) => n + (s?.size || 0), 0);
  const hasActiveFilters =
    categorySlug !== "all" || brandSlugs.size > 0 || totalAttrSelected > 0 || search ||
    priceRangeIdxs.size > 0 || sort !== "relevance";

  const toggleSetItem = <T,>(setState: React.Dispatch<React.SetStateAction<Set<T>>>, item: T) =>
    setState((prev) => {
      const next = new Set(prev);
      if (next.has(item)) next.delete(item); else next.add(item);
      return next;
    });

  const toggleAttr = (key: string, value: string) =>
    setAttrValues((prev) => {
      const next = { ...prev };
      const cur = new Set(next[key] || []);
      if (cur.has(value)) cur.delete(value); else cur.add(value);
      if (cur.size === 0) delete next[key]; else next[key] = cur;
      return next;
    });

  const CheckRow = ({ checked, onChange, label, count }: { checked: boolean; onChange: () => void; label: string; count?: number }) => (
    <label className="flex items-center gap-2 py-1.5 cursor-pointer text-sm hover:text-primary">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-muted-foreground text-xs">({count})</span>}
    </label>
  );

  // Sidebar with all filters
  const FiltersSidebar = (
    <aside className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-bold text-base">Filtrar Produtos</h3>
        </div>
        {hasActiveFilters && (
          <button onClick={clearFilters} className="text-sm text-primary hover:underline flex items-center gap-1.5">
            Limpar filtros <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="font-display font-bold text-sm uppercase tracking-wide mb-3">Buscar</h3>
        <div className="flex gap-2">
          <Input
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applySearch()}
            className="rounded-full"
          />
          <Button size="sm" onClick={applySearch} className="rounded-full shrink-0">Ir</Button>
        </div>
      </div>

      <Accordion type="multiple" defaultValue={["preco", "categoria", "marca", ...STANDARD_ATTR_KEYS as unknown as string[]]} className="rounded-xl border border-border bg-card px-4">
        <AccordionItem value="preco" className="border-b border-border last:border-0">
          <AccordionTrigger className="font-display font-bold text-sm">Faixa de Preço</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-0.5">
              {PRICE_RANGES.map((r, idx) => (
                <CheckRow
                  key={idx}
                  checked={priceRangeIdxs.has(idx)}
                  onChange={() => toggleSetItem(setPriceRangeIdxs, idx)}
                  label={r.label}
                  count={priceCount[idx]}
                />
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="categoria" className="border-b border-border last:border-0">
          <AccordionTrigger className="font-display font-bold text-sm">Categoria</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-1">
              <button onClick={() => setCategorySlug("all")} className={`block w-full text-left text-sm px-2 py-1.5 rounded ${categorySlug === "all" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"}`}>Todas</button>
              <button onClick={() => setCategorySlug("promocoes")} className={`block w-full text-left text-sm px-2 py-1.5 rounded ${categorySlug === "promocoes" ? "bg-secondary/10 text-secondary font-medium" : "hover:bg-muted"}`}>Promoções</button>
              {rootCats.map((c) => (
                <button key={c.id} onClick={() => setCategorySlug(c.slug)} className={`block w-full text-left text-sm px-2 py-1.5 rounded ${categorySlug === c.slug ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"}`}>{c.name}</button>
              ))}
            </div>
            {subCats.length > 0 && (
              <div className="mt-2 pl-3 border-l border-border space-y-1">
                {subCats.map((c) => (
                  <button key={c.id} onClick={() => setCategorySlug(c.slug)} className={`block w-full text-left text-xs px-2 py-1 rounded ${categorySlug === c.slug ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground"}`}>{c.name}</button>
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="marca" className="border-b border-border last:border-0">
          <AccordionTrigger className="font-display font-bold text-sm">Marca</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-0.5 max-h-72 overflow-auto">
              {brands.length === 0 && <p className="text-xs text-muted-foreground py-2">Nenhuma marca.</p>}
              {brands.map((b) => (
                <CheckRow
                  key={b.id}
                  checked={brandSlugs.has(b.slug)}
                  onChange={() => toggleSetItem(setBrandSlugs, b.slug)}
                  label={b.name}
                  count={brandCount.get(b.slug)}
                />
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        {STANDARD_ATTR_KEYS.map((key) => {
          const values = Array.from(valuesByKey.get(key) || []).sort();
          if (values.length === 0) return null;
          const selected = attrValues[key] || new Set<string>();
          return (
            <AccordionItem key={key} value={key} className="border-b border-border last:border-0">
              <AccordionTrigger className="font-display font-bold text-sm">{key}</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-0.5 max-h-72 overflow-auto">
                  {values.map((v) => (
                    <CheckRow
                      key={v}
                      checked={selected.has(v)}
                      onChange={() => toggleAttr(key, v)}
                      label={v}
                      count={attrCount(key, v)}
                    />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}

        {customKeys.map((key) => {
          const values = Array.from(valuesByKey.get(key) || []).sort();
          const selected = attrValues[key] || new Set<string>();
          return (
            <AccordionItem key={key} value={key} className="border-b border-border last:border-0">
              <AccordionTrigger className="font-display font-bold text-sm">{key}</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-0.5 max-h-72 overflow-auto">
                  {values.map((v) => (
                    <CheckRow
                      key={v}
                      checked={selected.has(v)}
                      onChange={() => toggleAttr(key, v)}
                      label={v}
                      count={attrCount(key, v)}
                    />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </aside>
  );

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
          <div className="grid lg:grid-cols-[260px_1fr] gap-6">
            <div className="hidden lg:block">{FiltersSidebar}</div>

            <details className="lg:hidden rounded-xl border border-border bg-card overflow-hidden">
              <summary className="cursor-pointer px-4 py-3 font-display font-bold text-sm uppercase tracking-wide flex items-center justify-between">
                Filtros {hasActiveFilters && <span className="text-xs bg-primary text-primary-foreground rounded-full px-2 py-0.5">Ativos</span>}
              </summary>
              <div className="p-4 border-t border-border">{FiltersSidebar}</div>
            </details>

            <div>
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                {!loading && (
                  <p className="text-sm text-muted-foreground">
                    {filteredProducts.length} produto{filteredProducts.length !== 1 ? "s" : ""} encontrado{filteredProducts.length !== 1 ? "s" : ""}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground hidden sm:inline">Ordenar por</span>
                  <Select value={sort} onValueChange={setSort}>
                    <SelectTrigger className="w-[180px] rounded-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SORT_OPTIONS.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

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
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1 md:gap-1.5">
                  {filteredProducts.map((product) => (
                    <ProductCard key={product.node.id} product={product} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Catalog;
