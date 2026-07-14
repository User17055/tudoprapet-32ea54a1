import { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Search, User, Menu, X, MessageCircle, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CartDrawer } from "@/components/CartDrawer";
import { MegaMenu, type MegaMenuItem } from "@/components/MegaMenu";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { useCategoryTree } from "@/hooks/useCategoryTree";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import logo from "@/assets/logo.png";

const WHATSAPP_URL = "https://wa.me/5518996642021";

export const Header = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [hidden, setHidden] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { rootCats, childrenOf, loading: categoriesLoading } = useCategoryTree();

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

  const handleSearch = () => {
    if (search.trim()) {
      navigate(`/catalogo?busca=${encodeURIComponent(search.trim())}`);
      setSearch("");
    }
  };

  return (
    <header
      className={`sticky top-0 z-50 bg-card shadow-sm border-b border-border transition-transform duration-300 ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      <div className="container mx-auto grid grid-cols-3 items-center gap-2 pb-2 pt-3 md:flex md:justify-between md:gap-4">
        <div className="flex justify-self-start md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-primary hover:bg-primary/10"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        <Link to="/" className="flex shrink-0 items-center justify-self-center gap-2" aria-label="TudoPraPet - início">
          <img src={logo} alt="TudoPraPet" className="h-11 w-auto md:h-14" />
          <span className="hidden font-display font-900 text-2xl text-foreground md:inline md:text-3xl">
            Tudo<span className="text-primary">Pra</span>Pet
          </span>
        </Link>

        <form
          role="search"
          onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
          className="hidden md:flex flex-1 max-w-lg relative"
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produtos..."
            aria-label="Buscar produtos"
            className="w-full rounded-full border border-input bg-background px-5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
          />
          <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:text-primary transition-colors">
            <Search className="h-4 w-4 text-muted-foreground" />
          </button>
        </form>

        <div className="hidden items-center gap-2 md:flex">
          {user ? (
            <Link to="/perfil">
              <Button variant="outline" size="sm" className="h-10 max-w-[180px] gap-2 rounded-full border-primary/15 bg-primary/5 px-4 text-primary hover:bg-primary/10">
                <User className="h-5 w-5" />
                <span className="text-sm font-medium max-w-[140px] truncate">
                  {user.user_metadata?.first_name || user.user_metadata?.name || user.email?.split("@")[0]}
                </span>
              </Button>
            </Link>
          ) : (
            <Link to="/login">
              <Button
                size="sm"
                className="h-10 rounded-full font-display font-bold px-5 shadow-[0_8px_18px_-10px_hsl(var(--primary))] btn-bounce bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
              >
                <User className="h-4 w-4" />
                Entrar
              </Button>
            </Link>
          )}
          <CartDrawer />
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full text-primary hover:bg-primary/10 lg:hidden"
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
        <div className="container mx-auto flex items-center gap-1 pb-3">
          <MegaMenu items={navItems} childrenOf={childrenOf} loading={categoriesLoading} isActive={isCategoryActive} />
          <Link
            to="/clube"
            className={`rounded-full px-3 py-2 text-base font-semibold transition-all duration-200 ${
              isClubeActive ? "bg-primary/10 text-primary" : "text-foreground hover:-translate-y-0.5 hover:bg-primary/5 hover:text-primary"
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
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produtos..."
            aria-label="Buscar produtos"
            className="w-full rounded-full border border-input bg-background px-5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
          />
          <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:text-primary transition-colors">
            <Search className="h-4 w-4 text-muted-foreground" />
          </button>
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
