import { Fragment, useEffect, useState, useMemo, useRef, type ReactElement } from "react";
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
import { STANDARD_ATTR_KEYS } from "@/lib/productAttributes";
import { useProductAudience } from "@/hooks/useProductAudience";
import { useIsFranchisee } from "@/hooks/useIsFranchisee";
import { useProductVariations } from "@/hooks/useProductVariations";
import {
  buildSearchVocabulary,
  productSearchFields,
  searchProducts,
  suggestSearchCorrection,
  type SearchField,
} from "@/lib/productSearch";
import { isProductAvailable, selectVariationRepresentative } from "@/lib/productAvailability";
import { useClientSaleVisibility } from "@/hooks/useClientSaleVisibility";
import { isClientProductVisible } from "@/lib/clientSaleVisibility";
import {
  fetchProductAttributeRows,
  fetchProductBrandRows,
  fetchProductCategoryRows,
  fetchStoreBrands,
  fetchStoreCategories,
  type ProductAttributeRow,
  type ProductBrandRow,
  type ProductCategoryRow,
  type StoreBrand,
  type StoreCategory,
} from "@/lib/catalogData";
import {
  HIDDEN_ATTR_KEYS,
  PRICE_RANGES,
  buildCatalogParams,
  buildCategoryIndex,
  catalogCategoryHref,
  categoryDescendants,
  categoryPath,
  computeCatalogFacets,
  parseCatalogParams,
  resolveCategory,
  type CatalogFilterState,
  type FacetProduct,
  type SortKey,
} from "@/lib/catalogFilters";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "relevance", label: "Mais relevantes" },
  { value: "price-asc", label: "Menor preço" },
  { value: "price-desc", label: "Maior preço" },
  { value: "name-asc", label: "A - Z" },
  { value: "name-desc", label: "Z - A" },
];

const PRODUCTS_PER_PAGE = 24;

const productPrice = (p: ShopifyProduct) => parseFloat(p.node.priceRange.minVariantPrice.amount);

const cloneFilters = (state: CatalogFilterState): CatalogFilterState => ({
  ...state,
  brandSlugs: new Set(state.brandSlugs),
  priceKeys: new Set(state.priceKeys),
  attrs: Object.fromEntries(Object.entries(state.attrs).map(([key, values]) => [key, new Set(values)])),
});

const toggleInSet = <T,>(set: Set<T>, item: T) => {
  if (set.has(item)) set.delete(item); else set.add(item);
};

const CheckRow = ({ checked, onChange, label, count }: { checked: boolean; onChange: () => void; label: string; count?: number }) => (
  <label className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 -mx-2 cursor-pointer text-sm transition-colors hover:bg-muted hover:text-primary">
    <Checkbox checked={checked} onCheckedChange={onChange} />
    <span className="min-w-0 flex-1 break-words leading-snug">{label}</span>
    {count !== undefined && <span className="shrink-0 text-muted-foreground text-xs">({count})</span>}
  </label>
);

const Catalog = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  // A URL e a fonte da verdade dos filtros; o React so guarda o texto ainda nao enviado da busca.
  const filters = useMemo(() => parseCatalogParams(searchParams), [searchParams]);
  const [searchInput, setSearchInput] = useState(filters.search);
  useEffect(() => setSearchInput(filters.search), [filters.search]);

  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [bestSellingProducts, setBestSellingProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const resultsTopRef = useRef<HTMLDivElement>(null);

  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [brands, setBrands] = useState<StoreBrand[]>([]);
  const [productCats, setProductCats] = useState<ProductCategoryRow[]>([]);
  const [productBrands, setProductBrands] = useState<ProductBrandRow[]>([]);
  const [productAttrs, setProductAttrs] = useState<ProductAttributeRow[]>([]);
  const { isVisibleTo, loading: audienceLoading } = useProductAudience();
  const { isFranchisee, loading: franchiseeLoading } = useIsFranchisee();
  const { blockedVariantIds, loading: saleVisibilityLoading } = useClientSaleVisibility();
  const {
    getVariations,
    getVariationGroupName,
    loading: variationsLoading,
  } = useProductVariations();
  const catalogLoading = loading || audienceLoading || franchiseeLoading || variationsLoading || saleVisibilityLoading;

  useEffect(() => {
    let active = true;
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [shop, bestSelling, cats, brs, pc, pb, pa] = await Promise.all([
          fetchAllShopifyProducts(),
          cachedStorefrontApiRequest(BEST_SELLING_PRODUCTS_QUERY, { first: 100 }),
          fetchStoreCategories(),
          fetchStoreBrands(),
          fetchProductCategoryRows(),
          fetchProductBrandRows(),
          fetchProductAttributeRows(),
        ]);
        if (!active) return;
        setProducts(shop);
        setBestSellingProducts(bestSelling?.data?.products?.edges || []);
        setCategories(cats);
        setBrands(brs);
        setProductCats(pc);
        setProductBrands(pb);
        setProductAttrs(pa);
      } catch (error) {
        console.error("Failed to fetch products:", error);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchAll();
    return () => {
      active = false;
    };
  }, []);

  /**
   * Toda mudanca de filtro passa por aqui e vira URL. Refinar volta para a
   * pagina 1; trocar de categoria, buscar e paginar entram no historico (o
   * "voltar" desfaz), marcar caixinhas e ordenar so substituem a entrada.
   */
  const updateFilters = (
    change: (draft: CatalogFilterState) => void,
    { resetPage = true, replace = true }: { resetPage?: boolean; replace?: boolean } = {},
  ) => {
    const draft = cloneFilters(filters);
    change(draft);
    if (resetPage) draft.page = 1;
    setSearchParams(buildCatalogParams(draft), { replace });
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearchParams({});
  };

  const categoryIndex = useMemo(() => buildCategoryIndex(categories), [categories]);
  const parentOf = useMemo(
    () => new Map(categories.map((category) => [category.id, category.parent_id])),
    [categories],
  );
  const hasCategoryParam = Boolean(filters.categorySlug || filters.categoryId);
  const selectedCat = useMemo(
    () => resolveCategory(categories, filters.categorySlug, filters.categoryId),
    [categories, filters.categorySlug, filters.categoryId],
  );
  const selectedPath = useMemo(
    () => (selectedCat ? categoryPath(categoryIndex, selectedCat.id) : []),
    [categoryIndex, selectedCat],
  );
  const selectCategory = (category: StoreCategory | null) =>
    updateFilters((draft) => {
      draft.categorySlug = category?.slug || null;
      draft.categoryId = category?.id || null;
    }, { replace: false });

  const productById = useMemo(() => new Map(products.map((p) => [p.node.id, p])), [products]);
  const audienceVisibleProducts = useMemo(() => {
    if (audienceLoading || franchiseeLoading || variationsLoading) return [];
    const visible = products.filter((product) => isVisibleTo(product.node.id, isFranchisee)
      && isClientProductVisible(product, blockedVariantIds, isFranchisee));
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
    blockedVariantIds,
  ]);
  const hasSearch = filters.search.length > 0;
  const discoverableProducts = useMemo(
    () => hasSearch
      ? audienceVisibleProducts
      : audienceVisibleProducts.filter(isProductAvailable),
    [audienceVisibleProducts, hasSearch],
  );

  // Campos da busca por produto: os mesmos da barra do topo, mais as categorias e as
  // variacoes visiveis, que so o catalogo carrega.
  const searchFieldsById = useMemo(() => {
    const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));
    const categoryNames = new Map<string, string[]>();
    for (const row of productCats) {
      const name = categoryNameById.get(row.category_id);
      if (!name) continue;
      if (!categoryNames.has(row.shopify_product_id)) categoryNames.set(row.shopify_product_id, []);
      categoryNames.get(row.shopify_product_id)!.push(name);
    }
    return new Map<string, SearchField[]>(discoverableProducts.map((p) => [p.node.id, productSearchFields({
      title: p.node.title,
      vendor: p.node.vendor,
      productType: p.node.productType,
      tags: p.node.tags,
      description: p.node.description,
      categoryNames: categoryNames.get(p.node.id),
      variationGroupName: getVariationGroupName(p.node.id),
      variationTexts: getVariations(p.node.id)
        .filter((item) => isVisibleTo(item.shopify_product_id, isFranchisee))
        .flatMap((item) => [item.label, item.shopify_product_title]),
    })]));
  }, [discoverableProducts, categories, productCats, getVariationGroupName, getVariations, isVisibleTo, isFranchisee]);

  // Toda palavra digitada precisa casar; define o universo sobre o qual os filtros contam.
  // Na relevancia, o que esta em estoque vem antes do esgotado, mantendo a ordem da busca.
  const searchedProducts = useMemo(() => {
    if (!hasSearch) return discoverableProducts;
    const ranked = searchProducts(filters.search, discoverableProducts, (p) => searchFieldsById.get(p.node.id) || []);
    return [...ranked.filter(isProductAvailable), ...ranked.filter((p) => !isProductAvailable(p))];
  }, [discoverableProducts, hasSearch, filters.search, searchFieldsById]);

  const searchSuggestion = useMemo(() => {
    if (!hasSearch || searchedProducts.length > 0) return null;
    return suggestSearchCorrection(filters.search, buildSearchVocabulary(searchFieldsById.values()));
  }, [hasSearch, searchedProducts.length, filters.search, searchFieldsById]);

  const facetProducts = useMemo<FacetProduct[]>(() => {
    const catsByProduct = new Map<string, Set<string>>();
    for (const row of productCats) {
      if (!catsByProduct.has(row.shopify_product_id)) catsByProduct.set(row.shopify_product_id, new Set());
      catsByProduct.get(row.shopify_product_id)!.add(row.category_id);
    }
    const brandByProduct = new Map<string, string>();
    for (const row of productBrands) if (row.brand_id) brandByProduct.set(row.shopify_product_id, row.brand_id);
    const attrsByProduct = new Map<string, Map<string, Set<string>>>();
    for (const row of productAttrs) {
      if (!attrsByProduct.has(row.shopify_product_id)) attrsByProduct.set(row.shopify_product_id, new Map());
      const attrs = attrsByProduct.get(row.shopify_product_id)!;
      if (!attrs.has(row.attr_key)) attrs.set(row.attr_key, new Set());
      attrs.get(row.attr_key)!.add(row.attr_value);
    }
    return searchedProducts.map((product) => ({
      id: product.node.id,
      price: productPrice(product),
      brandId: brandByProduct.get(product.node.id) || null,
      categoryIds: catsByProduct.get(product.node.id) || new Set(),
      attrs: attrsByProduct.get(product.node.id) || new Map(),
    }));
  }, [searchedProducts, productCats, productBrands, productAttrs]);

  const brandBySlug = useMemo(() => new Map(brands.map((brand) => [brand.slug, brand])), [brands]);

  const facets = useMemo(() => {
    const brandIds = new Set<string>();
    filters.brandSlugs.forEach((slug) => {
      const brand = brandBySlug.get(slug);
      // Marca desconhecida na URL nao pode virar "sem filtro": nada casa com ela.
      brandIds.add(brand?.id || `missing:${slug}`);
    });
    return computeCatalogFacets(
      facetProducts,
      {
        // Categoria inexistente na URL mostra zero produtos em vez da loja inteira com o titulo errado.
        categoryIds: selectedCat
          ? categoryDescendants(categoryIndex, selectedCat.id)
          : hasCategoryParam ? new Set() : null,
        brandIds,
        priceKeys: filters.priceKeys,
        attrs: filters.attrs,
      },
      parentOf,
    );
  }, [facetProducts, filters, brandBySlug, selectedCat, categoryIndex, hasCategoryParam, parentOf]);

  const filteredProducts = useMemo(() => {
    const result = searchedProducts.filter((product) => facets.matchingIds.has(product.node.id));
    const { sort } = filters;
    if (sort === "price-asc") result.sort((a, b) => productPrice(a) - productPrice(b));
    else if (sort === "price-desc") result.sort((a, b) => productPrice(b) - productPrice(a));
    else if (sort === "name-asc") result.sort((a, b) => a.node.title.localeCompare(b.node.title));
    else if (sort === "name-desc") result.sort((a, b) => b.node.title.localeCompare(a.node.title));
    return result;
  }, [searchedProducts, facets, filters]);

  const visibleBrands = useMemo(
    () => brands.filter((brand) => (facets.brandCounts.get(brand.id) || 0) > 0 || filters.brandSlugs.has(brand.slug)),
    [brands, facets, filters.brandSlugs],
  );

  // Atributos padrao primeiro (na ordem do admin), depois os livres em ordem alfabetica.
  const attrGroups = useMemo(() => {
    const keys = new Set([...facets.attrCounts.keys(), ...Object.keys(filters.attrs)]);
    const standard = (STANDARD_ATTR_KEYS as readonly string[]).filter((key) => keys.has(key));
    const custom = [...keys].filter((key) => !standard.includes(key)).sort((a, b) => a.localeCompare(b, "pt-BR"));
    return [...standard, ...custom]
      .filter((key) => !HIDDEN_ATTR_KEYS.has(key))
      .map((key) => {
        const counts = facets.attrCounts.get(key) || new Map<string, number>();
        const values = new Set([...counts.keys(), ...(filters.attrs[key] || [])]);
        return {
          key,
          values: [...values]
            .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }))
            .map((value) => ({ value, count: counts.get(value) || 0 })),
        };
      })
      .filter((group) => group.values.length > 0);
  }, [facets, filters.attrs]);

  const visiblePriceRanges = PRICE_RANGES.filter((range) =>
    (facets.priceCounts.get(range.key) || 0) > 0 || filters.priceKeys.has(range.key));

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE));
  const currentPage = Math.min(filters.page, totalPages);
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

  const scrollToResults = () =>
    requestAnimationFrame(() => resultsTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

  const changePage = (page: number) => {
    const nextPage = Math.min(Math.max(page, 1), totalPages);
    if (nextPage === currentPage) return;
    updateFilters((draft) => { draft.page = nextPage; }, { resetPage: false, replace: false });
    scrollToResults();
  };

  const totalAttrSelected = Object.values(filters.attrs).reduce((n, s) => n + s.size, 0);
  const hasRefinementFilters =
    filters.brandSlugs.size > 0 || totalAttrSelected > 0 || hasSearch || filters.priceKeys.size > 0;
  const hasActiveFilters = hasCategoryParam || hasRefinementFilters || filters.sort !== "relevance";

  const categoryLabel = selectedCat?.name || filters.categorySlug || "";
  const pageTitle = hasCategoryParam ? categoryLabel : "Catálogo";
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
  if (hasCategoryParam) {
    activeChips.push({
      key: `cat-${selectedCat?.id || filters.categorySlug}`,
      label: selectedPath.length > 1 ? selectedPath.map((category) => category.name).join(" › ") : categoryLabel,
      onRemove: () => selectCategory(null),
    });
  }
  filters.brandSlugs.forEach((slug) => {
    activeChips.push({
      key: `brand-${slug}`,
      label: brandBySlug.get(slug)?.name || slug,
      onRemove: () => updateFilters((draft) => toggleInSet(draft.brandSlugs, slug)),
    });
  });
  Object.entries(filters.attrs).forEach(([key, values]) => {
    values.forEach((value) => {
      activeChips.push({
        key: `attr-${key}-${value}`,
        label: `${key}: ${value}`,
        onRemove: () => updateFilters((draft) => toggleAttr(draft, key, value)),
      });
    });
  });
  PRICE_RANGES.filter((range) => filters.priceKeys.has(range.key)).forEach((range) => {
    activeChips.push({
      key: `price-${range.key}`,
      label: range.label,
      onRemove: () => updateFilters((draft) => toggleInSet(draft.priceKeys, range.key)),
    });
  });
  if (hasSearch) {
    activeChips.push({
      key: "search",
      label: `Busca: "${filters.search}"`,
      onRemove: () => updateFilters((draft) => { draft.search = ""; }, { replace: false }),
    });
  }

  function toggleAttr(draft: CatalogFilterState, key: string, value: string) {
    const values = draft.attrs[key] || new Set<string>();
    toggleInSet(values, value);
    if (values.size === 0) delete draft.attrs[key]; else draft.attrs[key] = values;
  }

  // Arvore: raizes sempre; abaixo delas so o ramo da categoria escolhida fica aberto.
  // Sem categoria escolhida, cada pet ja mostra o primeiro nivel (Ração, Farmácia...).
  const selectedPathIds = new Set(selectedPath.map((category) => category.id));
  const renderCategoryNodes = (parentId: string | null, depth: number): ReactElement[] =>
    (categoryIndex.childrenOf.get(parentId) || [])
      .filter((category) => (facets.categoryCounts.get(category.id) || 0) > 0 || selectedPathIds.has(category.id))
      .map((category) => {
        const isSelected = selectedCat?.id === category.id;
        const expanded = selectedPathIds.has(category.id) || (depth === 0 && !selectedCat);
        return (
          <Fragment key={category.id}>
            <button
              type="button"
              onClick={() => {
                // Clicar na categoria ja escolhida sobe um nivel.
                if (!isSelected) selectCategory(category);
                else selectCategory(category.parent_id ? categoryIndex.byId.get(category.parent_id) || null : null);
              }}
              aria-current={isSelected ? "true" : undefined}
              style={{ paddingLeft: `${depth * 0.875 + 0.5}rem` }}
              className={`-mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-sm transition-colors hover:bg-muted hover:text-primary ${
                isSelected ? "bg-primary/10 font-bold text-primary" : depth === 0 ? "font-semibold" : ""
              }`}
            >
              <span className="min-w-0 flex-1 break-words leading-snug">{category.name}</span>
              <span className="shrink-0 text-xs font-normal text-muted-foreground">
                ({facets.categoryCounts.get(category.id) || 0})
              </span>
            </button>
            {expanded && renderCategoryNodes(category.id, depth + 1)}
          </Fragment>
        );
      });

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
            updateFilters((draft) => { draft.search = searchInput.trim(); }, { replace: false });
          }}
        >
          <Input
            type="search"
            enterKeyHint="search"
            placeholder="Buscar..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="rounded-full"
          />
          <Button type="submit" size="sm" className="shrink-0 rounded-full">Pesquisar</Button>
        </form>
      </div>

      <Accordion
        // So remonta quando tudo carregou: antes disso os grupos de atributo ainda
        // nao existem e nasceriam fechados.
        key={catalogLoading ? "loading" : "loaded"}
        type="multiple"
        defaultValue={
          compact ? ["categoria"] : ["categoria", "preco", "marca", ...attrGroups.map((group) => group.key)]
        }
        className="border-0"
      >
        <AccordionItem value="categoria" className="border-b border-border last:border-0">
          <AccordionTrigger className="font-display font-bold text-sm">Categoria</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-0.5 overflow-x-hidden px-2">
              {hasCategoryParam && (
                <button
                  type="button"
                  onClick={() => selectCategory(null)}
                  className="-mx-2 mb-1 flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:text-primary"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Todas as categorias
                </button>
              )}
              {renderCategoryNodes(null, 0)}
              {!loading && facets.categoryCounts.size === 0 && (
                <p className="text-xs text-muted-foreground py-2">Nenhuma categoria.</p>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="preco" className="border-b border-border last:border-0">
          <AccordionTrigger className="font-display font-bold text-sm">Faixa de Preço</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-0.5">
              {visiblePriceRanges.map((range) => (
                <CheckRow
                  key={range.key}
                  checked={filters.priceKeys.has(range.key)}
                  onChange={() => updateFilters((draft) => toggleInSet(draft.priceKeys, range.key))}
                  label={range.label}
                  count={facets.priceCounts.get(range.key) || 0}
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
                  checked={filters.brandSlugs.has(b.slug)}
                  onChange={() => updateFilters((draft) => toggleInSet(draft.brandSlugs, b.slug))}
                  label={b.name}
                  count={facets.brandCounts.get(b.id) || 0}
                />
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        {attrGroups.map(({ key, values }) => {
          const selected = filters.attrs[key] || new Set<string>();
          return (
            <AccordionItem key={key} value={key} className="border-b border-border last:border-0">
              <AccordionTrigger className="font-display font-bold text-sm">{key}</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-0.5 overflow-x-hidden">
                  {values.map(({ value, count }) => (
                    <CheckRow
                      key={value}
                      checked={selected.has(value)}
                      onChange={() => updateFilters((draft) => toggleAttr(draft, key, value))}
                      label={value}
                      count={count}
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
                  {hasCategoryParam ? (
                    <BreadcrumbLink asChild>
                      <Link to="/catalogo">Catálogo</Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage>Catálogo</BreadcrumbPage>
                  )}
                </BreadcrumbItem>
                {hasCategoryParam && (selectedPath.length ? selectedPath : [null]).map((category, index, path) => (
                  <Fragment key={category?.id || "unknown"}>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      {category && index < path.length - 1 ? (
                        <BreadcrumbLink asChild>
                          <Link to={catalogCategoryHref(category)}>{category.name}</Link>
                        </BreadcrumbLink>
                      ) : (
                        <BreadcrumbPage>{category?.name || categoryLabel}</BreadcrumbPage>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                ))}
              </BreadcrumbList>
            </Breadcrumb>
            <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <h1 className="font-display font-900 text-3xl text-foreground">{pageTitle}</h1>
              <div className="flex items-center gap-4 self-start md:self-auto">
                <span className="hidden text-sm font-bold text-foreground sm:inline">Ordenar por:</span>
                <Select
                  value={filters.sort}
                  onValueChange={(value) => updateFilters((draft) => { draft.sort = value as SortKey; })}
                >
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
                <button
                  type="button"
                  onClick={scrollToResults}
                  className="hidden h-12 w-12 items-center justify-center rounded-full border border-border text-foreground shadow-sm transition hover:border-primary hover:text-primary md:flex"
                  aria-label="Ver todos os produtos"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-6">
                {shelfProducts.map((product) => (
                  <ProductCard
                    key={`shelf-${product.node.id}`}
                    product={product}
                    products={products}
                    searchQuery={filters.search}
                  />
                ))}
              </div>
            </section>
          )}

          <div className="grid lg:grid-cols-[240px_1fr] gap-8">
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
                  <h3 className="font-display font-bold text-xl mb-2">
                    {hasSearch ? `Nenhum resultado para "${filters.search}"` : "Nenhum produto encontrado"}
                  </h3>
                  {searchSuggestion ? (
                    <p className="text-muted-foreground max-w-md">
                      Você quis dizer{" "}
                      <button
                        type="button"
                        className="font-semibold text-primary hover:underline"
                        onClick={() => updateFilters((draft) => { draft.search = searchSuggestion; }, { replace: false })}
                      >
                        {searchSuggestion}
                      </button>
                      ?
                    </p>
                  ) : hasSearch && searchedProducts.length > 0 ? (
                    // A busca acha produtos, mas os filtros marcados escondem todos.
                    <p className="text-muted-foreground max-w-md">
                      A busca encontrou {searchedProducts.length} {searchedProducts.length === 1 ? "produto" : "produtos"}, mas nenhum passa pelos filtros marcados.{" "}
                      <button
                        type="button"
                        className="font-semibold text-primary hover:underline"
                        onClick={() => setSearchParams(buildCatalogParams({ ...parseCatalogParams(new URLSearchParams()), search: filters.search }))}
                      >
                        Ver todos
                      </button>
                    </p>
                  ) : (
                    <p className="text-muted-foreground max-w-md">
                      {hasSearch
                        ? "Confira a ortografia ou use menos palavras, como o nome da marca ou do produto."
                        : "Tente ajustar os filtros."}
                    </p>
                  )}
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
                      searchQuery={filters.search}
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
