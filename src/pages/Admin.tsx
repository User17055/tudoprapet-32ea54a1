import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Loader2, Crown, Package, Users, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { storefrontApiRequest, PRODUCTS_QUERY, type ShopifyProduct } from "@/lib/shopify";

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

export default function Admin() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useIsAdmin();

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

  return (
    <div className="min-h-screen flex flex-col bg-muted/20">
      <Header />
      <main className="flex-1 container mx-auto py-8 px-4">
        <div className="mb-6">
          <h1 className="text-3xl font-display font-bold text-primary">Painel Administrativo</h1>
          <p className="text-muted-foreground">Gerencie preços do clube e membros assinantes.</p>
        </div>
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users"><Users className="h-4 w-4 mr-2" />Usuários</TabsTrigger>
            <TabsTrigger value="prices"><Package className="h-4 w-4 mr-2" />Preços do Clube</TabsTrigger>
            <TabsTrigger value="members"><Crown className="h-4 w-4 mr-2" />Membros</TabsTrigger>
          </TabsList>
          <TabsContent value="users" className="mt-4">
            <UsersTab />
          </TabsContent>
          <TabsContent value="prices" className="mt-4">
            <PricesTab />
          </TabsContent>
          <TabsContent value="members" className="mt-4">
            <MembersTab />
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
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

  const handleSave = async () => {
    if (!productId || !variantId || !price) {
      toast.error("Preencha todos os campos");
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Adicionar / atualizar preço de assinante</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="text-sm font-medium mb-1 block">Produto</label>
            <Select value={productId} onValueChange={(v) => { setProductId(v); setVariantId(""); }}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {products.map(p => (
                  <SelectItem key={p.node.id} value={p.node.id}>{p.node.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Variante</label>
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
            <label className="text-sm font-medium mb-1 block">Preço assinante (R$)</label>
            <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" />
          </div>
          <div className="md:col-span-4">
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Salvar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Preços cadastrados ({prices.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : prices.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nenhum preço cadastrado.</p>
          ) : (
            <Table>
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
                      <TableCell className="text-right text-sky-600 font-bold">R$ {sp.subscriber_price.toFixed(2)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(sp.id)}>
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
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("club_members").select("*").order("created_at", { ascending: false });
    if (error) toast.error("Erro ao carregar membros");
    setMembers((data || []) as Member[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!email.trim()) return toast.error("E-mail obrigatório");
    setSaving(true);
    const { error } = await supabase.from("club_members").insert({
      email: email.trim().toLowerCase(),
      name: name.trim() || null,
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
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Adicionar membro do clube</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="text-sm font-medium mb-1 block">E-mail</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@email.com" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Nome (opcional)</label>
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
        <CardHeader><CardTitle>Membros ({members.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : members.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nenhum membro cadastrado.</p>
          ) : (
            <Table>
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
                    <TableCell>{m.name || "—"}</TableCell>
                    <TableCell>
                      <button
                        onClick={() => toggleActive(m)}
                        className={`text-xs font-bold px-2 py-1 rounded-full ${m.is_active ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}
                      >
                        {m.is_active ? "Ativo" : "Inativo"}
                      </button>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(m.id)}>
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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Usuários cadastrados ({profiles.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Buscar por nome ou e-mail..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <p className="text-sm text-muted-foreground">
            {withoutPlan.length} sem plano · {filtered.length - withoutPlan.length} com plano ativo
          </p>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nenhum usuário encontrado.</p>
          ) : (
            <Table>
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
                              <Button variant="ghost" size="icon" onClick={() => saveEdit(p)}>
                                <Check className="h-4 w-4 text-emerald-600" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => setEditId(null)}>
                                <X className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button variant="ghost" size="icon" onClick={() => startEdit(p)} title="Editar nome">
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
    </div>
  );
}
