import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ProductCard } from "@/components/ProductCard";
import { ProductCardSkeleton } from "@/components/ProductCardSkeleton";
import { ShopifyProduct, cachedStorefrontApiRequest, BEST_SELLING_PRODUCTS_QUERY, fetchAllShopifyProducts } from "@/lib/shopify";
import { ChevronLeft, ChevronRight, MoreHorizontal, PackageOpen, SlidersHorizontal, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { supabase } from "@/integrations/supabase/client";
import { STANDARD_ATTR_KEYS } from "@/lib/productAttributes";
import { useProductAudience } from "@/hooks/useProductAudience";
import { useIsFranchisee } from "@/hooks/useIsFranchisee";
import { useProductVariations } from "@/hooks/useProductVariations";
import { fuzzySearch } from "@/lib/fuzzySearch";
import { isProductAvailable, selectVariationRepresentative } from "@/lib/productAvailability";
import { categoriesWithLinkedProducts } from "@/lib/categoryAvailability";

const SORT_OPTIONS = [
  { value: "relevance", label: "Mais relevantes" },
  { value: "price-asc", label: "Menor preco" },
  { value: "price-desc", label: "Maior preco" },
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

const PRODUCTS_PER_PAGE = 24;

const normalizeSlug = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

interface Category { id: string; name: string; slug: string; parent_id: string | null; sort_order: number; }
interface Brand { id: string; name: string; slug: string; }
const Catalog = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSearch = searchParams.get("busca") || "";
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [bestSellingProducts, setBestSellingProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get("busca") || "");
  const [categorySlug, setCategorySlug] = useState(searchParams.get("categoria") || "all");
  const [categoryId, setCategoryId] = useState<string | null>(searchParams.get("categoria_id"));
  // multi-select brand slugs and attribute values
  const [brandSlugs, setBrandSlugs] = useState<Set<string>>(new Set());
  const [attrValues, setAttrValues] = useState<Record<string, Set<string>>>({});
  const [priceRangeIdxs, setPriceRangeIdxs] = useState<Set<number>>(new Set());
  const [sort, setSort] = useState("relevance");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const resultsTopRef = useRef<HTMLDivElement>(null);
  const paginationInitializedRef = useRef(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [productCats, setProductCats] = useState<{ shopify_product_id: string; category_id: string }[]>([]);
  const [productBrands, setProductBrands] = useState<{ shopify_product_id: string; brand_id: string | null }[]>([]);
  const [productAttrs, setProductAttrs] = useState<{ shopify_product_id: string; attr_key: string; attr_value: string }[]>([]);
  const { isVisibleTo, loading: audienceLoading } = useProductAudience();
  const { isFranchisee, loading: franchiseeLoading } = useIsFranchisee();
  const {
    getVariations,
    getVariationGroupName,
    loading: variationsLoading,
  } = useProductVariations();
  const catalogLoading = loading || audienceLoading || franchiseeLoading || variationsLoading;

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [shop, bestSelling, cats, brs, pc, pcontent, pa] = await Promise.all([
          fetchAllShopifyProducts(),
          cachedStorefrontApiRequest(BEST_SELLING_PRODUCTS_QUERY, { first: 100 }),
          supabase.from("categories").select("*").order("sort_order").order("name"),
          supabase.from("brands").select("*").order("name"),
          supabase.from("product_categories").select("shopify_product_id, category_id"),
          supabase.from("product_content").select("shopify_product_id, brand_id"),
          supabase.from("product_attributes").select("shopify_product_id, attr_key, attr_value"),
        ]);
        setProducts(shop);
        setBestSellingProducts(bestSelling?.data?.products?.edges || []);
        setCategories(categoriesWithLinkedProducts(
          (cats.data || []) as Category[],
          pc.data || [],
          new Set(shop.map((product) => product.node.id)),
        ));
        setBrands((brs.data || []) as Brand[]);
        setProductCats(pc.data || []);
        setProductBrands(pcontent.data || []);
        setProductAttrs(pa.data || []);
      } catch (error) {
        console.error("Failed to fetch products:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  useEffect(() => {
    const category = searchParams.get("categoria");
    const categoryParamId = searchParams.get("categoria_id");
    const pet = searchParams.get("pet");

    if (category) {
      const matchingCategory =
        (categoryParamId && categories.find((c) => c.id === categoryParamId)) ||
        categories.find((c) => c.slug === category);
      setCategorySlug(matchingCategory?.slug || category);
      setCategoryId(matchingCategory?.id || categoryParamId);
    } else if (pet) {
      const petSlug = normalizeSlug(pet);
      const matchingCategory = categories.find((c) => normalizeSlug(c.slug) === petSlug || normalizeSlug(c.name) === petSlug);
      setCategorySlug(matchingCategory?.slug || petSlug);
      setCategoryId(matchingCategory?.id || null);
    } else {
      setCategorySlug("all");
      setCategoryId(null);
    }

    setAttrValues((prev) => {
      if (!prev.Pet) return prev;
      const next = { ...prev };
      delete next.Pet;
      return next;
    });
  }, [searchParams, categories]);

  const applySearch = () => {
    const params: Record<string, string> = {};
    if (search) params.busca = search;
    if (categorySlug !== "all") params.categoria = categorySlug;
    if (categoryId) params.categoria_id = categoryId;
    setSearchParams(params);
  };

  const clearFilters = () => {
    setSearch("");
    setCategorySlug("all");
    setCategoryId(null);
    setBrandSlugs(new Set());
    setAttrValues({});
    setPriceRangeIdxs(new Set());
    setSort("relevance");
    setSearchParams({});
  };

  const selectedCat = useMemo(
    () => categories.find((c) => c.id === categoryId) || categories.find((c) => c.slug === categorySlug),
    [categories, categoryId, categorySlug],
  );
  const expandCategoryIds = useCallback((rootId: string): Set<string> => {
    const ids = new Set<string>([rootId]);
    let frontier = [rootId];
    while (frontier.length) {
      const next: string[] = [];
      for (const id of frontier) for (const c of categories) if (c.parent_id === id && !ids.has(c.id)) { ids.add(c.id); next.push(c.id); }
      frontier = next;
    }
    return ids;
  }, [categories]);

  const petCategories = useMemo(
    () => categories.filter((category) =>
      category.parent_id === null && ["cachorro", "gato"].includes(normalizeSlug(category.slug)),
    ),
    [categories],
  );

  const selectPetCategory = (category: Category) => {
    const isSelected = categoryId === category.id;
    setCategorySlug(isSelected ? "all" : category.slug);
    setCategoryId(isSelected ? null : category.id);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("pet");
      next.delete("categoria");
      next.delete("categoria_id");
      if (!isSelected) {
        next.set("categoria", category.slug);
        next.set("categoria_id", category.id);
      }
      return next;
    });
  };

  // Counts per filter — based on products that pass all OTHER filters
  // For simplicity & performance, counts are based on the unfiltered product set.
  const productPrice = (p: ShopifyProduct) => parseFloat(p.node.priceRange.minVariantPrice.amount);
  const productById = useMemo(() => new Map(products.map((p) => [p.node.id, p])), [products]);
  const audienceVisibleProducts = useMemo(() => {
    if (audienceLoading || franchiseeLoading || variationsLoading) return [];
    const visible = products.filter((product) => isVisibleTo(product.node.id, isFranchisee));
    const visibleIds = new Set(visible.map((product) => product.node.id));
    return visible.filter((product) => {
      const group = getVariations(product.node.id);
      const representativeId = selectVariationRepresentative(group, productById, visibleIds);
      return !representativeId || representativeId === product.node.id;
    });
  }, [
    products,
    isFranchisee,
    audienceLoading,
    franchiseeLoading,
    variationsLoading,
    getVariations,
    isVisibleTo,
    productById,
  ]);
  const hasRequestedSearch = requestedSearch.trim().length > 0;
  const discoverableProducts = useMemo(
    () => hasRequestedSearch
      ? audienceVisibleProducts
      : audienceVisibleProducts.filter(isProductAvailable),
    [audienceVisibleProducts, hasRequestedSearch],
  );
  const discoverableIds = useMemo(
    () => new Set(discoverableProducts.map((product) => product.node.id)),
    [discoverableProducts],
  );

  // Só valores realmente vinculados a produtos aparecem como filtros.
  const valuesByKey = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const a of productAttrs) {
      if (!discoverableIds.has(a.shopify_product_id)) continue;
      if (!map.has(a.attr_key)) map.set(a.attr_key, new Set());
      map.get(a.attr_key)!.add(a.attr_value);
    }
    return map;
  }, [discoverableIds, productAttrs]);

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
      for (const p of discoverableProducts) if (productBrandMap.get(p.node.id) === b.id) n++;
      m.set(b.slug, n);
    }
    return m;
  }, [brands, productBrands, discoverableProducts]);
  const visibleBrands = useMemo(
    () => brands.filter((brand) => (brandCount.get(brand.slug) || 0) > 0),
    [brands, brandCount],
  );

  const priceCount = useMemo(() => {
    return PRICE_RANGES.map((r) => discoverableProducts.filter((p) => {
      const price = productPrice(p);
      return price >= r.min && price <= r.max;
    }).length);
  }, [discoverableProducts]);

  const petCategoryCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const category of petCategories) {
      const allowed = expandCategoryIds(category.id);
      const productIds = new Set(
        productCats
          .filter((item) => allowed.has(item.category_id))
          .map((item) => item.shopify_product_id),
      );
      counts.set(
        category.id,
        discoverableProducts.filter((product) => productIds.has(product.node.id)).length,
      );
    }
    return counts;
  }, [discoverableProducts, expandCategoryIds, petCategories, productCats]);

  const attrCount = (key: string, value: string) =>
    productAttrs.filter(
      (a) =>
        discoverableIds.has(a.shopify_product_id) &&
        a.attr_key === key &&
        a.attr_value === value,
    ).length;

  const filteredProducts = useMemo(() => {
    let result = [...discoverableProducts];

    // busca tolerante a erros de digitacao
    const term = requestedSearch.trim();
    if (term) {
      result = fuzzySearch(term, result, (p) => [
        { value: p.node.title, weight: 1 },
        { value: getVariationGroupName(p.node.id) || "", weight: 1 },
        ...getVariations(p.node.id)
          .filter((item) => isVisibleTo(item.shopify_product_id, isFranchisee))
          .flatMap((item) => [
            { value: item.label, weight: 1 },
            { value: item.shopify_product_title, weight: 1 },
          ]),
        { value: p.node.vendor, weight: 0.9 },
        { value: p.node.productType, weight: 0.85 },
        { value: (p.node.tags || []).join(" "), weight: 0.8 },
        { value: p.node.description?.slice(0, 300), weight: 0.6 },
      ]);
    }


    if (categorySlug !== "all") {
      if (selectedCat) {
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
  }, [discoverableProducts, requestedSearch, categorySlug, brandSlugs, attrValues, priceRangeIdxs, sort, selectedCat, productCats, productBrands, productAttrs, brands, expandCategoryIds, getVariationGroupName, getVariations, isVisibleTo, isFranchisee]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE));
  const paginatedProducts = useMemo(
    () => filteredProducts.slice((currentPage - 1) * PRODUCTS_PER_PAGE, currentPage * PRODUCTS_PER_PAGE),
    [filteredProducts, currentPage],
  );
  const paginationItems = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
    const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
    if (currentPage <= 4) [2, 3, 4, 5].forEach((page) => pages.add(page));
    if (currentPage >= totalPages - 3) {
      [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1].forEach((page) => pages.add(page));
    }
    const ordered = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
    const items: Array<number | "ellipsis"> = [];
    ordered.forEach((page, index) => {
      if (index > 0 && page - ordered[index - 1] > 1) items.push("ellipsis");
      items.push(page);
    });
    return items;
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (!paginationInitializedRef.current) {
      paginationInitializedRef.current = true;
      return;
    }
    setCurrentPage(1);
  }, [requestedSearch, categorySlug, categoryId, brandSlugs, attrValues, priceRangeIdxs, sort]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const changePage = (page: number) => {
    const nextPage = Math.min(Math.max(page, 1), totalPages);
    if (nextPage === currentPage) return;
    setCurrentPage(nextPage);
    requestAnimationFrame(() => resultsTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const totalAttrSelected = Object.values(attrValues).reduce((n, s) => n + (s?.size || 0), 0);
  const hasRefinementFilters =
    brandSlugs.size > 0 || totalAttrSelected > 0 || search || priceRangeIdxs.size > 0;
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

  const categoryChipLabel = selectedCat?.name || categorySlug;
  const pageTitle = categorySlug === "all" ? "Catalogo" : categoryChipLabel;
  const shelfProducts = useMemo(() => {
    const filteredIds = new Set(filteredProducts.map((product) => product.node.id));
    const usedIds = new Set<string>();
    const productsForShelf: ShopifyProduct[] = [];

    for (const product of bestSellingProducts) {
      if (!filteredIds.has(product.node.id) || usedIds.has(product.node.id)) continue;
      productsForShelf.push(product);
      usedIds.add(product.node.id);
      if (productsForShelf.length === 6) return productsForShelf;
    }

    for (const product of filteredProducts) {
      if (usedIds.has(product.node.id)) continue;
      productsForShelf.push(product);
      usedIds.add(product.node.id);
      if (productsForShelf.length === 6) return productsForShelf;
    }

    return productsForShelf;
  }, [bestSellingProducts, filteredProducts]);

  const activeChips: { key: string; label: string; onRemove: () => void }[] = [];
  if (categorySlug !== "all") {
    activeChips.push({
      key: `cat-${categoryId || categorySlug}`,
      label: categoryChipLabel,
      onRemove: () => {
        setCategorySlug("all");
        setCategoryId(null);
      },
    });
  }
  brandSlugs.forEach((slug) => {
    const brand = brands.find((b) => b.slug === slug);
    activeChips.push({ key: `brand-${slug}`, label: brand?.name || slug, onRemove: () => toggleSetItem(setBrandSlugs, slug) });
  });
  Object.entries(attrValues).forEach(([key, values]) => {
    values.forEach((value) => {
      activeChips.push({ key: `attr-${key}-${value}`, label: `${key}: ${value}`, onRemove: () => toggleAttr(key, value) });
    });
  });
  priceRangeIdxs.forEach((idx) => {
    activeChips.push({ key: `price-${idx}`, label: PRICE_RANGES[idx].label, onRemove: () => toggleSetItem(setPriceRangeIdxs, idx) });
  });
  if (search) {
    activeChips.push({
      key: "search",
      label: `Busca: "${search}"`,
      onRemove: () => {
        setSearch("");
        setSearchParams(
          categorySlug !== "all"
            ? { categoria: categorySlug, ...(categoryId ? { categoria_id: categoryId } : {}) }
            : {},
        );
      },
    });
  }

  const CheckRow = ({ checked, onChange, label, count }: { checked: boolean; onChange: () => void; label: string; count?: number }) => (
    <label className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 cursor-pointer text-sm transition-colors hover:bg-muted hover:text-primary">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <span className="min-w-0 flex-1 break-words leading-snug">{label}</span>
      {count !== undefined && <span className="shrink-0 text-muted-foreground text-xs">({count})</span>}
    </label>
  );

  // Sidebar with all filters.
  // "compact" e a versao que vai dentro do sheet no mobile: as secoes nascem fechadas
  // para caber na tela, e o cabecalho interno some porque o sheet ja tem titulo e
  // botao de limpar proprios.
  const renderFilters = ({ compact = false }: { compact?: boolean } = {}) => (
    <aside className="space-y-6">
      {!compact && (
        <div className="border-b border-border pb-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display font-bold text-base">Filtrar Produtos</h3>
          </div>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="text-sm text-primary hover:underline flex items-center gap-1.5">
              Limpar filtros <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <div className="border-b border-border pb-5">
        <h3 className="font-display font-bold text-sm uppercase tracking-wide mb-3">Buscar</h3>
        <form
          className="flex gap-2"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            applySearch();
          }}
        >
          <Input
            type="search"
            enterKeyHint="search"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-full"
          />
          <Button type="submit" size="sm" className="shrink-0 rounded-full">Pesquisar</Button>
        </form>
      </div>

      <Accordion
        key={loading ? "loading" : "loaded"}
        type="multiple"
        defaultValue={
          compact ? [] : ["pet", "preco", "marca", ...STANDARD_ATTR_KEYS.filter((key) => key !== "Pet"), ...customKeys]
        }
        className="border-0"
      >
        <AccordionItem value="pet" className="border-b border-border last:border-0">
          <AccordionTrigger className="font-display font-bold text-sm">Pet</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-0.5">
              {petCategories.map((category) => (
                <CheckRow
                  key={category.id}
                  checked={categoryId === category.id}
                  onChange={() => selectPetCategory(category)}
                  label={category.name}
                  count={petCategoryCount.get(category.id)}
                />
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

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

        <AccordionItem value="marca" className="border-b border-border last:border-0">
          <AccordionTrigger className="font-display font-bold text-sm">Marca</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-0.5 overflow-x-hidden">
              {visibleBrands.length === 0 && <p className="text-xs text-muted-foreground py-2">Nenhuma marca.</p>}
              {visibleBrands.map((b) => (
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

        {STANDARD_ATTR_KEYS.filter((key) => key !== "Pet").map((key) => {
          const values = Array.from(valuesByKey.get(key) || []).sort();
          if (values.length === 0) return null;
          const selected = attrValues[key] || new Set<string>();
          return (
            <AccordionItem key={key} value={key} className="border-b border-border last:border-0">
              <AccordionTrigger className="font-display font-bold text-sm">{key}</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-0.5 overflow-x-hidden">
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
                <div className="space-y-0.5 overflow-x-hidden">
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
        <div className="border-b border-border bg-white">
          <div className="container mx-auto py-8 md:py-10">
            <Breadcrumb className="mb-6">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to="/">Início</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {categorySlug === "all" ? (
                    <BreadcrumbPage>Catálogo</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to="/catalogo">Catálogo</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
                {categorySlug !== "all" && (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{categoryChipLabel}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <h1 className="font-display font-900 text-3xl text-foreground">{pageTitle}</h1>
              <div className="flex items-center gap-4 self-start md:self-auto">
                <span className="hidden text-sm font-bold text-foreground sm:inline">Ordenar por:</span>
                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="h-12 w-[180px] rounded-lg border-[#9ca3af] bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <div className="container mx-auto py-8">
          {!catalogLoading && !hasRefinementFilters && shelfProducts.length > 0 && (
            <section className="mb-12 hidden md:block">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="font-display text-2xl font-bold">
                  Mais comprados em {pageTitle}
                </h2>
                <Link
                  to="/catalogo"
                  className="hidden h-12 w-12 items-center justify-center rounded-full border border-border text-foreground shadow-sm transition hover:border-primary hover:text-primary md:flex"
                  aria-label="Ver mais produtos"
                >
                  <ChevronRight className="h-6 w-6" />
                </Link>
              </div>
              <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-6">
                {shelfProducts.map((product) => (
                  <ProductCard
                    key={`shelf-${product.node.id}`}
                    product={product}
                    products={products}
                    searchQuery={requestedSearch}
                  />
                ))}
              </div>
            </section>
          )}

          <div className="grid lg:grid-cols-[220px_1fr] gap-8">
            <div className="hidden lg:block">{renderFilters()}</div>

            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="lg:hidden flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 font-display text-sm font-bold uppercase tracking-wide"
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" />
                Filtros
                {hasActiveFilters && (
                  <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">Ativos</span>
                )}
              </span>
              <span className="text-xs font-normal normal-case text-muted-foreground">
                {filteredProducts.length} produto{filteredProducts.length !== 1 ? "s" : ""}
              </span>
            </button>

            <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
              <SheetContent
                side="bottom"
                closeLabel="Fechar filtros"
                onClose={() => setFiltersOpen(false)}
                aria-describedby={undefined}
                // Sem isto o Radix foca o campo de busca ao abrir e o teclado do
                // celular sobe sozinho, cobrindo metade dos filtros.
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="flex h-[85vh] flex-col gap-0 rounded-t-2xl p-0 lg:hidden"
              >
                <div className="shrink-0 border-b border-border px-4 py-4">
                  <SheetTitle className="font-display text-base font-bold">Filtrar Produtos</SheetTitle>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
                  {renderFilters({ compact: true })}
                </div>

                {/* Os filtros ja aplicam em tempo real, entao "Ver N produtos" apenas fecha
                    o painel: o numero mostrado ja e o resultado que esta valendo atras dele. */}
                <div className="shrink-0 border-t border-border bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      onClick={clearFilters}
                      disabled={!hasActiveFilters}
                      className="shrink-0 rounded-full"
                    >
                      Limpar
                    </Button>
                    <Button onClick={() => setFiltersOpen(false)} className="flex-1 rounded-full">
                      Ver {filteredProducts.length} produto{filteredProducts.length !== 1 ? "s" : ""}
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>

            <div ref={resultsTopRef} className="scroll-mt-24">
              {activeChips.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  {activeChips.map((chip) => (
                    <button
                      key={chip.key}
                      onClick={chip.onRemove}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium pl-3 pr-2 py-1.5 hover:bg-primary/20 transition-colors"
                    >
                      {chip.label}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                  <button
                    onClick={clearFilters}
                    className="text-xs text-muted-foreground hover:text-destructive underline underline-offset-2"
                  >
                    Limpar tudo
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
                {!catalogLoading && (
                  <p className="text-sm text-muted-foreground">
                    {filteredProducts.length} produto{filteredProducts.length !== 1 ? "s" : ""} encontrado{filteredProducts.length !== 1 ? "s" : ""}
                  </p>
                )}
              </div>

              {catalogLoading ? (
                <div
                  className="grid grid-cols-2 gap-x-6 gap-y-12 md:grid-cols-3 xl:grid-cols-4"
                  aria-label="Carregando produtos"
                >
                  {Array.from({ length: 8 }).map((_, index) => (
                    <ProductCardSkeleton key={index} />
                  ))}
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
                <div className="grid grid-cols-2 gap-x-6 gap-y-12 md:grid-cols-3 xl:grid-cols-4">
                  {paginatedProducts.map((product) => (
                    <ProductCard
                      key={product.node.id}
                      product={product}
                      products={products}
                      searchQuery={requestedSearch}
                    />
                  ))}
                </div>
              )}

              {!catalogLoading && filteredProducts.length > 0 && totalPages > 1 && (
                <nav className="relative mt-14 flex min-h-10 items-center justify-center" aria-label="Paginação do catálogo">
                  <p className="hidden text-xs text-muted-foreground md:absolute md:left-0 md:block">
                    Página {currentPage} de {totalPages}
                  </p>
                  <div className="flex items-center justify-center gap-1 sm:gap-2">
                    <button
                      type="button"
                      onClick={() => changePage(currentPage - 1)}
                      disabled={currentPage === 1}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition hover:bg-muted disabled:pointer-events-none disabled:opacity-30"
                      aria-label="Página anterior"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    {paginationItems.map((item, index) => item === "ellipsis" ? (
                      <span key={`ellipsis-${index}`} className="flex h-9 w-7 items-center justify-center text-muted-foreground" aria-hidden="true">
                        <MoreHorizontal className="h-4 w-4" />
                      </span>
                    ) : (
                      <button
                        type="button"
                        key={item}
                        onClick={() => changePage(item)}
                        aria-label={`Ir para a página ${item}`}
                        aria-current={item === currentPage ? "page" : undefined}
                        className={`h-9 min-w-9 rounded-full px-2 text-sm transition ${
                          item === currentPage
                            ? "bg-slate-950 font-bold text-white"
                            : "text-foreground hover:bg-muted"
                        }`}
                      >
                        {item}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => changePage(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition hover:bg-muted disabled:pointer-events-none disabled:opacity-30"
                      aria-label="Próxima página"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="absolute -bottom-5 text-xs text-muted-foreground md:hidden">
                    Página {currentPage} de {totalPages}
                  </p>
                </nav>
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
