import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, User, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CartDrawer } from "@/components/CartDrawer";
import { Link } from "react-router-dom";
import { useShopifyAuth } from "@/contexts/ShopifyAuthContext";
import logo from "@/assets/logo.png";

const navLinks = [
  { label: "Catálogo", href: "/catalogo" },
  { label: "Rações", href: "/catalogo?categoria=racoes" },
  { label: "Farmácia", href: "/catalogo?categoria=farmacia" },
  { label: "Promoções", href: "/catalogo" },
];

export const Header = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { customer } = useShopifyAuth();

  return (
    <header className="sticky top-0 z-50 bg-card shadow-sm border-b border-border">
      <div className="container mx-auto flex items-center justify-between gap-4 py-3">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <img src={logo} alt="TudoPraPet" className="h-9 w-auto" />
          <span className="font-display font-900 text-xl md:text-2xl text-foreground">
            Tudo<span className="text-primary">Pra</span>Pet
          </span>
        </Link>

        {/* Search - hidden mobile */}
        <div className="hidden md:flex flex-1 max-w-lg relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produtos..."
            className="w-full rounded-full border border-input bg-background px-5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
          />
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        </div>

        {/* Nav links - desktop */}
        <nav className="hidden lg:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              to={link.href}
              className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Link to={customer ? "/perfil" : "/login"}>
            <Button variant="ghost" size="icon" className="hidden md:flex">
              <User className="h-5 w-5" />
            </Button>
          </Link>
          <CartDrawer />
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile search */}
      <div className="md:hidden px-4 pb-3">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar produtos..."
            className="w-full rounded-full border border-input bg-background px-5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
          />
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <nav className="lg:hidden border-t border-border px-4 py-4 flex flex-col gap-3 animate-fade-in-up">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              to={link.href}
              className="text-sm font-medium text-foreground hover:text-primary transition-colors py-1"
            >
              {link.label}
            </Link>
          ))}
          <Link
            to={customer ? "/perfil" : "/login"}
            className="text-sm font-medium text-foreground hover:text-primary transition-colors py-1"
          >
            {customer ? "Meu Perfil" : "Entrar"}
          </Link>
        </nav>
      )}
    </header>
  );
};
