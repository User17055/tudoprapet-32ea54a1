import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, User, Menu, X, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CartDrawer } from "@/components/CartDrawer";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { AnnouncementBar } from "@/components/AnnouncementBar";
import { Bandeirinhas } from "@/components/Bandeirinhas";
import logo from "@/assets/logo.png";

const navLinks = [
  { label: "Catálogo", href: "/catalogo" },
  { label: "Rações", href: "/catalogo?categoria=racoes" },
  { label: "Farmácia", href: "/catalogo?categoria=farmacia" },
  { label: "Clube", href: "/clube" },
];

export const Header = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleSearch = () => {
    if (search.trim()) {
      navigate(`/catalogo?busca=${encodeURIComponent(search.trim())}`);
      setSearch("");
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-card shadow-sm border-b border-border">
      <AnnouncementBar />
      <Bandeirinhas />
      <div className="container mx-auto flex items-center justify-between gap-4 py-3">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <img src={logo} alt="TudoPraPet" className="h-9 w-auto" />
          <span className="font-display font-900 text-xl md:text-2xl text-foreground">
            Tudo<span className="text-primary">Pra</span>Pet
          </span>
        </Link>

        <div className="hidden md:flex flex-1 max-w-lg relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Buscar produtos..."
            className="w-full rounded-full border border-input bg-background px-5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
          />
          <button onClick={handleSearch} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:text-primary transition-colors">
            <Search className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <nav className="hidden lg:flex items-center gap-6">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              to={link.href}
              className="text-sm font-medium transition-colors text-muted-foreground hover:text-primary"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link to={user ? "/perfil" : "/login"}>
            <Button variant="ghost" size="sm" className="hidden md:flex items-center gap-2">
              <User className="h-5 w-5" />
              {user && (
                <span className="text-sm font-medium max-w-[140px] truncate">
                  {user.user_metadata?.first_name || user.user_metadata?.name || user.email?.split("@")[0]}
                </span>
              )}
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

      <div className="md:hidden px-4 pb-3">
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Buscar produtos..."
            className="w-full rounded-full border border-input bg-background px-5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition"
          />
          <button onClick={handleSearch} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:text-primary transition-colors">
            <Search className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="lg:hidden border-t border-border px-4 py-4 flex flex-col gap-3 animate-fade-in-up">
          {navLinks.map((link) => (
            <Link
              key={link.label}
              to={link.href}
              className="text-sm font-medium transition-colors py-1 text-foreground hover:text-primary"
            >
              {link.label}
            </Link>
          ))}
          <Link
            to={user ? "/perfil" : "/login"}
            className="text-sm font-medium text-foreground hover:text-primary transition-colors py-1"
          >
            {user ? (user.user_metadata?.first_name || user.user_metadata?.name || user.email?.split("@")[0]) : "Entrar"}
          </Link>
        </nav>
      )}
    </header>
  );
};
