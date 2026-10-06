import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Trash2,
  Loader2,
  Crown,
  Package,
  Users,
  Pencil,
  Check,
  X,
  FileText,
  Bold,
  Italic,
  Layers,
  Image as ImageIcon,
  ListTree,
  Star,
  Store,
  Ticket,
  Menu,
  ExternalLink,
  Boxes,
  CopyCheck,
  Receipt,
  GitBranch,
  Wrench,
  LayoutDashboard,
  ShieldCheck,
  CircleDollarSign,
  BadgePercent,
  ChevronRight,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  ShieldAlert,

  type LucideIcon,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { storefrontApiRequest, PRODUCTS_QUERY, type ShopifyProduct } from "@/lib/shopify";
import { fetchAllShopifyProducts } from "@/lib/shopify";
import { fetchAllRows, fetchAllRowsResult } from "@/lib/fetchAllRows";
import logo from "@/assets/tpp-logo.svg";
import DetailsTab from "./admin/DetailsTab";
import BannersTab from "./admin/BannersTab";
import CategoriesTab from "./admin/CategoriesTab";
import FeaturedTab from "./admin/FeaturedTab";
import RetiradaTab from "./admin/RetiradaTab";
import FranquiaTab from "./admin/FranquiaTab";
import VariationsTab from "./admin/VariationsTab";
import OrdersTab from "./admin/OrdersTab";
import SyncTab from "./admin/SyncTab";
import MaintenanceTab from "./admin/MaintenanceTab";
import ConferenceTab from "./admin/ConferenceTab";
import OverviewTab from "./admin/OverviewTab";
import AdministratorsTab from "./admin/AdministratorsTab";
import ValuesTab from "./admin/ValuesTab";
import CommissionsTab from "./admin/CommissionsTab";
import DuplicatesTab from "./admin/DuplicatesTab";
import { ProductPicker } from "@/components/admin/ProductPicker";
import { AdminSidebarNav } from "@/components/admin/AdminSidebarNav";
import { AdminCommandPalette } from "@/components/admin/AdminCommandPalette";

interface SubPrice {
  id: string;
  shopify_product_id: string;
  shopify_variant_id: string;
  subscriber_price: number;
}

interface Member {
  id: string;
  email: string;
  name: string | null;
  is_active: boolean;
  created_at: string;
}

type SubscriberPriceAdjustment = "percentage" | "amount";
type SubscriberPriceCalculationMode = "automatic" | "manual";
type SubscriberPriceFilter = "all" | "registered" | "unregistered";

type SectionId =
  | "overview"
  | "administrators"
  | "users"
  | "members"
  | "prices"
  | "values"
  | "content"
  | "details"
  | "variations"
  | "duplicates"
  | "categories"
  | "banners"
  | "featured"
  | "referrals"
  | "commissions"
  | "retirada"
  | "orders"
  | "sync"
  | "maintenance"
  | "conference"
  | "franquia";

interface SectionDef {
  id: SectionId;
  label: string;
  description: string;
  icon: LucideIcon;
  component: ComponentType;
}

const NAV_GROUPS: { label: string; items: SectionDef[] }[] = [
  {
    label: "Geral",
    items: [
      { id: "overview", label: "Visão geral", description: "Indicadores e atalhos da operação", icon: LayoutDashboard, component: OverviewTab },
      { id: "administrators", label: "Administradores", description: "Cadastre e gerencie os acessos ao painel", icon: ShieldCheck, component: AdministratorsTab },
    ],
  },
  {
    label: "Clube",
    items: [
      { id: "users", label: "Usuários", description: "Contas cadastradas na loja e seus planos", icon: Users, component: UsersTab },
      { id: "members", label: "Membros", description: "Membros do clube com benefícios ativos", icon: Crown, component: MembersTab },
      { id: "prices", label: "Preços do Clube", description: "Preços exclusivos para assinantes", icon: Package, component: PricesTab },
      { id: "referrals", label: "Indicações", description: "Códigos de funcionários para cadastro e compras", icon: Ticket, component: ReferralCodesTab },
      { id: "commissions", label: "Comissões", description: "Vendas atribuídas, produtos e comissão por pessoa", icon: BadgePercent, component: CommissionsTab },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { id: "values", label: "Valores", description: "Preços da Shopify, clientes, assinantes e franquias", icon: CircleDollarSign, component: ValuesTab },
      { id: "content", label: "Conteúdo", description: "Descrições personalizadas dos produtos", icon: FileText, component: ContentTab },
      { id: "details", label: "Detalhes", description: "Categorias, marcas e atributos dos produtos", icon: Layers, component: DetailsTab },
      { id: "variations", label: "Variações", description: "Agrupe tamanhos e pesos do mesmo produto", icon: Boxes, component: VariationsTab },
      { id: "duplicates", label: "Duplicados", description: "Confira produtos com nomes e apresentações parecidos", icon: CopyCheck, component: DuplicatesTab },
      { id: "categories", label: "Ordem do Menu", description: "Ordem das categorias no menu do site", icon: ListTree, component: CategoriesTab },
      { id: "franquia", label: "Franquia", description: "Visibilidade e preços exclusivos para franqueados", icon: Store, component: FranquiaTab },
      { id: "conference", label: "Relatório", description: "Todos os produtos, preços, visibilidade e impressão", icon: FileText, component: ConferenceTab },
    ],
  },
  {
    label: "Vitrine",
    items: [
      { id: "banners", label: "Banners", description: "Carrossel de banners da página inicial", icon: ImageIcon, component: BannersTab },
      { id: "featured", label: "Destaques", description: "Produtos em destaque na página inicial", icon: Star, component: FeaturedTab },
    ],
  },
  {
    label: "Operação",
    items: [
      { id: "retirada", label: "Retirada", description: "Validar código de retirada do cliente", icon: Package, component: RetiradaTab },
      { id: "orders", label: "Pedidos", description: "Todos os pedidos da loja e impressão de comprovante", icon: Receipt, component: OrdersTab },
      { id: "sync", label: "Sincronização", description: "Commits da branch já publicados na main", icon: GitBranch, component: SyncTab },
      { id: "maintenance", label: "Manutenção", description: "Bloqueio temporário da loja para visitantes", icon: Wrench, component: MaintenanceTab },
    ],
  },
];

const ALL_SECTIONS = NAV_GROUPS.flatMap((g) => g.items);

// Preferências do painel guardadas neste navegador. O acesso ao localStorage
// pode falhar (aba anônima bloqueada); nesse caso o painel só não lembra.
const SIDEBAR_KEY = "tpp-admin-sidebar";
const RECENT_KEY = "tpp-admin-recent";
const RECENT_LIMIT = 6;

const readStorage = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Sem armazenamento a preferência vale só até recarregar.
  }
};

const readRecent = (): SectionId[] => {
  try {
    const parsed = JSON.parse(readStorage(RECENT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => ALL_SECTIONS.some((section) => section.id === id)) : [];
  } catch {
    return [];
  }
};

export default function Admin() {
  const { user, loading: authLoading, logout } = useAuth();
  const { isAdmin, loading: roleLoading } = useIsAdmin();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readStorage(SIDEBAR_KEY) === "collapsed");
  const [recentIds, setRecentIds] = useState<SectionId[]>(readRecent);
  // Trocar a chave remonta a seção aberta, que então recarrega os próprios dados.
  const [refreshKey, setRefreshKey] = useState(0);
  const contentRef = useRef<HTMLElement>(null);

  const tabParam = searchParams.get("tab");
  const active = ALL_SECTIONS.find((s) => s.id === tabParam) ?? ALL_SECTIONS[0];
  const activeGroup = NAV_GROUPS.find((group) => group.items.some((item) => item.id === active.id));
  const selectSection = useCallback((id: string) => {
    setSearchParams({ tab: id });
    setMobileNavOpen(false);
  }, [setSearchParams]);

  // Tema do painel: vale só enquanto esta página está aberta (ver index.css).
  useEffect(() => {
    document.documentElement.classList.add("admin-theme");
    return () => document.documentElement.classList.remove("admin-theme");
  }, []);

  useEffect(() => {
    const previous = document.title;
    document.title = `${active.label} · Painel TudoPraPet`;
    return () => {
      document.title = previous;
    };
  }, [active.label]);

  useEffect(() => {
    setRecentIds((current) => {
      const next = [active.id, ...current.filter((id) => id !== active.id)].slice(0, RECENT_LIMIT);
      writeStorage(RECENT_KEY, JSON.stringify(next));
      return next;
    });
    contentRef.current?.scrollTo?.({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [active.id]);

  // Ctrl/⌘ + K abre a busca de seções de qualquer lugar do painel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      writeStorage(SIDEBAR_KEY, current ? "expanded" : "collapsed");
      return !current;
    });
  };

  const handleLogout = async () => {
    await logout();
    toast.success("Sessão encerrada.");
    navigate("/login");
  };

  const refreshSection = () => {
    setRefreshKey((key) => key + 1);
    toast.success("Seção atualizada", { description: active.label });
  };

  if (!authLoading && !user) return <Navigate to="/login" replace />;
  if (authLoading || roleLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background" role="status" aria-label="Carregando o painel">
        <img src={logo} alt="TudoPraPet" className="h-auto w-40 animate-pulse" />
        <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Carregando o painel...
        </p>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <img src={logo} alt="TudoPraPet" className="mx-auto h-auto w-36" />
          <span className="mx-auto mt-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <ShieldAlert className="h-7 w-7" />
          </span>
          <h1 className="mt-5 text-xl font-bold text-foreground">Acesso restrito</h1>
          <p className="mt-2 text-sm text-muted-foreground">Você não tem permissão para acessar este painel.</p>
          {user?.email && (
            <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Conectado como <span className="font-semibold text-foreground">{user.email}</span>
            </p>
          )}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button asChild variant="outline">
              <Link to="/">Voltar para a loja</Link>
            </Button>
            <Button onClick={() => void handleLogout()}>Entrar com outra conta</Button>
          </div>
        </div>
      </main>
    );
  }

  const ActiveComponent = active.component;
  const ActiveIcon = active.icon;
  const userInitial = (user?.email || "A").charAt(0).toUpperCase();

  const sidebarHeader = (isCollapsed: boolean) => (
    <div className={cn("flex h-16 shrink-0 items-center border-b border-[hsl(var(--admin-sidebar-border))]", isCollapsed ? "justify-center px-2" : "px-5")}>
      <Link to="/admin?tab=overview" onClick={() => setMobileNavOpen(false)} className="flex min-w-0 items-center gap-3" aria-label="Painel TudoPraPet — visão geral">
        {isCollapsed ? (
          <img src="/favicon.svg" alt="" className="h-9 w-9 rounded-lg bg-white p-1" />
        ) : (
          <>
            <img src={logo} alt="TudoPraPet" className="h-auto w-[118px] brightness-0 invert" />
            <span className="rounded-md bg-[hsl(var(--admin-gold))] px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[hsl(var(--admin-sidebar))]">
              Admin
            </span>
          </>
        )}
      </Link>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Menu lateral (desktop) */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col bg-[hsl(var(--admin-sidebar))] text-[hsl(var(--admin-sidebar-foreground))] transition-[width] duration-200 lg:flex",
          collapsed ? "w-[76px]" : "w-[264px]",
        )}
      >
        {sidebarHeader(collapsed)}

        <div className={cn("shrink-0 pt-4", collapsed ? "px-3" : "px-4")}>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Buscar seção (Ctrl + K)"
            className={cn(
              "flex h-10 w-full items-center gap-2.5 rounded-lg border border-[hsl(var(--admin-sidebar-border))] bg-white/[0.04] text-sm text-[hsl(var(--admin-sidebar-muted))] transition-colors hover:bg-white/[0.08] hover:text-white",
              collapsed ? "justify-center" : "px-3",
            )}
          >
            <Search className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">Buscar seção...</span>
                <kbd className="rounded border border-white/15 px-1.5 py-0.5 font-sans text-[10px] font-semibold">Ctrl K</kbd>
              </>
            )}
          </button>
        </div>

        <div className={cn("min-h-0 flex-1 overflow-y-auto py-5", collapsed ? "px-3" : "px-4")}>
          <AdminSidebarNav groups={NAV_GROUPS} activeId={active.id} collapsed={collapsed} onSelect={selectSection} />
        </div>

        <div className={cn("shrink-0 border-t border-[hsl(var(--admin-sidebar-border))] p-3", collapsed && "flex flex-col items-center gap-2")}>
          {!collapsed && (
            <div className="mb-2 flex items-center gap-3 rounded-lg px-2 py-1.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--admin-gold))] text-sm font-extrabold text-[hsl(var(--admin-sidebar))]">
                {userInitial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white">Administrador</p>
                <p className="truncate text-[11px] text-[hsl(var(--admin-sidebar-muted))]">{user?.email}</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className={cn(
              "flex h-9 items-center gap-2 rounded-lg text-xs font-semibold text-[hsl(var(--admin-sidebar-muted))] transition-colors hover:bg-[hsl(var(--admin-sidebar-hover))] hover:text-white",
              collapsed ? "w-10 justify-center" : "w-full px-2",
            )}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            {!collapsed && "Recolher menu"}
          </button>
        </div>
      </aside>

      {/* Menu em gaveta (celular e tablet) */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          closeLabel="Fechar menu"
          onClose={() => setMobileNavOpen(false)}
          aria-describedby={undefined}
          className="flex w-[288px] max-w-[85vw] flex-col gap-0 border-r-0 bg-[hsl(var(--admin-sidebar))] p-0 text-white lg:hidden"
        >
          <SheetTitle className="sr-only">Menu do painel</SheetTitle>
          {sidebarHeader(false)}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
            <AdminSidebarNav groups={NAV_GROUPS} activeId={active.id} onSelect={selectSection} />
          </div>
          <div className="shrink-0 border-t border-[hsl(var(--admin-sidebar-border))] p-4 text-[11px] text-[hsl(var(--admin-sidebar-muted))]">
            <p className="truncate">{user?.email}</p>
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior */}
        <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="-ml-1 lg:hidden"
            aria-label="Abrir menu"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          <nav aria-label="Você está em" className="flex min-w-0 items-center gap-1.5 text-sm">
            <button
              type="button"
              onClick={() => selectSection("overview")}
              className="hidden shrink-0 font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline"
            >
              Painel
            </button>
            {activeGroup && (
              <>
                <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground/60 sm:block" />
                <span className="hidden shrink-0 font-medium text-muted-foreground md:inline">{activeGroup.label}</span>
                <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground/60 md:block" />
              </>
            )}
            <span className="truncate font-semibold text-foreground">{active.label}</span>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden h-9 w-56 items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-foreground md:flex xl:w-72"
              aria-label="Buscar seção (Ctrl + K)"
            >
              <Search className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">Buscar no painel...</span>
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-semibold">Ctrl K</kbd>
            </button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="md:hidden"
              aria-label="Buscar seção"
              onClick={() => setPaletteOpen(true)}
            >
              <Search className="h-5 w-5" />
            </Button>

            <Button asChild variant="outline" size="sm" className="hidden h-9 gap-2 sm:inline-flex">
              <Link to="/">
                Ver loja
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground outline-none ring-offset-2 transition-shadow hover:ring-2 hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="Menu da conta"
                >
                  {userInitial}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <p className="text-sm font-semibold">Administrador</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild className="cursor-pointer gap-2">
                  <Link to="/"><ExternalLink className="h-4 w-4" /> Ver loja</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild className="cursor-pointer gap-2">
                  <Link to="/perfil"><Users className="h-4 w-4" /> Minha conta</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => void handleLogout()}
                  className="cursor-pointer gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
                >
                  <LogOut className="h-4 w-4" /> Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main ref={contentRef} className="admin-content min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-[1440px]">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--admin-sidebar))] text-[hsl(var(--admin-gold))] shadow-sm">
                  <ActiveIcon className="h-6 w-6" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                    {activeGroup?.label}
                  </p>
                  <h1 className="break-words text-2xl font-bold tracking-tight text-foreground">{active.label}</h1>
                  <p className="mt-0.5 text-sm text-muted-foreground">{active.description}</p>
                </div>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={refreshSection}
                    className="hidden h-9 w-9 shrink-0 self-start sm:inline-flex"
                    aria-label="Recarregar esta seção"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">Recarregar esta seção</TooltipContent>
              </Tooltip>
            </div>
            <section key={`${active.id}-${refreshKey}`} className="min-w-0 overflow-x-auto pb-1 animate-in fade-in slide-in-from-bottom-1 duration-200">
              <ActiveComponent />
            </section>
          </div>
        </main>
      </div>

      <AdminCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        groups={NAV_GROUPS}
        recentIds={recentIds}
        activeId={active.id}
        onSelectSection={selectSection}
        onRefresh={refreshSection}
        onToggleSidebar={toggleCollapsed}
        sidebarCollapsed={collapsed}
        onOpenStore={() => navigate("/")}
        onLogout={() => void handleLogout()}
      />
    </div>
  );
}

function PricesTab() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [prices, setPrices] = useState<SubPrice[]>([]);
  const [customerPrices, setCustomerPrices] = useState<{ shopify_variant_id: string; price: number }[]>([]);
  const [productCosts, setProductCosts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [calculationMode, setCalculationMode] = useState<SubscriberPriceCalculationMode>("automatic");
  const [manualCost, setManualCost] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<SubscriberPriceAdjustment>("percentage");
  const [adjustment, setAdjustment] = useState("0");
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState("");
  const [updatingPrice, setUpdatingPrice] = useState(false);
  const [registrationFilter, setRegistrationFilter] = useState<SubscriberPriceFilter>("all");

  const loadAll = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [shop, sub, customer, costs] = await Promise.all([
        fetchAllShopifyProducts(),
        // Paginadas: subscriber_prices passou de 1000 linhas e as mais antigas sumiam como
        // "Não configurado". A lista continua das mais recentes para as mais antigas.
        fetchAllRows<SubPrice & { updated_at: string }>("subscriber_prices", "*", { orderBy: "id" })
          .then((rows) => rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))),
        fetchAllRows<{ shopify_variant_id: string; price: number | string }>(
          "customer_prices",
          "shopify_variant_id,price",
          { orderBy: "shopify_variant_id" },
        ),
        fetchAllRows<{ shopify_variant_id: string; cost: number | string }>(
          "product_costs",
          "shopify_variant_id,cost",
          { orderBy: "shopify_variant_id" },
        ),
      ]);
      setProducts(shop);
      setPrices(sub);
      setCustomerPrices(customer.map((row) => ({ ...row, price: Number(row.price) })));
      setProductCosts(new Map(costs.map((row) => [row.shopify_variant_id, Number(row.cost)])));
    } catch (e) {
      if (!silent) toast.error("Erro ao carregar dados");
      console.error(e);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    const onFocus = () => loadAll(true);
    window.addEventListener("focus", onFocus);
    const channel = supabase
      .channel("admin-subscriber-prices")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriber_prices" },
        () => loadAll(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customer_prices" },
        () => loadAll(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_costs" },
        () => loadAll(true),
      )
      .subscribe();
    return () => {
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, []);

  const selectedProduct = useMemo(
    () => products.find(p => p.node.id === productId),
    [products, productId]
  );

  const registeredProductIds = useMemo(
    () => new Set(prices.map(p => p.shopify_product_id)),
    [prices]
  );


  const priceByProductId = useMemo(() => {
    const map = new Map<string, SubPrice>();
    prices.forEach(price => map.set(price.shopify_product_id, price));
    return map;
  }, [prices]);

  const listedProducts = useMemo(() => products.filter(product => {
    const registered = registeredProductIds.has(product.node.id);
    if (registrationFilter === "registered") return registered;
    if (registrationFilter === "unregistered") return !registered;
    return true;
  }), [products, registeredProductIds, registrationFilter]);


  const selectedVariant = selectedProduct?.node.variants.edges.find(v => v.node.id === variantId)?.node
    || selectedProduct?.node.variants.edges[0]?.node;
  const shopifyPrice = selectedVariant ? Number(selectedVariant.price.amount) : null;
  const selectedCustomerPrice = selectedVariant
    ? customerPrices.find((row) => row.shopify_variant_id === selectedVariant.id)?.price ?? shopifyPrice
    : null;
  const estimatedCost = selectedCustomerPrice === null ? null : selectedCustomerPrice / 2;
  const realCost = selectedVariant ? productCosts.get(selectedVariant.id) ?? null : null;
  const manualCostValue = Number(manualCost.replace(",", "."));
  const calculationBaseCost = calculationMode === "manual"
    ? (manualCost.trim() !== "" && Number.isFinite(manualCostValue) ? manualCostValue : null)
    : (realCost ?? estimatedCost);
  const adjustmentValue = Number(adjustment.replace(",", "."));
  const calculatedSubscriberPrice = calculationBaseCost === null || !Number.isFinite(adjustmentValue)
    ? null
    : Math.round((adjustmentType === "percentage"
      ? calculationBaseCost * (1 + adjustmentValue / 100)
      : calculationBaseCost + adjustmentValue) * 100) / 100;

  const handleSave = async () => {
    if (!productId || !variantId) {
      toast.error("Preencha todos os campos");
      return;
    }
    if (!Number.isFinite(adjustmentValue) || adjustmentValue < 0) {
      toast.error("Informe um reajuste igual ou maior que zero");
      return;
    }
    if (calculationMode === "manual" && (calculationBaseCost === null || calculationBaseCost <= 0)) {
      toast.error("Informe um custo manual maior que zero");
      return;
    }
    if (calculatedSubscriberPrice === null) {
      toast.error("Não foi possível calcular o preço");
      return;
    }
    const numeric = calculatedSubscriberPrice;
    if (isNaN(numeric) || numeric <= 0) {
      toast.error("Preço inválido");
      return;
    }
    setSaving(true);
    const existing = prices.find(p => p.shopify_variant_id === variantId);
    const payload = {
      shopify_product_id: productId,
      shopify_variant_id: variantId,
      subscriber_price: numeric,
    };
    const { error } = existing
      ? await supabase.from("subscriber_prices").update(payload).eq("id", existing.id)
      : await supabase.from("subscriber_prices").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    toast.success("Preço salvo!");
    setProductId(""); setVariantId(""); setManualCost(""); setAdjustment("0");
    loadAll(true);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("subscriber_prices").delete().eq("id", id);
    if (error) return toast.error("Erro ao excluir");
    toast.success("Removido");
    if (editingPriceId === id) {
      setEditingPriceId(null);
      setEditingPrice("");
    }
    setPrices(prices.filter(p => p.id !== id));
  };

  const startEditingPrice = (subscriberPrice: SubPrice) => {
    setEditingPriceId(subscriberPrice.id);
    setEditingPrice(String(subscriberPrice.subscriber_price));
  };

  const cancelEditingPrice = () => {
    setEditingPriceId(null);
    setEditingPrice("");
  };

  const handleUpdatePrice = async (subscriberPrice: SubPrice) => {
    if (updatingPrice) return;

    const numeric = parseFloat(editingPrice.replace(",", "."));
    if (isNaN(numeric) || numeric <= 0) {
      toast.error("Preço inválido");
      return;
    }

    setUpdatingPrice(true);
    const { error } = await supabase
      .from("subscriber_prices")
      .update({ subscriber_price: numeric })
      .eq("id", subscriberPrice.id);
    setUpdatingPrice(false);

    if (error) {
      toast.error("Erro ao atualizar: " + error.message);
      return;
    }

    setPrices(current => current.map(item => (
      item.id === subscriberPrice.id ? { ...item, subscriber_price: numeric } : item
    )));
    cancelEditingPrice();
    toast.success("Preço atualizado!");
  };

  const productById = useMemo(() => {
    const map = new Map<string, ShopifyProduct["node"]>();
    products.forEach(p => map.set(p.node.id, p.node));
    return map;
  }, [products]);

  const variantInfo = (sp: SubPrice) => {
    const prod = productById.get(sp.shopify_product_id);
    const variant = prod?.variants.edges.find(v => v.node.id === sp.shopify_variant_id);
    return {
      productTitle: prod?.title || "Produto removido",
      productImage: prod?.images.edges[0]?.node,
      variantTitle: variant?.node.title || sp.shopify_variant_id,
      shopifyPrice: variant ? Number(variant.node.price.amount) : null,
    };
  };

  const previewImage = selectedProduct?.node.images.edges[0]?.node;
  const previewVariant = selectedVariant;
  const previewPrice = previewVariant ? parseFloat(previewVariant.price.amount) : null;
  const previewCompare = previewVariant?.compareAtPrice ? parseFloat(previewVariant.compareAtPrice.amount) : null;
  const previewSubscriber = calculatedSubscriberPrice;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Adicionar preço de assinante</CardTitle>
          <CardDescription>
            Escolha entre usar o custo real da Olist ou informar o custo manualmente e aplicar o reajuste desejado.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="grid gap-4 md:grid-cols-[200px_1fr]">
            {/* Preview */}
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3">
              <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-muted">
                {previewImage ? (
                  <img
                    src={previewImage.url}
                    alt={previewImage.altText || selectedProduct?.node.title || ""}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Package className="h-10 w-10 text-muted-foreground" />
                )}
              </div>
              <div className="text-xs">
                <p className="min-h-[2.4em] font-bold line-clamp-2">
                  {selectedProduct?.node.title || "Selecione um produto"}
                </p>
                {previewVariant && (
                  <p className="mt-0.5 text-muted-foreground">{previewVariant.title}</p>
                )}
                {previewPrice !== null && (
                  <div className="mt-1.5">
                    {previewCompare && previewCompare > previewPrice && (
                      <p className="text-[11px] text-muted-foreground line-through tabular-nums">
                        R$ {previewCompare.toFixed(2)}
                      </p>
                    )}
                    <p className="text-base font-bold tabular-nums">R$ {previewPrice.toFixed(2)}</p>
                    {previewSubscriber !== null && !isNaN(previewSubscriber) && previewSubscriber > 0 && (
                      <div className="mt-1 flex items-center gap-1">
                        <span className="font-bold text-sky-500 tabular-nums">
                          R$ {previewSubscriber.toFixed(2)}
                        </span>
                        <Crown className="h-3.5 w-3.5 text-sky-500" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Form */}
            <div className="grid content-start gap-3 md:grid-cols-4">
              <div className="md:col-span-4">
                <label className="mb-1 block text-sm font-medium">Produto</label>
                <ProductPicker
                  products={products}
                  value={productId}
                  placeholder="Pesquisar ou selecionar um produto..."
                  onChange={(value) => {
                    setProductId(value);
                    setVariantId("");
                    setManualCost("");
                    setAdjustment("0");
                  }}
                />
                {!loading && products.length === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Nenhum produto carregado.
                  </p>
                )}
              </div>
              <div className="md:col-span-4">
                <label className="mb-1 block text-sm font-medium">Variante</label>
                <Select value={variantId} onValueChange={setVariantId} disabled={!selectedProduct}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {selectedProduct?.node.variants.edges.map(v => (
                      <SelectItem key={v.node.id} value={v.node.id}>
                        {v.node.title} — R$ {parseFloat(v.node.price.amount).toFixed(2)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-4">
                <label className="mb-1 block text-sm font-medium">Modo de cálculo</label>
                <Select
                  value={calculationMode}
                  onValueChange={(value) => setCalculationMode(value as SubscriberPriceCalculationMode)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="automatic">Automático (custo real da Olist)</SelectItem>
                    <SelectItem value="manual">Informar custo manualmente</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {calculationMode === "automatic" ? (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Valor base do cliente</label>
                    <Input value={selectedCustomerPrice === null ? "" : `R$ ${selectedCustomerPrice.toFixed(2)}`} readOnly placeholder="Selecione a variante" />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Custo real (Olist)</label>
                    <Input
                      value={
                        realCost !== null
                          ? `R$ ${realCost.toFixed(2)}`
                          : estimatedCost === null
                            ? ""
                            : `R$ ${estimatedCost.toFixed(2)} (estimado)`
                      }
                      readOnly
                      placeholder="Selecione a variante"
                    />
                    {realCost === null && estimatedCost !== null && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Sem custo da Olist cadastrado — usando estimativa de 50% do valor.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium">Custo manual (R$)</label>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={manualCost}
                    onChange={(event) => setManualCost(event.target.value)}
                    placeholder="Ex: 50,00"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Use margem de 0% para manter o preço igual ao custo.
                  </p>
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium">Forma de reajuste</label>
                <Select value={adjustmentType} onValueChange={(value) => setAdjustmentType(value as SubscriberPriceAdjustment)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Margem em %</SelectItem>
                    <SelectItem value="amount">Acréscimo em R$</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {adjustmentType === "percentage" ? "Margem (%)" : "Acréscimo (R$)"}
                </label>
                <Input
                  type="number"
                  min="0"
                  step={adjustmentType === "percentage" ? "1" : "0.01"}
                  value={adjustment}
                  onChange={(event) => setAdjustment(event.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="rounded-lg bg-sky-50 p-3 md:col-span-4">
                <p className="text-xs font-medium text-sky-700">Preço calculado para o assinante</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-sky-700">
                  {calculatedSubscriberPrice === null ? "—" : `R$ ${calculatedSubscriberPrice.toFixed(2)}`}
                </p>
              </div>
              <div className="md:col-span-4">
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Salvar
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Produtos ({listedProducts.length})</CardTitle>
              <CardDescription>Todos os produtos do Shopify e seus preços para assinantes.</CardDescription>
            </div>
            <Select value={registrationFilter} onValueChange={(value) => setRegistrationFilter(value as SubscriberPriceFilter)}>
              <SelectTrigger className="h-9 w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="registered">Cadastrados</SelectItem>
                <SelectItem value="unregistered">Não cadastrados</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : listedProducts.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Nenhum produto neste filtro.</p>
          ) : (
            <Table className="[&_th]:h-9 [&_td]:py-2.5">
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="w-40">Status</TableHead>
                  <TableHead>Variante</TableHead>
                  <TableHead className="text-right">Valor base</TableHead>
                  <TableHead className="text-right">Custo real (Olist)</TableHead>
                  <TableHead className="text-right">Preço assinante</TableHead>
                  <TableHead className="w-28"><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listedProducts.map(product => {
                  const registeredPrice = priceByProductId.get(product.node.id);
                  const firstVariant = product.node.variants.edges[0]?.node;
                  const registeredVariant = registeredPrice
                    ? product.node.variants.edges.find(variant => variant.node.id === registeredPrice.shopify_variant_id)?.node
                    : null;
                  const displayedVariant = registeredVariant || firstVariant;
                  const productPrice = displayedVariant ? Number(displayedVariant.price.amount) : null;
                  const customerPrice = displayedVariant
                    ? customerPrices.find((row) => row.shopify_variant_id === displayedVariant.id)?.price ?? productPrice
                    : null;
                  const productImage = product.node.images.edges[0]?.node;
                  return (
                    <TableRow key={product.node.id}>
                      <TableCell>
                        <div className="flex min-w-[220px] items-center gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                            {productImage ? (
                              <img
                                src={productImage.url}
                                alt={productImage.altText || product.node.title}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <Package className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                          <span className="font-medium line-clamp-2">{product.node.title}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={cn(
                          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold",
                          registeredPrice ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
                        )}>
                          <span className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            registeredPrice ? "bg-emerald-500" : "bg-amber-500",
                          )} />
                          {registeredPrice ? "Cadastrado" : "Não cadastrado"}
                        </span>
                      </TableCell>
                      <TableCell>{displayedVariant?.title || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {customerPrice === null ? "—" : `R$ ${customerPrice.toFixed(2)}`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {displayedVariant && productCosts.has(displayedVariant.id)
                          ? `R$ ${productCosts.get(displayedVariant.id)!.toFixed(2)}`
                          : customerPrice === null
                            ? "—"
                            : `~R$ ${(customerPrice / 2).toFixed(2)}`}
                      </TableCell>
                      <TableCell className="text-right">
                        {registeredPrice ? (
                          editingPriceId === registeredPrice.id ? (
                            <div className="ml-auto flex w-36 items-center gap-2">
                              <span className="text-sm text-muted-foreground">R$</span>
                              <Input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={editingPrice}
                                onChange={(event) => setEditingPrice(event.target.value)}
                                disabled={updatingPrice}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") handleUpdatePrice(registeredPrice);
                                  if (event.key === "Escape") cancelEditingPrice();
                                }}
                                className="h-8 text-right font-bold"
                                autoFocus
                                aria-label={`Novo preço de ${product.node.title}`}
                              />
                            </div>
                          ) : (
                            <span className="font-bold text-sky-600 tabular-nums">
                              R$ {Number(registeredPrice.subscriber_price).toFixed(2)}
                            </span>
                          )
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {registeredPrice ? (
                          <div className="flex justify-end">
                            {editingPriceId === registeredPrice.id ? (
                              <>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600" onClick={() => handleUpdatePrice(registeredPrice)} disabled={updatingPrice} aria-label="Salvar novo preço">
                                  {updatingPrice ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={cancelEditingPrice} disabled={updatingPrice} aria-label="Cancelar edição">
                                  <X className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEditingPrice(registeredPrice)} aria-label={`Editar preço de ${product.node.title}`}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(registeredPrice.id)} aria-label={`Excluir preço de ${product.node.title}`}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </>
                            )}
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!firstVariant}
                            onClick={() => {
                              setProductId(product.node.id);
                              setVariantId(firstVariant?.id || "");
                              setManualCost("");
                              setAdjustment("0");
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                          >
                            Cadastrar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="hidden" aria-hidden="true">
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Já cadastrados ({prices.length})</CardTitle>
          <CardDescription>Produtos que já possuem preço exclusivo para assinantes.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : prices.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Nenhum preço cadastrado.</p>
          ) : (
            <Table className="[&_th]:h-9 [&_td]:py-2.5">
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Variante</TableHead>
                  <TableHead className="text-right">Shopify</TableHead>
                  <TableHead className="text-right">Custo estimado</TableHead>
                  <TableHead className="text-right">Preço assinante</TableHead>
                  <TableHead className="w-24"><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prices.map(sp => {
                  const info = variantInfo(sp);
                  return (
                    <TableRow key={sp.id}>
                      <TableCell>
                        <div className="flex min-w-[220px] items-center gap-3">
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                            {info.productImage ? (
                              <img
                                src={info.productImage.url}
                                alt={info.productImage.altText || info.productTitle}
                                className="h-full w-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <Package className="h-5 w-5 text-muted-foreground" />
                            )}
                          </div>
                          <span className="font-medium line-clamp-2">{info.productTitle}</span>
                        </div>
                      </TableCell>
                      <TableCell>{info.variantTitle}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {info.shopifyPrice === null ? "—" : `R$ ${info.shopifyPrice.toFixed(2)}`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {info.shopifyPrice === null ? "—" : `R$ ${(info.shopifyPrice / 2).toFixed(2)}`}
                      </TableCell>
                      <TableCell className="text-right">
                        {editingPriceId === sp.id ? (
                          <div className="ml-auto flex w-36 items-center gap-2">
                            <span className="text-sm text-muted-foreground">R$</span>
                            <Input
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={editingPrice}
                              onChange={(event) => setEditingPrice(event.target.value)}
                              disabled={updatingPrice}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") handleUpdatePrice(sp);
                                if (event.key === "Escape") cancelEditingPrice();
                              }}
                              className="h-8 text-right font-bold"
                              autoFocus
                              aria-label={`Novo preço de ${info.productTitle}`}
                            />
                          </div>
                        ) : (
                          <span className="font-bold text-sky-600 tabular-nums">
                            R$ {Number(sp.subscriber_price).toFixed(2)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end">
                          {editingPriceId === sp.id ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-emerald-600 hover:text-emerald-700"
                                onClick={() => handleUpdatePrice(sp)}
                                disabled={updatingPrice}
                                aria-label="Salvar novo preço"
                              >
                                {updatingPrice ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={cancelEditingPrice}
                                disabled={updatingPrice}
                                aria-label="Cancelar edição"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => startEditingPrice(sp)}
                                aria-label={`Editar preço de ${info.productTitle}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleDelete(sp.id)}
                                aria-label={`Excluir preço de ${info.productTitle}`}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MembersTab() {
  const [members, setMembers] = useState<Member[]>([]);
  const [profileNamesByEmail, setProfileNamesByEmail] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [memberRows, profileRows] = await Promise.all([
      fetchAllRowsResult<Member>("club_members", "*", {
        orderBy: [{ column: "created_at", ascending: false }, "id"],
      }),
      fetchAllRowsResult<{ email: string | null; name: string | null }>("profiles", "user_id, email, name", {
        orderBy: "user_id",
      }),
    ]);
    if (memberRows.error) toast.error("Erro ao carregar membros");
    if (profileRows.error) toast.error("Erro ao carregar nomes dos perfis");

    const names = new Map<string, string>();
    (profileRows.data || []).forEach((profile: { email: string | null; name: string | null }) => {
      if (profile.email && profile.name) names.set(profile.email.toLowerCase(), profile.name);
    });

    setProfileNamesByEmail(names);
    setMembers((memberRows.data || []) as Member[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!email.trim()) return toast.error("E-mail obrigatório");
    setSaving(true);
    const normalizedEmail = email.trim().toLowerCase();
    let memberName = name.trim() || null;
    if (!memberName) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("name")
        .eq("email", normalizedEmail)
        .maybeSingle();
      memberName = profile?.name || null;
    }
    const { error } = await supabase.from("club_members").insert({
      email: normalizedEmail,
      name: memberName,
    });
    setSaving(false);
    if (error) return toast.error("Erro: " + error.message);
    toast.success("Membro adicionado");
    setEmail(""); setName("");
    load();
  };

  const toggleActive = async (m: Member) => {
    const { error } = await supabase.from("club_members").update({ is_active: !m.is_active }).eq("id", m.id);
    if (error) return toast.error("Erro ao atualizar");
    setMembers(members.map(x => x.id === m.id ? { ...x, is_active: !m.is_active } : x));
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("club_members").delete().eq("id", id);
    if (error) return toast.error("Erro ao excluir");
    setMembers(members.filter(m => m.id !== id));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Adicionar membro do clube</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">E-mail</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@email.com" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Nome (opcional)</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do cliente" />
          </div>
          <div className="flex items-end">
            <Button onClick={handleAdd} disabled={saving} className="w-full">
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Membros ({members.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : members.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Nenhum membro cadastrado.</p>
          ) : (
            <Table className="[&_th]:h-9 [&_td]:py-2.5">
              <TableHeader>
                <TableRow>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.email}</TableCell>
                    <TableCell>{m.name || profileNamesByEmail.get(m.email.toLowerCase()) || "—"}</TableCell>
                    <TableCell>
                      <button
                        onClick={() => toggleActive(m)}
                        className={`text-xs font-bold px-2 py-1 rounded-full ${m.is_active ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}
                      >
                        {m.is_active ? "Ativo" : "Inativo"}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(m.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface ProfileRow {
  id: string;
  user_id: string;
  email: string | null;
  name: string | null;
  created_at: string;
  is_franchisee?: boolean | null;
}

type FranchisePaymentSetting = {
  paymentScheduleType: "days_after_order" | "fixed_day_next_month";
  paymentTermDays: number;
  paymentDueDay: number | null;
};

const defaultFranchisePaymentSetting = (): FranchisePaymentSetting => ({
  paymentScheduleType: "days_after_order",
  paymentTermDays: 7,
  paymentDueDay: null,
});

function UsersTab() {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [subscriberIds, setSubscriberIds] = useState<Set<string>>(new Set());
  const [memberEmails, setMemberEmails] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [search, setSearch] = useState("");
  const [togglingEmail, setTogglingEmail] = useState<string | null>(null);
  const [franchiseTerms, setFranchiseTerms] = useState<Record<string, FranchisePaymentSetting>>({});
  const [savingTermId, setSavingTermId] = useState<string | null>(null);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    const [p, s, m, franchiseSettings] = await Promise.all([
      fetchAllRowsResult<ProfileRow>("profiles", "*", {
        orderBy: [{ column: "created_at", ascending: false }, "user_id"],
      }),
      fetchAllRowsResult<{ user_id: string; status: string }>("subscribers", "id, user_id, status", { orderBy: "id" }),
      fetchAllRowsResult<{ email: string; is_active: boolean }>("club_members", "id, email, is_active", { orderBy: "id" }),
      supabase.functions.invoke("admin-franchise-settings", { body: { action: "list" } }),
    ]);
    if (p.error && !silent) toast.error("Erro ao carregar usuários");
    setProfiles((p.data || []) as ProfileRow[]);
    const ids = new Set<string>();
    (s.data || []).forEach((row) => {
      if (row.status === "active") ids.add(row.user_id);
    });
    setSubscriberIds(ids);
    const emails = new Set<string>();
    (m.data || []).forEach((row) => {
      if (row.is_active && row.email) emails.add(row.email.toLowerCase());
    });
    setMemberEmails(emails);
    const terms: Record<string, FranchisePaymentSetting> = {};
    for (const account of franchiseSettings.data?.accounts || []) {
      const termDays = Number(account.payment_term_days);
      const dueDay = Number(account.payment_due_day);
      terms[String(account.user_id)] = {
        paymentScheduleType: account.payment_schedule_type === "fixed_day_next_month"
          ? "fixed_day_next_month"
          : "days_after_order",
        paymentTermDays: Number.isInteger(termDays) && termDays >= 1 && termDays <= 365 ? termDays : 7,
        paymentDueDay: Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31 ? dueDay : null,
      };
    }
    setFranchiseTerms(terms);
    if (!silent) setLoading(false);
  };

  useEffect(() => {
    load();
    const onFocus = () => load(true);
    window.addEventListener("focus", onFocus);
    const channel = supabase
      .channel("admin-users-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "subscribers" }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "club_members" }, () => load(true))
      .subscribe();
    return () => {
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, []);

  const startEdit = (p: ProfileRow) => {
    setEditId(p.id);
    setEditName(p.name || "");
  };

  const saveEdit = async (p: ProfileRow) => {
    const { error } = await supabase.from("profiles").update({ name: editName.trim() || null }).eq("id", p.id);
    if (error) return toast.error("Erro ao salvar");
    toast.success("Nome atualizado");
    setProfiles(profiles.map(x => x.id === p.id ? { ...x, name: editName.trim() || null } : x));
    setEditId(null);
  };

  const toggleMembership = async (p: ProfileRow) => {
    if (!p.email) return toast.error("Usuário sem e-mail");
    const email = p.email.toLowerCase();
    setTogglingEmail(email);
    const isMember = memberEmails.has(email);
    if (isMember) {
      const { error } = await supabase.from("club_members").delete().eq("email", email);
      if (error) { setTogglingEmail(null); return toast.error("Erro: " + error.message); }
      const next = new Set(memberEmails); next.delete(email); setMemberEmails(next);
      toast.success("Removido do clube");
    } else {
      const { error } = await supabase.from("club_members").insert({
        email, name: p.name, is_active: true,
      });
      if (error) { setTogglingEmail(null); return toast.error("Erro: " + error.message); }
      const next = new Set(memberEmails); next.add(email); setMemberEmails(next);
      toast.success("Adicionado ao clube 👑");
    }
    setTogglingEmail(null);
  };

  const toggleFranchisee = async (p: ProfileRow) => {
    const next = !p.is_franchisee;
    const { error } = await supabase.from("profiles").update({ is_franchisee: next }).eq("id", p.id);
    if (error) return toast.error("Erro: " + error.message);
    setProfiles((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_franchisee: next } : x)));
    toast.success(next ? "Marcado como franqueado" : "Franquia removida");
  };

  const updateFranchiseTerm = async (p: ProfileRow) => {
    const setting = franchiseTerms[p.user_id] || defaultFranchisePaymentSetting();
    setSavingTermId(p.user_id);
    const { data, error } = await supabase.functions.invoke("admin-franchise-settings", {
      body: {
        action: "update_payment_term",
        userId: p.user_id,
        paymentTermDays: setting.paymentTermDays,
        paymentScheduleType: setting.paymentScheduleType,
        paymentDueDay: setting.paymentDueDay,
      },
    });
    setSavingTermId(null);
    if (error || data?.error) return toast.error(data?.error || "Erro ao atualizar o prazo");
    toast.success(setting.paymentScheduleType === "fixed_day_next_month"
      ? `Vencimento atualizado para todo dia ${setting.paymentDueDay}`
      : `Prazo atualizado para ${setting.paymentTermDays} dias`);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(p =>
      (p.email || "").toLowerCase().includes(q) ||
      (p.name || "").toLowerCase().includes(q)
    );
  }, [profiles, search]);

  const hasActivePlan = (profile: ProfileRow) =>
    subscriberIds.has(profile.user_id) ||
    memberEmails.has((profile.email || "").toLowerCase());
  const totalWithPlan = profiles.filter(hasActivePlan).length;
  const totalWithoutPlan = profiles.length - totalWithPlan;
  const totalFranchisees = profiles.filter((profile) => profile.is_franchisee).length;

  return (
    <Card>
      <CardHeader className="p-4 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Usuários cadastrados</CardTitle>
            <CardDescription className="mt-0.5">
              Informações sincronizadas com as contas e planos da plataforma.
            </CardDescription>
          </div>
          <Input
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full sm:w-64"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 pt-2 sm:flex sm:flex-wrap">
          {[
            { label: "Total", value: profiles.length },
            { label: "Com plano", value: totalWithPlan },
            { label: "Sem plano", value: totalWithoutPlan },
            { label: "Franqueados", value: totalFranchisees },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border bg-muted/60 px-3 py-2 sm:min-w-28">
              <p className="text-lg font-extrabold tabular-nums text-primary">{item.value}</p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</p>
            </div>
          ))}
        </div>
        {search.trim() && (
          <p className="pt-1 text-xs text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "resultado encontrado" : "resultados encontrados"}
          </p>
        )}
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">Nenhum usuário encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
          <Table className="min-w-[880px] [&_th]:h-9 [&_td]:py-2">
            <TableHeader>
              <TableRow>
                <TableHead>E-mail</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Condição da franquia</TableHead>
                <TableHead>Cadastrado em</TableHead>
                <TableHead className="w-24">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(p => {
                const hasPlan = subscriberIds.has(p.user_id);
                const isMember = memberEmails.has((p.email || "").toLowerCase());
                const editing = editId === p.id;
                const paymentSetting = franchiseTerms[p.user_id] || defaultFranchisePaymentSetting();
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.email || "—"}</TableCell>
                    <TableCell>
                      {editing ? (
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="h-8"
                          autoFocus
                        />
                      ) : (
                        p.name || <span className="text-muted-foreground italic">sem nome</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {hasPlan ? (
                        <span className="text-xs font-bold px-2 py-1 rounded-full bg-sky-100 text-sky-700">
                          Assinante
                        </span>
                      ) : isMember ? (
                        <span className="text-xs font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700 inline-flex items-center gap-1">
                          <Crown className="h-3 w-3" /> Clube
                        </span>
                      ) : (
                        <span className="text-xs font-bold px-2 py-1 rounded-full bg-muted text-muted-foreground">
                          Sem plano
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.is_franchisee ? (
                        <div className="flex min-w-[330px] items-center gap-2">
                          <Select
                            value={paymentSetting.paymentScheduleType}
                            onValueChange={(value: FranchisePaymentSetting["paymentScheduleType"]) => {
                              setFranchiseTerms((current) => ({
                                ...current,
                                [p.user_id]: {
                                  ...paymentSetting,
                                  paymentScheduleType: value,
                                  paymentDueDay: value === "fixed_day_next_month"
                                    ? paymentSetting.paymentDueDay || 10
                                    : null,
                                },
                              }));
                            }}
                            disabled={savingTermId === p.user_id}
                          >
                            <SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="days_after_order">Dias após compra</SelectItem>
                              <SelectItem value="fixed_day_next_month">Dia fixo/mês seguinte</SelectItem>
                            </SelectContent>
                          </Select>
                          <Input
                            type="number"
                            min={1}
                            max={paymentSetting.paymentScheduleType === "fixed_day_next_month" ? 31 : 365}
                            value={paymentSetting.paymentScheduleType === "fixed_day_next_month"
                              ? paymentSetting.paymentDueDay || 10
                              : paymentSetting.paymentTermDays}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              setFranchiseTerms((current) => ({
                                ...current,
                                [p.user_id]: paymentSetting.paymentScheduleType === "fixed_day_next_month"
                                  ? { ...paymentSetting, paymentDueDay: value }
                                  : { ...paymentSetting, paymentTermDays: value },
                              }));
                            }}
                            className="h-8 w-20"
                            aria-label={paymentSetting.paymentScheduleType === "fixed_day_next_month"
                              ? "Dia fixo de vencimento"
                              : "Dias após a compra"}
                          />
                          <span className="whitespace-nowrap text-xs text-muted-foreground">
                            {paymentSetting.paymentScheduleType === "fixed_day_next_month" ? "do próximo mês" : "dias"}
                          </span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={() => void updateFranchiseTerm(p)}
                            disabled={savingTermId === p.user_id}
                            title="Salvar condição de pagamento"
                          >
                            {savingTermId === p.user_id
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <Check className="h-4 w-4" />}
                          </Button>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(p.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {editing ? (
                          <>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => saveEdit(p)}>
                              <Check className="h-4 w-4 text-emerald-600" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditId(null)}>
                              <X className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(p)} title="Editar nome">
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant={isMember ? "outline" : "default"}
                              size="sm"
                              disabled={!p.email || togglingEmail === (p.email || "").toLowerCase()}
                              onClick={() => toggleMembership(p)}
                              className="h-8 gap-1"
                            >
                              {togglingEmail === (p.email || "").toLowerCase() ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Crown className="h-3 w-3" />
                              )}
                              {isMember ? "Remover" : "Membro"}
                            </Button>
                            <Button
                              variant={p.is_franchisee ? "outline" : "secondary"}
                              size="sm"
                              onClick={() => toggleFranchisee(p)}
                              className="h-8 gap-1"
                              title={p.is_franchisee ? "Remover franqueado" : "Marcar como franqueado"}
                            >
                              <Store className="h-3 w-3" />
                              {p.is_franchisee ? "Franq. ✓" : "Franquia"}
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ReferralCodeRow {
  id: string;
  code: string;
  employee_name: string;
  active: boolean;
  created_at: string;
}

interface ReferralUsageRow {
  id: string;
  email: string | null;
  name: string | null;
  referral_code: string | null;
  acquisition_source: string | null;
  created_at: string;
}

function ReferralCodesTab() {
  const [codes, setCodes] = useState<ReferralCodeRow[]>([]);
  const [usages, setUsages] = useState<ReferralUsageRow[]>([]);
  const [employeeName, setEmployeeName] = useState("");
  const [code, setCode] = useState("");
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    const [codeRows, profileRows] = await Promise.all([
      fetchAllRowsResult("employee_referral_codes", "*", {
        orderBy: [{ column: "created_at", ascending: false }, "id"],
      }),
      fetchAllRowsResult("profiles", "id, email, name, referral_code, acquisition_source, created_at", {
        orderBy: [{ column: "created_at", ascending: false }, "id"],
        filter: (query) => query.eq("acquisition_source", "recomendacao").not("referral_code", "is", null),
      }),
    ]);

    if (codeRows.error) toast.error("Erro ao carregar códigos: " + codeRows.error.message);
    if (profileRows.error) toast.error("Erro ao carregar usos: " + profileRows.error.message);

    setCodes((codeRows.data || []) as ReferralCodeRow[]);
    setUsages((profileRows.data || []) as ReferralUsageRow[]);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
  }, []);

  const usageCountByCode = useMemo(() => {
    const map = new Map<string, number>();
    usages.forEach((usage) => {
      if (!usage.referral_code) return;
      const normalized = usage.referral_code.toUpperCase();
      map.set(normalized, (map.get(normalized) || 0) + 1);
    });
    return map;
  }, [usages]);

  const selectedUsages = useMemo(() => {
    if (!selectedCode) return [];
    return usages.filter((usage) => usage.referral_code?.toUpperCase() === selectedCode);
  }, [selectedCode, usages]);

  const monthlyUsage = useMemo(() => {
    const map = new Map<string, number>();
    selectedUsages.forEach((usage) => {
      const date = new Date(usage.created_at);
      const label = date.toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
      });
      map.set(label, (map.get(label) || 0) + 1);
    });
    return Array.from(map.entries()).map(([month, total]) => ({ month, total }));
  }, [selectedUsages]);

  const handleCreate = async () => {
    const normalizedCode = code.trim().toUpperCase();
    if (!employeeName.trim() || !normalizedCode) {
      toast.error("Informe o nome do funcionário e o código.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.from("employee_referral_codes").insert({
      employee_name: employeeName.trim(),
      code: normalizedCode,
    });
    setSaving(false);

    if (error) {
      toast.error("Erro ao cadastrar código: " + error.message);
      return;
    }

    toast.success("Código cadastrado");
    setEmployeeName("");
    setCode("");
    setSelectedCode(normalizedCode);
    loadAll();
  };

  const toggleActive = async (item: ReferralCodeRow) => {
    const { error } = await supabase
      .from("employee_referral_codes")
      .update({ active: !item.active })
      .eq("id", item.id);
    if (error) {
      toast.error("Erro ao atualizar código");
      return;
    }
    loadAll();
  };

  const removeCode = async (item: ReferralCodeRow) => {
    if (!confirm(`Remover o código ${item.code}?`)) return;
    const { error } = await supabase
      .from("employee_referral_codes")
      .delete()
      .eq("id", item.id);
    if (error) {
      toast.error("Erro ao remover código");
      return;
    }
    if (selectedCode === item.code) setSelectedCode(null);
    loadAll();
  };

  const selectedCodeInfo = codes.find((item) => item.code === selectedCode);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cadastrar código de funcionário</CardTitle>
          <CardDescription>
            Use este código no cadastro por recomendação ou no final da compra para atribuir a venda.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_220px_auto]">
          <div>
            <label className="mb-1 block text-sm font-medium">Funcionário</label>
            <Input
              value={employeeName}
              onChange={(event) => setEmployeeName(event.target.value)}
              placeholder="Nome do funcionário"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Código</label>
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="Ex: MARIA10"
              className="uppercase"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={handleCreate} disabled={saving} className="w-full">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cadastrar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Códigos cadastrados ({codes.length})</CardTitle>
            <CardDescription>Clique no código para ver meses e pessoas que utilizaram.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : codes.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">Nenhum código cadastrado.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead>
                    <TableHead>Funcionário</TableHead>
                    <TableHead className="text-right">Usos</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codes.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <button
                          onClick={() => setSelectedCode(item.code)}
                          className={`rounded-md px-2 py-1 font-mono text-sm font-bold transition ${
                            selectedCode === item.code
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-foreground hover:bg-primary/10"
                          }`}
                        >
                          {item.code}
                        </button>
                      </TableCell>
                      <TableCell className="font-medium">{item.employee_name}</TableCell>
                      <TableCell className="text-right font-bold">
                        {usageCountByCode.get(item.code) || 0}
                      </TableCell>
                      <TableCell>
                        <button
                          onClick={() => toggleActive(item)}
                          className={`rounded-full px-2 py-1 text-xs font-bold ${
                            item.active
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {item.active ? "Ativo" : "Inativo"}
                        </button>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => removeCode(item)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {selectedCode ? `Usos do código ${selectedCode}` : "Usos do código"}
            </CardTitle>
            <CardDescription>
              {selectedCodeInfo
                ? `Funcionário: ${selectedCodeInfo.employee_name}`
                : "Selecione um código na tabela."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!selectedCode ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Clique em um código para ver o histórico.
              </p>
            ) : (
              <>
                <div>
                  <h3 className="mb-2 text-sm font-bold">Por mês</h3>
                  {monthlyUsage.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum uso registrado.</p>
                  ) : (
                    <div className="space-y-2">
                      {monthlyUsage.map((item) => (
                        <div
                          key={item.month}
                          className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm"
                        >
                          <span className="capitalize">{item.month}</span>
                          <span className="font-bold">{item.total}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-bold">Pessoas que utilizaram</h3>
                  {selectedUsages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma pessoa usou este código ainda.</p>
                  ) : (
                    <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                      {selectedUsages.map((usage) => (
                        <div key={usage.id} className="rounded-lg border p-3 text-sm">
                          <p className="font-bold">{usage.name || usage.email || "Cliente sem nome"}</p>
                          {usage.email && (
                            <p className="break-all text-xs text-muted-foreground">{usage.email}</p>
                          )}
                          <p className="mt-1 text-xs text-muted-foreground">
                            {new Date(usage.created_at).toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface ProductContent {
  id: string;
  shopify_product_id: string;
  description: string | null;
  specifications: string | null;
}

function ContentTab() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [contents, setContents] = useState<ProductContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productId, setProductId] = useState("");
  const [description, setDescription] = useState("");
  const [specifications, setSpecifications] = useState("");
  const [searchProduct, setSearchProduct] = useState("");
  const [descriptionFilter, setDescriptionFilter] = useState<"all" | "missing" | "filled">("all");

  const loadAll = async () => {
    setLoading(true);
    try {
      const [shop, cnt] = await Promise.all([
        fetchAllShopifyProducts(),
        fetchAllRows<ProductContent & { updated_at: string }>("product_content", "*", { orderBy: "id" })
          .then((rows) => rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))),
      ]);
      setProducts(shop);
      setContents(cnt);
    } catch (e) {
      toast.error("Erro ao carregar dados");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  // When product changes, load existing content if any
  useEffect(() => {
    if (!productId) {
      setDescription("");
      setSpecifications("");
      return;
    }
    const existing = contents.find(c => c.shopify_product_id === productId);
    setDescription(existing?.description || "");
    setSpecifications(existing?.specifications || "");
  }, [productId, contents]);

  const selectedProduct = useMemo(
    () => products.find(p => p.node.id === productId),
    [products, productId]
  );

  const handleSave = async () => {
    if (!productId) {
      toast.error("Selecione um produto");
      return;
    }
    setSaving(true);
    const existing = contents.find(c => c.shopify_product_id === productId);
    const payload = {
      shopify_product_id: productId,
      description: description.trim() || null,
      specifications: specifications.trim() || null,
    };
    const { error } = existing
      ? await supabase.from("product_content").update(payload).eq("id", existing.id)
      : await supabase.from("product_content").insert(payload);
    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    toast.success("Conteúdo salvo!");
    loadAll();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("product_content").delete().eq("id", id);
    if (error) return toast.error("Erro ao excluir");
    toast.success("Removido");
    setContents(contents.filter(c => c.id !== id));
    if (selectedProduct && contents.find(c => c.id === id)?.shopify_product_id === productId) {
      setDescription("");
      setSpecifications("");
    }
  };

  const productById = useMemo(() => {
    const map = new Map<string, ShopifyProduct["node"]>();
    products.forEach(p => map.set(p.node.id, p.node));
    return map;
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchProduct.trim().toLowerCase();
    const productsWithDescription = new Set(
      contents
        .filter((content) => Boolean(content.description?.trim()))
        .map((content) => content.shopify_product_id),
    );

    return products.filter((product) => {
      const matchesSearch = !q || product.node.title.toLowerCase().includes(q);
      const hasDescription = productsWithDescription.has(product.node.id);
      const matchesDescription = descriptionFilter === "all"
        || (descriptionFilter === "missing" && !hasDescription)
        || (descriptionFilter === "filled" && hasDescription);
      return matchesSearch && matchesDescription;
    });
  }, [products, contents, searchProduct, descriptionFilter]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Editar conteúdo do produto</CardTitle>
          <CardDescription>
            O conteúdo aqui aparece em "Sobre o produto" na página de detalhes, substituindo o que vem da Shopify.
            Use uma linha por item. Termine uma linha com ":" para criar um título. Linhas iniciadas com "-" viram itens de lista.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <div className="grid gap-4 md:grid-cols-[150px_1fr]">
            {/* Preview */}
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3">
              <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-muted">
                {selectedProduct?.node.images.edges[0]?.node ? (
                  <img
                    src={selectedProduct.node.images.edges[0].node.url}
                    alt={selectedProduct.node.images.edges[0].node.altText || selectedProduct.node.title || ""}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <Package className="h-8 w-8 text-muted-foreground" />
                )}
              </div>
              <p className="min-h-[2.4em] text-xs font-bold line-clamp-2">
                {selectedProduct?.node.title || "Selecione um produto"}
              </p>
            </div>

            {/* Form */}
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
                <div>
                  <label className="mb-1 block text-sm font-medium">Buscar produto</label>
                  <Input
                    placeholder="Digite o nome do produto..."
                    value={searchProduct}
                    onChange={(e) => setSearchProduct(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Filtrar por descrição</label>
                  <Select
                    value={descriptionFilter}
                    onValueChange={(value: "all" | "missing" | "filled") => {
                      setDescriptionFilter(value);
                      setProductId("");
                    }}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os produtos</SelectItem>
                      <SelectItem value="missing">Sem descrição</SelectItem>
                      <SelectItem value="filled">Com descrição</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="block text-sm font-medium">Produto</label>
                  <span className="text-xs text-muted-foreground">{filteredProducts.length} encontrado(s)</span>
                </div>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {filteredProducts.map(p => (
                      <SelectItem key={p.node.id} value={p.node.id}>{p.node.title}</SelectItem>
                    ))}
                    {filteredProducts.length === 0 && (
                      <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                        Nenhum produto encontrado
                      </div>
                    )}
                  </SelectContent>
                </Select>
              </div>
              {selectedProduct && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm font-medium text-blue-900 mb-2">Variações:</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedProduct.node.variants.edges.map((variant) => (
                      <span key={variant.node.id} className="text-xs bg-white border border-blue-300 rounded px-2 py-1 text-blue-800">
                        {variant.node.title}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium">Descrição</label>
                <FormattedTextarea
                  value={description}
                  onChange={setDescription}
                  placeholder={"Descrição:\nTexto descritivo do produto...\n\nBenefícios:\n- Benefício 1\n- Benefício 2"}
                  rows={8}
                  disabled={!productId}
                />
              </div>
              <Button onClick={handleSave} disabled={saving || !productId}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Salvar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Produtos com conteúdo personalizado ({contents.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : contents.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Nenhum conteúdo cadastrado.</p>
          ) : (
            <Table className="[&_th]:h-9 [&_td]:py-2.5">
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contents.map(c => {
                  const prod = productById.get(c.shopify_product_id);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{prod?.title || "Produto removido"}</TableCell>
                      <TableCell>{c.description ? "✓" : "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                            setProductId(c.shopify_product_id);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(c.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FormattedTextarea({
  value,
  onChange,
  placeholder,
  rows,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const wrap = (marker: string) => {
    const ta = ref.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end) || "texto";
    const next = value.slice(0, start) + marker + selected + marker + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + marker.length, start + marker.length + selected.length);
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => wrap("**")}>
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => wrap("*")}>
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground self-center ml-2">
          Use **negrito** e *itálico*
        </span>
      </div>
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
      />
    </div>
  );
}
