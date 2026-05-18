import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Trash2, Loader2, Plus, FolderTree, Tag, Package, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { storefrontApiRequest, PRODUCTS_QUERY, type ShopifyProduct } from "@/lib/shopify";

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
      <TabsList>
        <TabsTrigger value="categories"><FolderTree className="h-4 w-4 mr-2" />Categorias</TabsTrigger>
        <TabsTrigger value="brands"><Tag className="h-4 w-4 mr-2" />Marcas</TabsTrigger>
        <TabsTrigger value="assign"><Package className="h-4 w-4 mr-2" />Atribuir a produtos</TabsTrigger>
      </TabsList>
      <TabsContent value="categories" className="mt-4"><CategoriesPanel /></TabsContent>
      <TabsContent value="brands" className="mt-4"><BrandsPanel /></TabsContent>
      <TabsContent value="assign" className="mt-4"><AssignPanel /></TabsContent>
    </Tabs>
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
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Nova categoria</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
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
        <CardHeader><CardTitle>Árvore de categorias ({categories.length})</CardTitle></CardHeader>
        <CardContent>
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
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Nova marca</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[1fr_auto]">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Royal Canin" onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
          <Button onClick={handleAdd} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Adicionar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Marcas ({brands.length})</CardTitle></CardHeader>
        <CardContent>
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
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");

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
          storefrontApiRequest(PRODUCTS_QUERY, { first: 100 }),
          supabase.from("categories").select("*").order("name"),
          supabase.from("brands").select("*").order("name"),
        ]);
        setProducts(shop?.data?.products?.edges || []);
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
    } catch (e: any) {
      toast.error("Erro: " + (e?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const handleAddAttr = async () => {
    if (!productId) return;
    if (!newKey.trim() || !newValue.trim()) return toast.error("Preencha rótulo e valor");
    const { data, error } = await supabase
      .from("product_attributes")
      .insert({
        shopify_product_id: productId,
        attr_key: newKey.trim(),
        attr_value: newValue.trim(),
        sort_order: attrs.length,
      })
      .select()
      .single();
    if (error) return toast.error("Erro: " + error.message);
    setAttrs([...attrs, data as ProductAttribute]);
    setNewKey("");
    setNewValue("");
  };

  const handleDelAttr = async (id: string) => {
    const { error } = await supabase.from("product_attributes").delete().eq("id", id);
    if (error) return toast.error("Erro");
    setAttrs(attrs.filter((a) => a.id !== id));
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Atribuir detalhes a um produto</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Produto</label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.node.id} value={p.node.id}>{p.node.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                      Use para coisas como Peso, Idade, Sabor, Princípio Ativo, etc.
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
                      <div className="flex gap-2">
                        <Input
                          placeholder="Rótulo (ex: Peso)"
                          value={newKey}
                          onChange={(e) => setNewKey(e.target.value)}
                          className="flex-1"
                        />
                        <Input
                          placeholder="Valor (ex: 4kg)"
                          value={newValue}
                          onChange={(e) => setNewValue(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleAddAttr()}
                          className="flex-1"
                        />
                        <Button onClick={handleAddAttr} size="icon">
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
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
