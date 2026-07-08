import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  type LucideIcon,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { storefrontApiRequest, PRODUCTS_QUERY, type ShopifyProduct } from "@/lib/shopify";
import logo from "@/assets/logo.png";
import DetailsTab from "./admin/DetailsTab";
import BannersTab from "./admin/BannersTab";
import CategoriesTab from "./admin/CategoriesTab";
import FeaturedTab from "./admin/FeaturedTab";
import RetiradaTab from "./admin/RetiradaTab";

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

type SectionId =
  | "users"
  | "members"
  | "prices"
  | "content"
  | "details"
  | "categories"
  | "banners"
  | "featured"
  | "referrals";

interface SectionDef {
  id: SectionId;
  label: string;
  description: string;
  icon: LucideIcon;
  component: ComponentType;
}

const NAV_GROUPS: { label: string; items: SectionDef[] }[] = [
  {
    label: "Clube",
    items: [
      { id: "users", label: "Usuários", description: "Contas cadastradas na loja e seus planos", icon: Users, component: UsersTab },
      { id: "members", label: "Membros", description: "Membros do clube com benefícios ativos", icon: Crown, component: MembersTab },
      { id: "prices", label: "Preços do Clube", description: "Preços exclusivos para assinantes", icon: Package, component: PricesTab },
      { id: "referrals", label: "Indicações", description: "Códigos de funcionários e usos por cliente", icon: Ticket, component: ReferralCodesTab },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { id: "content", label: "Conteúdo", description: "Descrições personalizadas dos produtos", icon: FileText, component: ContentTab },
      { id: "details", label: "Detalhes", description: "Categorias, marcas e atributos dos produtos", icon: Layers, component: DetailsTab },
      { id: "categories", label: "Ordem do Menu", description: "Ordem das categorias no menu do site", icon: ListTree, component: CategoriesTab },
    ],
  },
  {
    label: "Vitrine",
    items: [
      { id: "banners", label: "Banners", description: "Carrossel de banners da página inicial", icon: ImageIcon, component: BannersTab },
      { id: "featured", label: "Destaques", description: "Produtos em destaque na página inicial", icon: Star, component: FeaturedTab },
    ],
  },
];

const ALL_SECTIONS = NAV_GROUPS.flatMap((g) => g.items);

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useIsAdmin();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get("tab");
  const active = ALL_SECTIONS.find((s) => s.id === tabParam) ?? ALL_SECTIONS[0];
  const selectSection = (id: SectionId) => setSearchParams({ tab: id });

  if (!authLoading && !user) return <Navigate to="/login" replace />;
  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 container mx-auto py-16 text-center">
          <h1 className="text-2xl font-bold mb-2">Acesso restrito</h1>
          <p className="text-muted-foreground">Você não tem permissão para acessar este painel.</p>
        </main>
        <Footer />
      </div>
    );
  }

  const ActiveIcon = active.icon;
  const ActiveComponent = active.component;

  return (
    <div className="min-h-screen bg-muted/30">
      {/* Barra superior */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2.5 border-b bg-card px-4">
        <Link to="/" className="flex shrink-0 items-center gap-2">
          <img src={logo} alt="TudoPraPet" className="h-8 w-auto" />
          <span className="hidden font-display text-lg font-bold leading-none sm:block">
            Tudo<span className="text-primary">Pra</span>Pet
          </span>
        </Link>
        <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
          Admin
        </span>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden max-w-[220px] truncate text-xs text-muted-foreground md:block">
            {user?.email}
          </span>
          <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
            <Link to="/">
              <Store className="h-3.5 w-3.5" />
              Ver loja
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex">
        {/* Menu lateral (desktop) */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r bg-card px-3 py-5 lg:flex">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <nav className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = item.id === active.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => selectSection(item.id)}
                      className={cn(
                        "flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </nav>
            </div>
          ))}
        </aside>

        <div className="min-w-0 flex-1">
          {/* Navegação mobile */}
          <div className="sticky top-14 z-30 border-b bg-card lg:hidden">
            <div className="scrollbar-hide flex gap-1.5 overflow-x-auto px-3 py-2">
              {ALL_SECTIONS.map((item) => {
                const isActive = item.id === active.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => selectSection(item.id)}
                    className={cn(
                      "flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition-colors",
                      isActive
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground",
                    )}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <main className="mx-auto w-full max-w-5xl p-4 md:p-6">
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ActiveIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="font-display text-lg font-bold leading-tight">{active.label}</h1>
                <p className="truncate text-sm text-muted-foreground">{active.description}</p>
              </div>
            </div>
            <ActiveComponent />
          </main>
        </div>
      </div>
    </div>
  );
}

function PricesTab() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [prices, setPrices] = useState<SubPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [price, setPrice] = useState("");

  const loadAll = async () => {
    setLoading(true);
    try {
      const [shop, sub] = await Promise.all([
        storefrontApiRequest(PRODUCTS_QUERY, { first: 100 }),
        supabase.from("subscriber_prices").select("*").order("updated_at", { ascending: false }),
      ]);
      setProducts(shop?.data?.products?.edges || []);
      if (sub.error) throw sub.error;
      setPrices((sub.data || []) as SubPrice[]);
    } catch (e) {
      toast.error("Erro ao carregar dados");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const selectedProduct = useMemo(
    () => products.find(p => p.node.id === productId),
    [products, productId]
  );

  const registeredProductIds = useMemo(
    () => new Set(prices.map(p => p.shopify_product_id)),
    [prices]
  );

  const availableProducts = useMemo(
    () => products.filter(p => !registeredProductIds.has(p.node.id)),
    [products, registeredProductIds]
  );

  useEffect(() => {
    if (productId && registeredProductIds.has(productId)) {
      setProductId("");
      setVariantId("");
      setPrice("");
    }
  }, [productId, registeredProductIds]);

  const handleSave = async () => {
    if (!productId || !variantId || !price) {
      toast.error("Preencha todos os campos");
      return;
    }
    if (registeredProductIds.has(productId)) {
      toast.error("Este produto ja possui preco de assinante cadastrado.");
      setProductId("");
      setVariantId("");
      setPrice("");
      return;
    }
    const numeric = parseFloat(price.replace(",", "."));
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
    setProductId(""); setVariantId(""); setPrice("");
    loadAll();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("subscriber_prices").delete().eq("id", id);
    if (error) return toast.error("Erro ao excluir");
    toast.success("Removido");
    setPrices(prices.filter(p => p.id !== id));
  };

  const productById = useMemo(() => {
    const map = new Map<string, ShopifyProduct["node"]>();
    products.forEach(p => map.set(p.node.id, p.node));
    return map;
  }, [products]);

  const variantInfo = (sp: SubPrice) => {
    const prod = productById.get(sp.shopify_product_id);
    const variant = prod?.variants.edges.find(v => v.node.id === sp.shopify_variant_id);
    return { productTitle: prod?.title || "Produto removido", variantTitle: variant?.node.title || sp.shopify_variant_id };
  };

  const previewImage = selectedProduct?.node.images.edges[0]?.node;
  const previewVariant = selectedProduct?.node.variants.edges.find(v => v.node.id === variantId)?.node
    || selectedProduct?.node.variants.edges[0]?.node;
  const previewPrice = previewVariant ? parseFloat(previewVariant.price.amount) : null;
  const previewCompare = previewVariant?.compareAtPrice ? parseFloat(previewVariant.compareAtPrice.amount) : null;
  const previewSubscriber = price ? parseFloat(price.replace(",", ".")) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Adicionar preço de assinante</CardTitle>
          <CardDescription>Defina o preço exclusivo que membros do clube pagam.</CardDescription>
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
            <div className="grid content-start gap-3 md:grid-cols-3">
              <div className="md:col-span-3">
                <label className="mb-1 block text-sm font-medium">Produto</label>
                <Select value={productId} onValueChange={(v) => { setProductId(v); setVariantId(""); }}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {availableProducts.map(p => (
                      <SelectItem key={p.node.id} value={p.node.id}>{p.node.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!loading && availableProducts.length === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Todos os produtos carregados ja possuem preco de assinante cadastrado.
                  </p>
                )}
              </div>
              <div className="md:col-span-2">
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
              <div>
                <label className="mb-1 block text-sm font-medium">Preço assinante (R$)</label>
                <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" />
              </div>
              <div className="md:col-span-3">
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
          <CardTitle className="text-base">Preços cadastrados ({prices.length})</CardTitle>
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
                  <TableHead className="text-right">Preço assinante</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prices.map(sp => {
                  const info = variantInfo(sp);
                  return (
                    <TableRow key={sp.id}>
                      <TableCell className="font-medium">{info.productTitle}</TableCell>
                      <TableCell>{info.variantTitle}</TableCell>
                      <TableCell className="text-right font-bold text-sky-600">R$ {sp.subscriber_price.toFixed(2)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(sp.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
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
      supabase.from("club_members").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("email, name"),
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
}

function UsersTab() {
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [subscriberIds, setSubscriberIds] = useState<Set<string>>(new Set());
  const [memberEmails, setMemberEmails] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [search, setSearch] = useState("");
  const [togglingEmail, setTogglingEmail] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [p, s, m] = await Promise.all([
      supabase.from("profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("subscribers").select("user_id, status"),
      supabase.from("club_members").select("email, is_active"),
    ]);
    if (p.error) toast.error("Erro ao carregar usuários");
    setProfiles((p.data || []) as ProfileRow[]);
    const ids = new Set<string>();
    (s.data || []).forEach((row: any) => {
      if (row.status === "active") ids.add(row.user_id);
    });
    setSubscriberIds(ids);
    const emails = new Set<string>();
    (m.data || []).forEach((row: any) => {
      if (row.is_active && row.email) emails.add(row.email.toLowerCase());
    });
    setMemberEmails(emails);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(p =>
      (p.email || "").toLowerCase().includes(q) ||
      (p.name || "").toLowerCase().includes(q)
    );
  }, [profiles, search]);

  const withoutPlan = filtered.filter(p => !subscriberIds.has(p.user_id) && !memberEmails.has((p.email || "").toLowerCase()));

  return (
    <Card>
      <CardHeader className="p-4 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Usuários cadastrados ({profiles.length})</CardTitle>
            <CardDescription className="mt-0.5">
              {withoutPlan.length} sem plano · {filtered.length - withoutPlan.length} com plano ativo
            </CardDescription>
          </div>
          <Input
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full sm:w-64"
          />
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">Nenhum usuário encontrado.</p>
        ) : (
          <Table className="[&_th]:h-9 [&_td]:py-2">
            <TableHeader>
              <TableRow>
                <TableHead>E-mail</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Plano</TableHead>
                <TableHead>Cadastrado em</TableHead>
                <TableHead className="w-24">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(p => {
                const hasPlan = subscriberIds.has(p.user_id);
                const isMember = memberEmails.has((p.email || "").toLowerCase());
                const editing = editId === p.id;
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
      supabase
        .from("employee_referral_codes")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase
        .from("profiles")
        .select("id, email, name, referral_code, acquisition_source, created_at")
        .eq("acquisition_source", "recomendacao")
        .not("referral_code", "is", null)
        .order("created_at", { ascending: false }),
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
            Use este código quando o cliente escolher Recomendação no cadastro.
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

  const loadAll = async () => {
    setLoading(true);
    try {
      const [shop, cnt] = await Promise.all([
        storefrontApiRequest(PRODUCTS_QUERY, { first: 100 }),
        supabase.from("product_content").select("*").order("updated_at", { ascending: false }),
      ]);
      setProducts(shop?.data?.products?.edges || []);
      if (cnt.error) throw cnt.error;
      setContents((cnt.data || []) as ProductContent[]);
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
          <div>
            <label className="mb-1 block text-sm font-medium">Produto</label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {products.map(p => (
                  <SelectItem key={p.node.id} value={p.node.id}>{p.node.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Descrição</label>
            <FormattedTextarea
              value={description}
              onChange={setDescription}
              placeholder={"Descrição:\nTexto descritivo do produto...\n\nBenefícios:\n- Benefício 1\n- Benefício 2"}
              rows={10}
              disabled={!productId}
            />
          </div>
          <Button onClick={handleSave} disabled={saving || !productId}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Salvar
          </Button>
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
