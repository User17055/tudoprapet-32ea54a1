import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Trash2, Loader2, Plus, FolderTree, Tag, Package, X, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { storefrontApiRequest, PRODUCTS_QUERY, type ShopifyProduct } from "@/lib/shopify";
import { fetchAllShopifyProducts } from "@/lib/shopify";
import { STANDARD_ATTR_KEYS } from "@/lib/productAttributes";

interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
}

interface Brand {
  id: string;
  name: string;
  slug: string;
}

interface ProductCategoryLink {
  id: string;
  shopify_product_id: string;
  category_id: string;
}

interface ProductAttribute {
  id: string;
  shopify_product_id: string;
  attr_key: string;
  attr_value: string;
}

interface ProductContentRow {
  id: string;
  shopify_product_id: string;
  brand_id: string | null;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const categoryPath = (cat: Category, all: Category[]): string => {
  const parts: string[] = [cat.name];
  let cur = cat;
  const seen = new Set<string>([cur.id]);
  while (cur.parent_id) {
    const parent = all.find((c) => c.id === cur.parent_id);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    parts.unshift(parent.name);
    cur = parent;
  }
  return parts.join(" › ");
};

export default function DetailsTab() {
  return (
    <Tabs defaultValue="categories">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="categories"><FolderTree className="h-4 w-4 mr-2" />Categorias</TabsTrigger>
        <TabsTrigger value="brands"><Tag className="h-4 w-4 mr-2" />Marcas</TabsTrigger>
        <TabsTrigger value="values"><ListChecks className="h-4 w-4 mr-2" />Valores</TabsTrigger>
        <TabsTrigger value="assign"><Package className="h-4 w-4 mr-2" />Atribuir a produtos</TabsTrigger>
      </TabsList>
      <TabsContent value="categories" className="mt-4"><CategoriesPanel /></TabsContent>
      <TabsContent value="brands" className="mt-4"><BrandsPanel /></TabsContent>
      <TabsContent value="values" className="mt-4"><ValuesPanel /></TabsContent>
      <TabsContent value="assign" className="mt-4"><AssignPanel /></TabsContent>
    </Tabs>
  );
}

interface AttrValue { id: string; attr_key: string; attr_value: string; sort_order: number; }
interface AttrKey { id: string; name: string; sort_order: number; }

function ValuesPanel() {
  const [keys, setKeys] = useState<AttrKey[]>([]);
  const [items, setItems] = useState<AttrValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKeyName, setNewKeyName] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [value, setValue] = useState("");
  const [savingValue, setSavingValue] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: ks }, { data: vals }] = await Promise.all([
      supabase.from("attribute_keys").select("*").order("sort_order").order("name"),
      supabase.from("attribute_values").select("*").order("attr_key").order("sort_order").order("attr_value"),
    ]);
    setKeys((ks || []) as AttrKey[]);
    setItems((vals || []) as AttrValue[]);
    if (!selectedKey && ks && ks.length > 0) setSelectedKey((ks[0] as AttrKey).name);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAddKey = async () => {
    const name = newKeyName.trim();
    if (!name) return toast.error("Informe o título");
    setSavingKey(true);
    const { error } = await supabase.from("attribute_keys").insert({ name, sort_order: keys.length });
    setSavingKey(false);
    if (error) {
      if (error.code === "23505") return toast.error("Esse título já existe");
      return toast.error("Erro: " + error.message);
    }
    toast.success("Título criado");
    setNewKeyName("");
    setSelectedKey(name);
    load();
  };

  const handleDelKey = async (k: AttrKey) => {
    const used = items.some((i) => i.attr_key === k.name);
    const msg = used
      ? `Excluir o título "${k.name}"? Todos os valores cadastrados serão removidos.`
      : `Excluir o título "${k.name}"?`;
    if (!confirm(msg)) return;
    if (used) {
      await supabase.from("attribute_values").delete().eq("attr_key", k.name);
    }
    const { error } = await supabase.from("attribute_keys").delete().eq("id", k.id);
    if (error) return toast.error("Erro: " + error.message);
    if (selectedKey === k.name) setSelectedKey("");
    load();
  };

  const handleAddValue = async () => {
    if (!selectedKey) return toast.error("Selecione um título");
    if (!value.trim()) return toast.error("Informe o valor");
    setSavingValue(true);
    const { error } = await supabase.from("attribute_values").insert({
      attr_key: selectedKey,
      attr_value: value.trim(),
      sort_order: items.filter((i) => i.attr_key === selectedKey).length,
    });
    setSavingValue(false);
    if (error) {
      if (error.code === "23505") return toast.error("Esse valor já existe para esse título");
      return toast.error("Erro: " + error.message);
    }
    toast.success("Valor adicionado");
    setValue("");
    load();
  };

  const handleDelValue = async (id: string) => {
    const { error } = await supabase.from("attribute_values").delete().eq("id", id);
    if (error) return toast.error("Erro");
    load();
  };

  const valuesForSelected = items.filter((i) => i.attr_key === selectedKey);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Cadastrar título</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          <p className="text-xs text-muted-foreground mb-3">
            Crie os títulos dos atributos (ex.: Pet, Sabor, Tamanho, Idade). Depois, abaixo, adicione os valores de cada um.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Ex.: Pet"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddKey()}
            />
            <Button onClick={handleAddKey} disabled={savingKey}>
              {savingKey ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Adicionar título
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Cadastrar valores</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          {keys.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Cadastre um título acima para começar.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 items-end">
                <div className="w-[200px]">
                  <label className="text-xs font-medium mb-1 block">Título</label>
                  <Select value={selectedKey} onValueChange={setSelectedKey}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {keys.map((k) => (
                        <SelectItem key={k.id} value={k.name}>{k.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1 min-w-[180px]">
                  <label className="text-xs font-medium mb-1 block">Valor</label>
                  <Input
                    placeholder="Ex.: Cachorro"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddValue()}
                    disabled={!selectedKey}
                  />
                </div>
                <Button onClick={handleAddValue} disabled={savingValue || !selectedKey}>
                  {savingValue ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                  Adicionar
                </Button>
              </div>
              {selectedKey && (
                <div className="mt-4 border border-border rounded-lg p-3">
                  <div className="font-display font-bold text-sm mb-2">
                    Valores de "{selectedKey}" ({valuesForSelected.length})
                  </div>
                  {valuesForSelected.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum valor ainda.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {valuesForSelected.map((v) => (
                        <Badge key={v.id} variant="secondary" className="gap-1.5 pl-2 pr-1 py-1">
                          {v.attr_value}
                          <button onClick={() => handleDelValue(v.id)} className="hover:text-destructive">
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Títulos cadastrados ({keys.length})</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : keys.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum título cadastrado.</p>
          ) : (
            <div className="space-y-2">
              {keys.map((k) => {
                const count = items.filter((i) => i.attr_key === k.name).length;
                return (
                  <div
                    key={k.id}
                    className="flex items-center justify-between border border-border rounded-lg px-3 py-2"
                  >
                    <button
                      onClick={() => setSelectedKey(k.name)}
                      className="flex items-center gap-2 text-left flex-1 hover:text-primary"
                    >
                      <span className="font-medium">{k.name}</span>
                      <span className="text-xs text-muted-foreground">{count} valor{count !== 1 ? "es" : ""}</span>
                    </button>
                    <Button variant="ghost" size="icon" onClick={() => handleDelKey(k)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CategoriesPanel() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string>("none");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .order("sort_order")
      .order("name");
    if (error) toast.error("Erro ao carregar categorias");
    setCategories((data || []) as Category[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!name.trim()) return toast.error("Informe o nome");
    setSaving(true);
    const { error } = await supabase.from("categories").insert({
      name: name.trim(),
      slug: slugify(name),
      parent_id: parentId === "none" ? null : parentId,
    });
    setSaving(false);
    if (error) return toast.error("Erro: " + error.message);
    toast.success("Categoria criada");
    setName("");
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir essa categoria? Subcategorias também serão removidas.")) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) return toast.error("Erro: " + error.message);
    toast.success("Removida");
    load();
  };

  // tree render
  const childrenOf = (pid: string | null) =>
    categories.filter((c) => c.parent_id === pid).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  const renderTree = (pid: string | null, depth = 0): JSX.Element[] =>
    childrenOf(pid).flatMap((c) => [
      <div
        key={c.id}
        className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 border-l-2"
        style={{ marginLeft: depth * 16, borderLeftColor: depth === 0 ? "hsl(var(--primary))" : "hsl(var(--border))" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium truncate">{c.name}</span>
          <span className="text-xs text-muted-foreground truncate">/{c.slug}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>,
      ...renderTree(c.id, depth + 1),
    ]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Nova categoria</CardTitle></CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0 md:grid-cols-[1fr_1fr_auto]">
          <div>
            <label className="text-sm font-medium mb-1 block">Nome</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Ração Seca" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Categoria pai (opcional)</label>
            <Select value={parentId} onValueChange={setParentId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— Nenhuma (raiz)</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{categoryPath(c, categories)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={handleAdd} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Árvore de categorias ({categories.length})</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : categories.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nenhuma categoria. Crie a primeira acima.</p>
          ) : (
            <div className="space-y-1">{renderTree(null)}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function BrandsPanel() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("brands").select("*").order("name");
    if (error) toast.error("Erro ao carregar marcas");
    setBrands((data || []) as Brand[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!name.trim()) return toast.error("Informe o nome");
    setSaving(true);
    const { error } = await supabase.from("brands").insert({
      name: name.trim(),
      slug: slugify(name),
    });
    setSaving(false);
    if (error) return toast.error("Erro: " + error.message);
    toast.success("Marca criada");
    setName("");
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir essa marca?")) return;
    const { error } = await supabase.from("brands").delete().eq("id", id);
    if (error) return toast.error("Erro: " + error.message);
    load();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Nova marca</CardTitle></CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0 md:grid-cols-[1fr_auto]">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Royal Canin" onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
          <Button onClick={handleAdd} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Adicionar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Marcas ({brands.length})</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : brands.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">Nenhuma marca cadastrada.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {brands.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell className="text-muted-foreground">{b.slug}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(b.id)}>
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

function AssignPanel() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [productId, setProductId] = useState("");
  const [loading, setLoading] = useState(true);

  // all configured links across products (for the "já configurados" list)
  const [allProductCats, setAllProductCats] = useState<ProductCategoryLink[]>([]);
  const [allProductContent, setAllProductContent] = useState<ProductContentRow[]>([]);
  const [allProductAttrs, setAllProductAttrs] = useState<ProductAttribute[]>([]);

  // selection for current product
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const [brandId, setBrandId] = useState<string>("none");
  const [attrs, setAttrs] = useState<ProductAttribute[]>([]);
  const [contentRow, setContentRow] = useState<ProductContentRow | null>(null);
  const [newKey, setNewKey] = useState<string>("");
  const [newValue, setNewValue] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");

  // registered titles + values
  const [allValues, setAllValues] = useState<AttrValue[]>([]);
  const [registeredKeys, setRegisteredKeys] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      const [{ data: vals }, { data: ks }] = await Promise.all([
        supabase.from("attribute_values").select("*").order("attr_key").order("sort_order"),
        supabase.from("attribute_keys").select("name").order("sort_order").order("name"),
      ]);
      setAllValues((vals || []) as AttrValue[]);
      setRegisteredKeys(((ks || []) as { name: string }[]).map((r) => r.name));
    })();
  }, []);
  const activeKey = newKey;
  const presetValues = useMemo(
    () => allValues.filter((v) => v.attr_key === activeKey),
    [allValues, activeKey]
  );

  const reloadAll = async () => {
    const [pc, pcontent, pa] = await Promise.all([
      supabase.from("product_categories").select("*"),
      supabase.from("product_content").select("id, shopify_product_id, brand_id"),
      supabase.from("product_attributes").select("*"),
    ]);
    setAllProductCats((pc.data || []) as ProductCategoryLink[]);
    setAllProductContent((pcontent.data || []) as ProductContentRow[]);
    setAllProductAttrs((pa.data || []) as ProductAttribute[]);
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [shop, cats, brs] = await Promise.all([
          fetchAllShopifyProducts(),
          supabase.from("categories").select("*").order("name"),
          supabase.from("brands").select("*").order("name"),
        ]);
        setProducts(shop);
        setCategories((cats.data || []) as Category[]);
        setBrands((brs.data || []) as Brand[]);
        await reloadAll();
      } catch (e) {
        toast.error("Erro ao carregar dados");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Load product-specific data when product changes
  useEffect(() => {
    if (!productId) {
      setSelectedCats(new Set());
      setBrandId("none");
      setAttrs([]);
      setContentRow(null);
      return;
    }
    (async () => {
      const [pc, pa, content] = await Promise.all([
        supabase.from("product_categories").select("*").eq("shopify_product_id", productId),
        supabase.from("product_attributes").select("*").eq("shopify_product_id", productId).order("sort_order"),
        supabase.from("product_content").select("id, shopify_product_id, brand_id").eq("shopify_product_id", productId).maybeSingle(),
      ]);
      setSelectedCats(new Set(((pc.data || []) as ProductCategoryLink[]).map((x) => x.category_id)));
      setAttrs((pa.data || []) as ProductAttribute[]);
      setContentRow((content.data as ProductContentRow) || null);
      setBrandId((content.data as ProductContentRow | null)?.brand_id || "none");
    })();
  }, [productId]);

  const toggleCategory = (id: string) => {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSaveCategoriesAndBrand = async () => {
    if (!productId) return;
    setSaving(true);
    try {
      // sync categories: delete all then insert
      const { error: delErr } = await supabase
        .from("product_categories")
        .delete()
        .eq("shopify_product_id", productId);
      if (delErr) throw delErr;
      if (selectedCats.size > 0) {
        const rows = Array.from(selectedCats).map((cid) => ({
          shopify_product_id: productId,
          category_id: cid,
        }));
        const { error: insErr } = await supabase.from("product_categories").insert(rows);
        if (insErr) throw insErr;
      }

      // brand: upsert product_content row
      const newBrandId = brandId === "none" ? null : brandId;
      if (contentRow) {
        const { error } = await supabase
          .from("product_content")
          .update({ brand_id: newBrandId })
          .eq("id", contentRow.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("product_content")
          .insert({ shopify_product_id: productId, brand_id: newBrandId })
          .select()
          .single();
        if (error) throw error;
        setContentRow(data as ProductContentRow);
      }
      toast.success("Salvo!");
      await reloadAll();
    } catch (e: any) {
      toast.error("Erro: " + (e?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const handleAddAttr = async () => {
    if (!productId) return;
    const finalKey = newKey.trim();
    const values = Array.isArray(newValue) ? newValue : (newValue ? [newValue] : []);
    if (!finalKey || values.length === 0) return toast.error("Selecione um título e ao menos um valor");
    const existing = new Set(attrs.filter((a) => a.attr_key === finalKey).map((a) => a.attr_value));
    const toInsert = values.filter((v) => !existing.has(v));
    if (toInsert.length === 0) return toast.error("Todos os valores já estão atribuídos");
    const rows = toInsert.map((v, i) => ({
      shopify_product_id: productId,
      attr_key: finalKey,
      attr_value: v,
      sort_order: attrs.length + i,
    }));
    const { data, error } = await supabase.from("product_attributes").insert(rows).select();
    if (error) return toast.error("Erro: " + error.message);
    setAttrs([...attrs, ...((data || []) as ProductAttribute[])]);
    setNewValue([] as any);
    toast.success(`${toInsert.length} valor(es) adicionado(s)`);
    await reloadAll();
  };

  const handleDelAttr = async (id: string) => {
    const { error } = await supabase.from("product_attributes").delete().eq("id", id);
    if (error) return toast.error("Erro");
    setAttrs(attrs.filter((a) => a.id !== id));
    await reloadAll();
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const selectedProduct = products.find((p) => p.node.id === productId);
  const rootCats = categories.filter((c) => !c.parent_id);
  const childrenOf = (pid: string) => categories.filter((c) => c.parent_id === pid);

  const renderCatTree = (pid: string | null, depth = 0): JSX.Element[] => {
    const items = pid === null ? rootCats : childrenOf(pid);
    return items.flatMap((c) => [
      <label
        key={c.id}
        className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-muted/50 px-2 rounded"
        style={{ marginLeft: depth * 16 }}
      >
        <input
          type="checkbox"
          checked={selectedCats.has(c.id)}
          onChange={() => toggleCategory(c.id)}
          className="h-4 w-4"
        />
        <span className="text-sm">{c.name}</span>
      </label>,
      ...renderCatTree(c.id, depth + 1),
    ]);
  };

  // Build summary of configured products
  const configuredIds = new Set<string>([
    ...allProductCats.map((x) => x.shopify_product_id),
    ...allProductContent.filter((x) => x.brand_id).map((x) => x.shopify_product_id),
    ...allProductAttrs.map((x) => x.shopify_product_id),
  ]);
  const configuredProducts = products.filter((p) => configuredIds.has(p.node.id));
  const filteredConfigured = configuredProducts.filter((p) =>
    !filter.trim() ? true : p.node.title.toLowerCase().includes(filter.toLowerCase())
  );
  const brandById = new Map(brands.map((b) => [b.id, b]));
  const catById = new Map(categories.map((c) => [c.id, c]));
  const summaryFor = (pid: string) => {
    const cats = allProductCats.filter((x) => x.shopify_product_id === pid);
    const content = allProductContent.find((x) => x.shopify_product_id === pid);
    const attrs = allProductAttrs.filter((x) => x.shopify_product_id === pid);
    return {
      cats: cats.map((c) => catById.get(c.category_id)).filter(Boolean) as Category[],
      brand: content?.brand_id ? brandById.get(content.brand_id) : undefined,
      attrs,
    };
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="flex items-center justify-between gap-3 flex-wrap text-base">
            <span>Produtos já configurados ({configuredProducts.length})</span>
            <Input
              placeholder="Filtrar..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full sm:w-64"
            />
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {configuredProducts.length === 0 ? (
            <p className="text-muted-foreground text-center py-6 text-sm">
              Nenhum produto configurado ainda. Selecione um abaixo para começar.
            </p>
          ) : filteredConfigured.length === 0 ? (
            <p className="text-muted-foreground text-center py-6 text-sm">Nenhum resultado.</p>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
              {filteredConfigured.map((p) => {
                const s = summaryFor(p.node.id);
                const active = productId === p.node.id;
                return (
                  <button
                    key={p.node.id}
                    onClick={() => {
                      setProductId(p.node.id);
                      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
                    }}
                    className={`w-full text-left border rounded-lg p-3 transition-colors ${
                      active ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/40"
                    }`}
                  >
                    <div className="font-medium text-sm mb-1.5">{p.node.title}</div>
                    <div className="flex flex-wrap gap-1">
                      {s.brand && (
                        <Badge variant="default" className="text-[10px]">Marca: {s.brand.name}</Badge>
                      )}
                      {s.cats.map((c) => (
                        <Badge key={c.id} variant="secondary" className="text-[10px]">
                          {categoryPath(c, categories)}
                        </Badge>
                      ))}
                      {s.attrs.map((a) => (
                        <Badge key={a.id} variant="outline" className="text-[10px]">
                          {a.attr_key}: {a.attr_value}
                        </Badge>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Atribuir detalhes a um produto</CardTitle></CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">
          <div>
            <label className="text-sm font-medium mb-1 block">
              Produto <span className="text-xs text-muted-foreground font-normal">(apenas não configurados)</span>
            </label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {products
                  .filter((p) => p.node.id === productId || !configuredIds.has(p.node.id))
                  .map((p) => (
                    <SelectItem key={p.node.id} value={p.node.id}>{p.node.title}</SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Produtos já configurados ficam ocultos aqui — edite-os pela lista acima.
            </p>
          </div>

          {productId && (
            <>
              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium mb-2 block">Categorias</label>
                  {categories.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Crie categorias na aba "Categorias" primeiro.
                    </p>
                  ) : (
                    <div className="border border-border rounded-md p-2 max-h-72 overflow-auto">
                      {renderCatTree(null)}
                    </div>
                  )}
                  {selectedCats.size > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {Array.from(selectedCats).map((cid) => {
                        const cat = categories.find((c) => c.id === cid);
                        if (!cat) return null;
                        return (
                          <Badge key={cid} variant="secondary" className="gap-1">
                            {categoryPath(cat, categories)}
                            <button onClick={() => toggleCategory(cid)}>
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">Marca</label>
                  <Select value={brandId} onValueChange={setBrandId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Sem marca</SelectItem>
                      {brands.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="mt-6">
                    <label className="text-sm font-medium mb-2 block">Atributos extras</label>
                    <p className="text-xs text-muted-foreground mb-2">
                      Escolha um título e um valor previamente cadastrados na aba <strong>Valores</strong>. Eles aparecem como filtros no catálogo.
                    </p>
                    <div className="space-y-2">
                      {attrs.map((a) => (
                        <div key={a.id} className="flex items-center gap-2 text-sm border border-border rounded px-2 py-1.5">
                          <span className="font-medium">{a.attr_key}:</span>
                          <span className="flex-1">{a.attr_value}</span>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelAttr(a.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      ))}
                      {registeredKeys.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic">
                          Você ainda não cadastrou nenhum título. Vá à aba "Valores" para criar.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <Select value={newKey} onValueChange={(v) => { setNewKey(v); setNewValue([]); }}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Escolha o título" />
                            </SelectTrigger>
                            <SelectContent>
                              {registeredKeys.map((k) => (
                                <SelectItem key={k} value={k}>{k}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {newKey && (
                            <div className="border border-border rounded-md p-2 max-h-48 overflow-auto">
                              {presetValues.length === 0 ? (
                                <p className="text-xs text-muted-foreground px-1 py-1">
                                  Nenhum valor cadastrado para "{newKey}".
                                </p>
                              ) : (
                                presetValues.map((v) => {
                                  const already = attrs.some((a) => a.attr_key === newKey && a.attr_value === v.attr_value);
                                  const checked = newValue.includes(v.attr_value);
                                  return (
                                    <label
                                      key={v.id}
                                      className={`flex items-center gap-2 py-1 px-1 rounded text-sm ${already ? "opacity-50" : "hover:bg-muted/50 cursor-pointer"}`}
                                    >
                                      <input
                                        type="checkbox"
                                        className="h-4 w-4"
                                        disabled={already}
                                        checked={checked}
                                        onChange={() =>
                                          setNewValue((prev) =>
                                            prev.includes(v.attr_value)
                                              ? prev.filter((x) => x !== v.attr_value)
                                              : [...prev, v.attr_value]
                                          )
                                        }
                                      />
                                      <span>{v.attr_value}</span>
                                      {already && <span className="text-[10px] text-muted-foreground ml-auto">já atribuído</span>}
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          )}
                          <Button
                            onClick={handleAddAttr}
                            disabled={!newKey || newValue.length === 0}
                            className="w-full"
                          >
                            <Plus className="h-4 w-4 mr-2" />
                            Adicionar {newValue.length > 0 ? `(${newValue.length})` : ""}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <Button onClick={handleSaveCategoriesAndBrand} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Salvar categorias e marca
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
