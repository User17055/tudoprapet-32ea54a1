import { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Search, User, Menu, X, MessageCircle, Package, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CartDrawer } from "@/components/CartDrawer";
import { MegaMenu, type MegaMenuItem } from "@/components/MegaMenu";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategoryTree } from "@/hooks/useCategoryTree";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { searchShopifyProducts, type ShopifyProduct } from "@/lib/shopify";
import { isAudienceVisibleTo, useProductAudience } from "@/hooks/useProductAudience";
import { useIsFranchisee } from "@/hooks/useIsFranchisee";
import logo from "@/assets/tpp-logo.svg";

const WHATSAPP_URL = "https://wa.me/5518996642021";
const formatPrice = (amount: string) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(amount));

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
  const isClubeActive = location.pathname === "/clube";

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
        const products = await searchShopifyProducts(term, 10);
        if (cancelled) return;

        const availableProducts = products
          .filter((product) =>
            product.node.variants.edges.some((variant) => variant.node.availableForSale),
          )
          .filter((product) =>
            isAudienceVisibleTo(
              audienceMap.get(product.node.id) ?? null,
              isFranchisee,
            ),
          )
          .slice(0, 6);

        setSearchResults(availableProducts);
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
    const waitingForAudience = audienceLoading || franchiseeLoading;
    const loading = searchLoading || waitingForAudience;

    return (
      <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-[70] overflow-hidden rounded-lg border border-border bg-card shadow-[0_18px_45px_-16px_rgba(15,23,42,0.35)]">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            Buscando produtos...
          </div>
        ) : searchResults.length > 0 ? (
          <>
            <div className="max-h-[420px] overflow-y-auto p-2">
              {searchResults.map((product) => {
                const image = product.node.images.edges[0]?.node;
                const price = product.node.priceRange.minVariantPrice.amount;

                return (
                  <Link
                    key={product.node.id}
                    to={`/product/${product.node.handle}`}
                    onClick={openProduct}
                    className="flex items-center gap-4 rounded-md px-3 py-3 transition-colors hover:bg-muted"
                  >
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white">
                      {image ? (
                        <img
                          src={image.url}
                          alt={image.altText || product.node.title}
                          loading="lazy"
                          className="h-full w-full object-contain p-1"
                        />
                      ) : (
                        <Package className="h-6 w-6 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                        {product.node.title}
                      </p>
                      <p className="mt-1 text-sm font-extrabold text-primary">
                        {formatPrice(price)}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
            <Link
              to={`/catalogo?busca=${encodeURIComponent(search.trim())}`}
              onClick={openProduct}
              className="flex items-center justify-center border-t border-border px-4 py-3 text-sm font-bold text-primary transition-colors hover:bg-muted"
            >
              Ver todos os resultados
            </Link>
          </>
        ) : (
          <div className="px-5 py-8 text-center">
            <Package className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Nenhum produto disponível</p>
            <p className="mt-1 text-xs text-muted-foreground">Tente buscar por outro nome.</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <header
      className={`sticky top-0 z-50 bg-card shadow-[0_4px_16px_-14px_rgba(15,23,42,0.3)] transition-transform duration-300 ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <div className="container mx-auto grid grid-cols-3 items-center gap-2 pb-2 pt-3 md:flex md:gap-3">
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

        <Link to="/" className="flex shrink-0 items-center justify-self-center" aria-label="TudoPraPet - início">
          <img src={logo} alt="TudoPraPet" className="h-auto w-[118px] sm:w-40 md:h-10 md:w-auto" />
        </Link>

        <form
          role="search"
          onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
          className="relative hidden min-w-0 flex-1 md:flex md:max-w-2xl"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) closeSearchPreview();
          }}
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => {
              if (search.trim().length >= 2) setSearchPreviewOpen(true);
            }}
            placeholder="Buscar produtos..."
            aria-label="Buscar produtos"
            className="h-12 w-full rounded-md border border-[#dfe3ea] bg-white px-5 pr-12 text-sm shadow-none transition placeholder:text-muted-foreground focus:border-[#c8ced8] focus:outline-none focus:ring-2 focus:ring-black/5"
          />
          <button
            type="submit"
            className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center bg-transparent text-primary transition-colors hover:text-primary/75"
            aria-label="Pesquisar"
          >
            <Search className="h-5 w-5" />
          </button>
          {renderSearchPreview()}
        </form>

        <div className="ml-auto hidden items-center gap-4 md:flex">
          {user ? (
            <Link to="/perfil">
              <Button variant="ghost" size="sm" className="h-12 max-w-[190px] gap-2 bg-transparent px-2 text-foreground shadow-none hover:bg-transparent hover:text-primary">
                <User className="h-7 w-7 shrink-0 text-primary" strokeWidth={2.2} />
                <span className="max-w-[145px] truncate text-base font-semibold">
                  {user.user_metadata?.first_name || user.user_metadata?.name || user.email?.split("@")[0]}
                </span>
              </Button>
            </Link>
          ) : (
            <Link to="/login">
              <Button
                size="sm"
                variant="ghost"
                className="h-12 gap-2 bg-transparent px-2 font-display text-base font-bold text-foreground shadow-none hover:bg-transparent hover:text-primary"
              >
                <User className="h-7 w-7 text-primary" strokeWidth={2.2} />
                Entrar
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
        <div className="container mx-auto flex items-stretch gap-7">
          <MegaMenu items={navItems} childrenOf={childrenOf} loading={categoriesLoading} isActive={isCategoryActive} />
          <Link
            to="/clube"
            className={`flex h-14 shrink-0 items-center whitespace-nowrap px-0 text-base font-bold transition-colors ${
              isClubeActive
                ? "text-primary"
                : "text-foreground hover:text-primary"
            }`}
          >
            Clube
          </Link>
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
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => {
              if (search.trim().length >= 2) setSearchPreviewOpen(true);
            }}
            placeholder="Buscar produtos..."
            aria-label="Buscar produtos"
            className="h-14 w-full rounded-md border border-[#dfe3ea] bg-white px-5 pr-14 text-base transition placeholder:text-muted-foreground focus:border-[#c8ced8] focus:outline-none focus:ring-2 focus:ring-black/5"
          />
          <button
            type="submit"
            className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center bg-transparent text-primary transition-colors hover:text-primary/75"
            aria-label="Pesquisar"
          >
            <Search className="h-5 w-5" />
          </button>
          {renderSearchPreview()}
        </form>
      </div>

      {mobileOpen && (
        <nav className="border-t border-border px-4 py-2 flex flex-col animate-fade-in-up lg:hidden">
          {categoriesLoading ? (
            <div className="flex flex-col gap-3 py-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-24 rounded-full" />
              ))}
            </div>
          ) : (
            <Accordion type="single" collapsible>
              {navItems.map((item) => {
                const kids = childrenOf.get(item.id) || [];
                if (kids.length === 0) {
                  return (
                    <Link
                      key={item.id}
                      to={`/catalogo?categoria=${item.slug}&categoria_id=${item.id}`}
                      className={`block border-b border-border py-3 text-sm font-medium transition-colors ${
                        isCategoryActive(item.slug) ? "text-primary font-semibold" : "text-foreground hover:text-primary"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                }
                return (
                  <AccordionItem key={item.id} value={item.id}>
                    <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
                      {item.label}
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="flex flex-col gap-1 border-l border-border pl-3">
                        {kids.map((kid) => (
                          <Link
                            key={kid.id}
                            to={`/catalogo?categoria=${kid.slug}&categoria_id=${kid.id}`}
                            className="py-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
                          >
                            {kid.name}
                          </Link>
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}

          <Link
            to="/clube"
            className={`block border-b border-border py-3 text-sm font-medium transition-colors ${
              isClubeActive ? "text-primary font-semibold" : "text-foreground hover:text-primary"
            }`}
          >
            Clube
          </Link>

          <div className="mt-2 pt-3 flex flex-col gap-3">
            {user ? (
              <Link
                to="/perfil"
                className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors py-1"
              >
                <User className="h-4 w-4" />
                {user.user_metadata?.first_name || user.user_metadata?.name || user.email?.split("@")[0]}
              </Link>
            ) : (
              <Link to="/login" className="flex items-center gap-2 text-sm font-bold text-primary py-1">
                <User className="h-4 w-4" />
                Entrar / Cadastrar
              </Link>
            )}
            <Link
              to="/meus-pedidos"
              className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors py-1"
            >
              <Package className="h-4 w-4" />
              Meus Pedidos
            </Link>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors py-1"
            >
              <MessageCircle className="h-4 w-4" />
              Fale no WhatsApp
            </a>
          </div>
        </nav>
      )}
    </header>
  );
};
