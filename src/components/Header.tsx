import { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Loader2, Menu, MessageCircle, Package, Search, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CartDrawer } from "@/components/CartDrawer";
import { MegaMenu, type MegaMenuItem } from "@/components/MegaMenu";
import { MobileCategoryNav } from "@/components/MobileCategoryNav";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategoryTree } from "@/hooks/useCategoryTree";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { searchShopifyProducts, fetchAllShopifyProducts, type ShopifyProduct } from "@/lib/shopify";
import { fuzzySearch } from "@/lib/fuzzySearch";
import { isAudienceVisibleTo, useProductAudience } from "@/hooks/useProductAudience";
import { useIsFranchisee } from "@/hooks/useIsFranchisee";
import { useSubscriberPrices } from "@/hooks/useSubscriberPrices";
import { useCustomerPrices } from "@/hooks/useCustomerPrices";
import { isProductAvailable } from "@/lib/productAvailability";
import logo from "@/assets/tpp-logo.svg";

const WHATSAPP_URL = "https://wa.me/5518996642021";
const formatPrice = (amount: string) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(amount));

const buildSearchSuggestions = (term: string, products: ShopifyProduct[]) => {
  const base = term.trim().toLocaleLowerCase("pt-BR");
  const priorityWords = [
    "gato", "gatos", "cão", "cães", "cachorro", "cachorros",
    "filhote", "filhotes", "adulto", "adultos",
  ];
  const productWords = products.flatMap((product) =>
    product.node.title.toLocaleLowerCase("pt-BR").match(/[\p{L}\p{N}]+/gu) || [],
  );
  const suggestions = [base];
  const fallbackWords = productWords.filter(
    (word) => word.length >= 4 && !["para", "ração", "rações", "adultos"].includes(word),
  );

  for (const word of [
    ...priorityWords.filter((item) => productWords.includes(item)),
    ...fallbackWords,
  ]) {
    if (base.includes(word) || suggestions.some((item) => item.endsWith(` ${word}`))) continue;
    suggestions.push(`${base} ${word}`);
    if (suggestions.length === 3) break;
  }

  return suggestions;
};

export const Header = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ShopifyProduct[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchPreviewOpen, setSearchPreviewOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const { user } = useAuth();
  const { rows: audienceRows, loading: audienceLoading } = useProductAudience();
  const { isFranchisee, loading: franchiseeLoading } = useIsFranchisee();
  const { getSubscriberPrice, loading: subscriberPricesLoading } = useSubscriberPrices();
  const { getCustomerPrice } = useCustomerPrices();
  const navigate = useNavigate();
  const location = useLocation();
  const { rootCats, childrenOf, loading: categoriesLoading } = useCategoryTree();
  const audienceMap = useMemo(
    () => new Map(audienceRows.map((row) => [row.shopify_product_id, row.audience])),
    [audienceRows],
  );

  const navItems: MegaMenuItem[] = useMemo(
    () => [
      ...rootCats.map((c) => ({ id: c.id, slug: c.slug, label: c.name })),
    ],
    [rootCats],
  );

  const isCategoryActive = (slug: string) => {
    if (location.pathname !== "/catalogo") return false;
    return new URLSearchParams(location.search).get("categoria") === slug;
  };
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y > lastY && y > 120) setHidden(true);
      else setHidden(false);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const term = search.trim();
    if (term.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchPreviewOpen(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    setSearchPreviewOpen(true);

    const timer = window.setTimeout(async () => {
      try {
        let products = await searchShopifyProducts(term, 10);
        if (products.length === 0) {
          // fallback tolerante a erros de digitacao
          const all = await fetchAllShopifyProducts();
          products = fuzzySearch(term, all, (p) => [
            { value: p.node.title, weight: 1 },
            { value: p.node.vendor, weight: 0.9 },
            { value: p.node.productType, weight: 0.85 },
            { value: (p.node.tags || []).join(" "), weight: 0.8 },
          ]).slice(0, 10);
        }
        if (cancelled) return;

        const matchingProducts = products
          .filter((product) =>
            isAudienceVisibleTo(
              audienceMap.get(product.node.id) ?? null,
              isFranchisee,
            ),
          )
          .filter(isProductAvailable)
          .slice(0, 6);

        setSearchResults(matchingProducts);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load search preview:", error);
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search, audienceMap, isFranchisee]);

  const handleSearch = () => {
    if (search.trim()) {
      navigate(`/catalogo?busca=${encodeURIComponent(search.trim())}`);
      setSearch("");
      setSearchPreviewOpen(false);
    }
  };

  const closeSearchPreview = () => setSearchPreviewOpen(false);

  const openProduct = () => {
    setSearch("");
    closeSearchPreview();
  };

  const renderSearchPreview = () => {
    if (!searchPreviewOpen || search.trim().length < 2) return null;
    const waitingForAudience = audienceLoading || franchiseeLoading || subscriberPricesLoading;
    const loading = searchLoading || waitingForAudience;
    const suggestions = buildSearchSuggestions(search, searchResults);

    return (
      <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[70] overflow-hidden rounded-lg border border-border bg-card shadow-[0_18px_45px_-16px_rgba(15,23,42,0.35)]">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            Buscando produtos...
          </div>
        ) : searchResults.length > 0 ? (
          <div>
            <div className="px-2 py-1.5">
              {suggestions.map((suggestion) => (
                <Link
                  key={suggestion}
                  to={`/catalogo?busca=${encodeURIComponent(suggestion)}`}
                  onClick={openProduct}
                  className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <Search className="h-4 w-4 shrink-0" />
                  <span>{suggestion}</span>
                </Link>
              ))}
            </div>

            <div className="px-4 py-2.5 text-sm font-extrabold text-foreground">
              Produtos sugeridos
            </div>

            <div className="grid grid-cols-1 gap-2 bg-muted/25 p-3 xl:grid-cols-2">
              {searchResults.slice(0, 4).map((product) => {
                const image = product.node.images.edges[0]?.node;
                const available = product.node.variants.edges.some(
                  (item) => item.node.availableForSale,
                );
                const variant =
                  product.node.variants.edges.find((item) => item.node.availableForSale)?.node ||
                  product.node.variants.edges[0]?.node;
                const shopifyPrice = variant?.price.amount || product.node.priceRange.minVariantPrice.amount;
                const price = variant ? String(getCustomerPrice(variant.id) ?? Number(shopifyPrice)) : shopifyPrice;
                const subscriberPrice = variant ? getSubscriberPrice(variant.id) : null;
                const hasSubscriberPrice =
                  subscriberPrice !== null && Number.isFinite(subscriberPrice) && subscriberPrice > 0;

                return (
                  <Link
                    key={product.node.id}
                    to={`/product/${product.node.handle}`}
                    onClick={openProduct}
                    className={`flex min-h-[118px] min-w-0 items-center gap-3 rounded-lg border p-3 transition-shadow hover:shadow-sm ${
                      available ? "border-border bg-white" : "border-slate-200 bg-slate-100 text-slate-500"
                    }`}
                  >
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden bg-white">
                      {image ? (
                        <img
                          src={image.url}
                          alt={image.altText || product.node.title}
                          loading="lazy"
                          className={`h-full w-full object-contain p-1 ${available ? "" : "grayscale opacity-50"}`}
                        />
                      ) : (
                        <Package className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-xs font-medium leading-snug text-foreground" title={product.node.title}>
                        {product.node.title}
                      </p>
                      {!available && (
                        <span className="mt-1.5 inline-flex rounded-full bg-slate-200 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                          Indisponível
                        </span>
                      )}
                      <p className="mt-1.5 text-base font-extrabold text-foreground">
                        {formatPrice(price)}
                      </p>
                      {hasSubscriberPrice && (
                        <div className="mt-2 text-primary">
                          <p className="text-base font-extrabold">
                            {formatPrice(String(subscriberPrice))}
                          </p>
                          <p className="text-xs font-medium">para assinantes</p>
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>

          </div>
        ) : (
          <div className="px-5 py-8 text-center">
            <Package className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Nenhum produto encontrado</p>
            <p className="mt-1 text-xs text-muted-foreground">Tente buscar por outro nome.</p>
          </div>
        )}
      </div>
    );
  };

  // Conta, pedidos e WhatsApp. Vive numa variável porque o menu mobile tem dois
  // destinos possíveis: o rodapé do painel em tela cheia, ou o próprio <nav>
  // enquanto as categorias carregam e o painel ainda não existe.
  const accountLinks = (
    <div className="flex flex-col gap-3">
      {user ? (
        <Link
          to="/perfil"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors py-1"
        >
          <User className="h-4 w-4" />
          {user.user_metadata?.first_name || user.user_metadata?.name || user.email?.split("@")[0]}
        </Link>
      ) : (
        <Link
          to="/login"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-2 text-sm font-bold text-primary py-1"
        >
          <User className="h-4 w-4" />
          Entrar / Cadastrar
        </Link>
      )}
      <Link
        to="/meus-pedidos"
        onClick={() => setMobileOpen(false)}
        className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors py-1"
      >
        <Package className="h-4 w-4" />
        Meus Pedidos
      </Link>
      <a
        href={WHATSAPP_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => setMobileOpen(false)}
        className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors py-1"
      >
        <MessageCircle className="h-4 w-4" />
        Fale no WhatsApp
      </a>
    </div>
  );

  return (
    <header
      className={`sticky top-0 z-50 bg-card shadow-[0_4px_16px_-14px_rgba(15,23,42,0.3)] transition-transform duration-300 ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <div className="container relative mx-auto grid grid-cols-3 items-center gap-2 pb-2 pt-3 md:flex md:gap-3">
        <div className="flex justify-self-start md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="text-primary hover:bg-transparent hover:text-primary"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        <Link to="/catalogo" className="relative z-20 flex translate-y-1 shrink-0 items-center justify-self-center" aria-label="TudoPraPet - catálogo">
          <img src={logo} alt="TudoPraPet" className="h-auto w-[118px] sm:w-40 md:h-10 md:w-auto" />
        </Link>

        <form
          role="search"
          onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
          className="relative z-10 hidden min-w-0 translate-y-1 flex-1 md:flex md:max-w-lg lg:absolute lg:left-1/2 lg:w-[38vw] lg:max-w-none lg:-translate-x-1/2 xl:w-[48vw] 2xl:w-[min(48vw,720px)]"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) closeSearchPreview();
          }}
        >
          <input
                  type="search"
                  enterKeyHint="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => {
              if (search.trim().length >= 2) setSearchPreviewOpen(true);
            }}
            placeholder="Buscar produtos..."
            aria-label="Buscar produtos"
            className="h-[52px] w-full rounded-xl border border-[#d1d5db] bg-white px-5 pr-14 text-base shadow-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
          <button
            type="submit"
            className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center bg-transparent text-primary transition-colors hover:text-primary/75"
            aria-label="Pesquisar"
          >
            <Search className="h-6 w-6" strokeWidth={2.5} />
          </button>
          {renderSearchPreview()}
        </form>

        <div className="relative z-20 ml-auto hidden items-center gap-0 md:flex">
          {user ? (
            <Link to="/perfil" aria-label="Abrir minha conta">
              <Button variant="ghost" size="sm" className="h-10 max-w-[180px] gap-2 bg-transparent px-2 text-primary shadow-none hover:bg-transparent hover:text-primary/80">
                <User className="!h-6 !w-6" strokeWidth={2.3} />
                <span className="max-w-[135px] truncate text-sm font-bold">
                  {user.user_metadata?.first_name ||
                    user.user_metadata?.name ||
                    user.email?.split("@")[0]}
                </span>
              </Button>
            </Link>
          ) : (
            <Link to="/login" aria-label="Entrar ou criar conta">
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10 bg-transparent p-0 text-primary shadow-none hover:bg-transparent hover:text-primary/80"
              >
                <User className="!h-6 !w-6" strokeWidth={2.3} />
              </Button>
            </Link>
          )}
          <CartDrawer />
          <Button
            variant="ghost"
            size="icon"
            className="bg-transparent text-primary hover:bg-transparent hover:text-primary lg:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        <div className="col-start-3 row-start-1 flex justify-self-end md:hidden">
          <CartDrawer />
        </div>
      </div>

      <div className="hidden lg:block">
        <div className="container mx-auto flex items-stretch gap-7 lg:pl-16 xl:pl-24">
          <MegaMenu items={navItems} childrenOf={childrenOf} loading={categoriesLoading} isActive={isCategoryActive} />
        </div>
      </div>

      <div className="md:hidden px-4 pb-3">
        <form
          role="search"
          onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
          className="relative"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) closeSearchPreview();
          }}
        >
          <input
                    type="search"
                    enterKeyHint="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => {
              if (search.trim().length >= 2) setSearchPreviewOpen(true);
            }}
            placeholder="Buscar produtos..."
            aria-label="Buscar produtos"
            className="h-14 w-full rounded-md border border-[#d1d5db] bg-white px-5 pr-14 text-base transition-colors placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
          <button
            type="submit"
            className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center bg-transparent text-primary transition-colors hover:text-primary/75"
            aria-label="Pesquisar"
          >
            <Search className="h-6 w-6" />
          </button>
          {renderSearchPreview()}
        </form>
      </div>

      {mobileOpen && (
        <nav className="border-t border-border px-4 py-2 flex flex-col animate-fade-in-up lg:hidden">
          {categoriesLoading ? (
            <>
              <div className="flex flex-col gap-3 py-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-24 rounded-full" />
                ))}
              </div>
              <div className="mt-2 pt-3">{accountLinks}</div>
            </>
          ) : (
            // Estes links precisam viajar para DENTRO do painel. O
            // MobileCategoryNav monta um portal `fixed inset-0` opaco no
            // document.body, então tudo que ficar aqui no fluxo normal some
            // debaixo dele -- e em celular o cabeçalho não tem outro acesso a
            // login (o ícone de conta é `hidden md:flex`). Deixados aqui, os
            // links continuavam existindo no HTML e funcionando por URL
            // direta, então quem testasse por /login não veria problema algum.
            <MobileCategoryNav
              items={navItems}
              childrenOf={childrenOf}
              isActive={isCategoryActive}
              onNavigate={() => setMobileOpen(false)}
              footer={accountLinks}
            />
          )}
        </nav>
      )}
    </header>
  );
};
