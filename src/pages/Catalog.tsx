import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ProductCard } from "@/components/ProductCard";
import { ShopifyProduct, storefrontApiRequest, PRODUCTS_QUERY } from "@/lib/shopify";
import { Loader2, PackageOpen, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CATEGORIES = [
  { value: "all", label: "Todas" },
  { value: "racoes", label: "Rações" },
  { value: "brinquedos", label: "Brinquedos" },
  { value: "camas", label: "Camas & Casinhas" },
  { value: "farmacia", label: "Farmácia" },
  { value: "higiene", label: "Higiene" },
];

const SORT_OPTIONS = [
  { value: "relevance", label: "Relevância" },
  { value: "price-asc", label: "Menor preço" },
  { value: "price-desc", label: "Maior preço" },
  { value: "name-asc", label: "A - Z" },
  { value: "name-desc", label: "Z - A" },
];

const Catalog = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get("busca") || "");
  const [category, setCategory] = useState(searchParams.get("categoria") || "all");
  const [sort, setSort] = useState("relevance");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const fetchProducts = async () => {
      setLoading(true);
      try {
        const queryParam = searchParams.get("busca") || undefined;
        const data = await storefrontApiRequest(PRODUCTS_QUERY, {
          first: 50,
          query: queryParam || undefined,
        });
        setProducts(data?.data?.products?.edges || []);
      } catch (error) {
        console.error("Failed to fetch products:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, [searchParams]);

  // Update URL params
  const applyFilters = () => {
    const params: Record<string, string> = {};
    if (search) params.busca = search;
    if (category !== "all") params.categoria = category;
    setSearchParams(params);
  };

  const clearFilters = () => {
    setSearch("");
    setCategory("all");
    setSort("relevance");
    setSearchParams({});
  };

  // Client-side filtering by category (tag-based)
  const filteredProducts = useMemo(() => {
    let result = [...products];

    // Category filter (match against product type or tags in title/description)
    if (category !== "all") {
      const categoryMap: Record<string, string[]> = {
        racoes: ["ração", "racao", "ração", "alimento", "comida", "petisco"],
        brinquedos: ["brinquedo", "toy", "bola", "mordedor"],
        camas: ["cama", "casinha", "caminha", "colchão", "colchao"],
        farmacia: ["remédio", "remedio", "medicamento", "antipulgas", "carrapato", "vermífugo", "vitamina", "bravecto", "farmácia"],
        higiene: ["shampoo", "banho", "higiene", "escova", "pente", "toalha"],
      };
      const keywords = categoryMap[category] || [];
      result = result.filter((p) => {
        const text = `${p.node.title} ${p.node.description}`.toLowerCase();
        return keywords.some((kw) => text.includes(kw));
      });
    }

    // Search filter (client-side for already loaded products)
    if (search && !searchParams.get("busca")) {
      const q = search.toLowerCase();
      result = result.filter((p) => {
        const text = `${p.node.title} ${p.node.description}`.toLowerCase();
        return text.includes(q);
      });
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
  }, [products, category, sort, search, searchParams]);

  const hasActiveFilters = category !== "all" || search || sort !== "relevance";

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        {/* Page header */}
        <div className="bg-primary/5 border-b border-border">
          <div className="container mx-auto py-8 md:py-12">
            <h1 className="font-display font-900 text-3xl md:text-4xl text-foreground">
              Catálogo
            </h1>
            <p className="text-muted-foreground mt-2">
              Encontre tudo que seu pet precisa
            </p>
          </div>
        </div>

        <div className="container mx-auto py-6 md:py-8">
          {/* Filters bar */}
          <div className="flex flex-col gap-4 mb-6">
            {/* Desktop filters */}
            <div className="hidden md:flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Input
                  placeholder="Buscar produtos..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                  className="rounded-full pr-10"
                />
              </div>

              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-[180px] rounded-full">
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-[160px] rounded-full">
                  <SelectValue placeholder="Ordenar" />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button onClick={applyFilters} className="rounded-full">
                Buscar
              </Button>

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
              <Button size="sm" onClick={applyFilters} className="rounded-full shrink-0">
                Buscar
              </Button>
            </div>

            {/* Mobile filters panel */}
            {showFilters && (
              <div className="md:hidden flex flex-col gap-3 p-4 rounded-xl bg-muted/50 border border-border animate-fade-in-up">
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger className="rounded-full">
                    <SelectValue placeholder="Categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="rounded-full">
                    <SelectValue placeholder="Ordenar" />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
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

            {/* Category pills */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCategory(c.value)}
                  className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    category === c.value
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Results count */}
          {!loading && (
            <p className="text-sm text-muted-foreground mb-4">
              {filteredProducts.length} produto{filteredProducts.length !== 1 ? "s" : ""} encontrado{filteredProducts.length !== 1 ? "s" : ""}
            </p>
          )}

          {/* Product grid */}
          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <PackageOpen className="h-16 w-16 text-muted-foreground mb-4" />
              <h3 className="font-display font-bold text-xl mb-2">Nenhum produto encontrado</h3>
              <p className="text-muted-foreground max-w-md">
                Tente ajustar os filtros ou buscar por outro termo.
              </p>
              {hasActiveFilters && (
                <Button variant="outline" className="mt-4" onClick={clearFilters}>
                  Limpar filtros
                </Button>
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
