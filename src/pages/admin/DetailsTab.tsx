import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Check, Trash2, Loader2, Plus, FolderTree, Tag, Package, X, ListChecks, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllShopifyProducts, type ShopifyProduct } from "@/lib/shopify";
import { STANDARD_ATTR_KEYS } from "@/lib/productAttributes";
import { ProductPicker } from "@/components/admin/ProductPicker";
import { fuzzySearch, normalizeText } from "@/lib/fuzzySearch";
import { suggestProductDetails } from "@/lib/productDetailSuggestions";
import { fetchAllRows } from "@/lib/fetchAllRows";

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

interface DetailProfile {
  id: string;
  name: string;
  brand_id: string | null;
}

interface DetailProfileCategory {
  profile_id: string;
  category_id: string;
}

interface DetailProfileAttribute {
  id: string;
  profile_id: string;
  attr_key: string;
  attr_value: string;
  sort_order: number;
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

const rootCategoryId = (categoryId: string, categories: Category[]): string | null => {
  let current = categories.find((category) => category.id === categoryId);
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    if (!current.parent_id) return current.id;
    current = categories.find((category) => category.id === current?.parent_id);
  }
  return null;
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

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: ks }, { data: vals }] = await Promise.all([
      supabase.from("attribute_keys").select("*").order("sort_order").order("name"),
      supabase.from("attribute_values").select("*").order("attr_key").order("sort_order").order("attr_value"),
    ]);
    setKeys((ks || []) as AttrKey[]);
    setItems((vals || []) as AttrValue[]);
    if (ks && ks.length > 0) setSelectedKey((current) => current || (ks[0] as AttrKey).name);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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
  const [categoryRootFilter, setCategoryRootFilter] = useState<string>("all");
  const [brandId, setBrandId] = useState<string>("none");
  const [attrs, setAttrs] = useState<ProductAttribute[]>([]);
  const [contentRow, setContentRow] = useState<ProductContentRow | null>(null);
  const [attributeFilter, setAttributeFilter] = useState("");
  const [updatingAttribute, setUpdatingAttribute] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [registrationFilter, setRegistrationFilter] = useState<"all" | "registered" | "unregistered">("all");
  const [profiles, setProfiles] = useState<DetailProfile[]>([]);
  const [profileCategories, setProfileCategories] = useState<DetailProfileCategory[]>([]);
  const [profileAttributes, setProfileAttributes] = useState<DetailProfileAttribute[]>([]);
  const [profileName, setProfileName] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [savingProfile, setSavingProfile] = useState(false);
  const [applyingProfile, setApplyingProfile] = useState(false);
  const [applyingSuggestions, setApplyingSuggestions] = useState(false);
  const [applyingAllSuggestions, setApplyingAllSuggestions] = useState(false);

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
  const attributeGroups = useMemo(() => {
    const query = normalizeText(attributeFilter);
    const keys = Array.from(new Set([...registeredKeys, ...attrs.map((attribute) => attribute.attr_key)]));
    return keys
      .map((key) => {
        const values = Array.from(new Set([
          ...allValues.filter((item) => item.attr_key === key).map((item) => item.attr_value),
          ...attrs.filter((item) => item.attr_key === key).map((item) => item.attr_value),
        ]));
        const keyMatches = !query || normalizeText(key).includes(query);
        const visibleValues = keyMatches
          ? values
          : values.filter((value) => normalizeText(value).includes(query));
        return { key, values: visibleValues };
      })
      .filter((group) => group.values.length > 0)
      .sort((a, b) => a.key.localeCompare(b.key, "pt-BR"));
  }, [allValues, attributeFilter, attrs, registeredKeys]);
  const configuredIds = useMemo(
    // Marca ou atributo isolado nao tornam o cadastro suficiente para a loja:
    // sem categoria o produto continua fora da navegacao correta. Antes, itens
    // como os Cookies Premier apareciam como "Cadastrado" apenas por terem marca.
    () => new Set<string>(allProductCats.map((item) => item.shopify_product_id)),
    [allProductCats],
  );
  const listedProducts = useMemo(() => {
    let result = products.filter((product) => {
      const registered = configuredIds.has(product.node.id);
      if (registrationFilter === "registered") return registered;
      if (registrationFilter === "unregistered") return !registered;
      return true;
    });
    if (filter.trim()) {
      const query = normalizeText(filter);
      const fields = (product: ShopifyProduct) => [
          product.node.title,
          product.node.vendor || "",
          product.node.productType || "",
          (product.node.tags || []).join(" "),
          ...product.node.variants.edges.map((variant) => variant.node.title),
        ];
      result = query.length === 1
        ? result.filter((product) => fields(product).some((value) => normalizeText(value).includes(query)))
        : fuzzySearch(filter, result, (product) => [
            { value: product.node.title, weight: 1 },
            { value: product.node.vendor, weight: 0.9 },
            { value: product.node.productType, weight: 0.8 },
            { value: (product.node.tags || []).join(" "), weight: 0.75 },
            ...product.node.variants.edges.map((variant) => ({ value: variant.node.title, weight: 0.8 })),
          ]);
    }
    return result;
  }, [configuredIds, filter, products, registrationFilter]);

  const reloadAll = async () => {
    // Essas tabelas ultrapassam o limite padrao de 1.000 linhas do PostgREST.
    // Sem paginacao, os dados eram salvos pelo autopreenchimento, mas sumiam da
    // tela logo depois porque apenas a primeira pagina voltava para o resumo.
    const [productCategories, productContent, productAttributes] = await Promise.all([
      fetchAllRows<ProductCategoryLink>(
        "product_categories",
        "id,shopify_product_id,category_id",
        { orderBy: "id" },
      ),
      fetchAllRows<ProductContentRow>(
        "product_content",
        "id,shopify_product_id,brand_id",
        { orderBy: "id" },
      ),
      fetchAllRows<ProductAttribute>(
        "product_attributes",
        "id,shopify_product_id,attr_key,attr_value",
        { orderBy: "id" },
      ),
    ]);
    setAllProductCats(productCategories);
    setAllProductContent(productContent);
    setAllProductAttrs(productAttributes);
  };

  const reloadProfiles = async () => {
    const [profileRows, categoryRows, attributeRows] = await Promise.all([
      supabase.from("product_detail_profiles").select("id, name, brand_id").order("name"),
      supabase.from("product_detail_profile_categories").select("profile_id, category_id"),
      supabase.from("product_detail_profile_attributes").select("*").order("sort_order"),
    ]);
    setProfiles((profileRows.data || []) as DetailProfile[]);
    setProfileCategories((categoryRows.data || []) as DetailProfileCategory[]);
    setProfileAttributes((attributeRows.data || []) as DetailProfileAttribute[]);
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
        await Promise.all([reloadAll(), reloadProfiles()]);
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
      setCategoryRootFilter("all");
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
      const selectedCategoryIds = ((pc.data || []) as ProductCategoryLink[]).map((x) => x.category_id);
      setSelectedCats(new Set(selectedCategoryIds));
      const selectedRoots = new Set(
        selectedCategoryIds
          .map((categoryId) => rootCategoryId(categoryId, categories))
          .filter((rootId): rootId is string => Boolean(rootId)),
      );
      const product = products.find((item) => item.node.id === productId);
      const suggestedRoot = product
        ? suggestProductDetails(product.node, categories, [], []).rootCategoryId
        : null;
      setCategoryRootFilter(
        selectedRoots.size === 1 ? Array.from(selectedRoots)[0] : suggestedRoot || "all",
      );
      setAttrs((pa.data || []) as ProductAttribute[]);
      setContentRow((content.data as ProductContentRow) || null);
      setBrandId((content.data as ProductContentRow | null)?.brand_id || "none");
    })();
  }, [productId, categories, products]);

  const getParentIds = (id: string): string[] => {
    const parents: string[] = [];
    let current = categories.find((c) => c.id === id);
    const seen = new Set<string>([id]);
    while (current?.parent_id) {
      if (seen.has(current.parent_id)) break; // Prevent infinite loop
      parents.push(current.parent_id);
      seen.add(current.parent_id);
      current = categories.find((c) => c.id === current?.parent_id);
    }
    return parents;
  };

  const toggleCategory = (id: string) => {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        // Auto-select all parents
        getParentIds(id).forEach((parentId) => next.add(parentId));
      }
      return next;
    });
  };

  const changeCategoryRoot = (rootId: string) => {
    setCategoryRootFilter(rootId);
    if (rootId === "all") return;
    setSelectedCats((current) => {
      const next = new Set(
        Array.from(current).filter((categoryId) => rootCategoryId(categoryId, categories) === rootId),
      );
      next.add(rootId);
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
    } catch (e: unknown) {
      toast.error("Erro: " + (e instanceof Error ? e.message : "erro desconhecido"));
    } finally {
      setSaving(false);
    }
  };

  const toggleAttribute = async (key: string, value: string) => {
    if (!productId || updatingAttribute) return;
    const operationKey = `${key}:${value}`;
    const existing = attrs.find((attribute) => attribute.attr_key === key && attribute.attr_value === value);
    setUpdatingAttribute(operationKey);
    try {
      if (existing) {
        const { error } = await supabase.from("product_attributes").delete().eq("id", existing.id);
        if (error) throw error;
        setAttrs((current) => current.filter((attribute) => attribute.id !== existing.id));
      } else {
        const { data, error } = await supabase.from("product_attributes").insert({
          shopify_product_id: productId,
          attr_key: key,
          attr_value: value,
          sort_order: attrs.length,
        }).select().single();
        if (error) throw error;
        setAttrs((current) => [...current, data as ProductAttribute]);
      }
      await reloadAll();
    } catch (error) {
      toast.error("Não foi possível atualizar o atributo.");
      console.error(error);
    } finally {
      setUpdatingAttribute(null);
    }
  };

  const handleCreateProfile = async () => {
    const name = profileName.trim();
    if (!productId) return toast.error("Selecione e configure um produto modelo primeiro.");
    if (!name) return toast.error("Informe um nome para o perfil.");
    if (selectedCats.size === 0 && attrs.length === 0 && brandId === "none") {
      return toast.error("O produto modelo ainda não possui detalhes para salvar.");
    }
    setSavingProfile(true);
    let createdId = "";
    try {
      const { data, error } = await supabase.from("product_detail_profiles").insert({
        name,
        brand_id: brandId === "none" ? null : brandId,
      }).select("id").single();
      if (error) throw error;
      createdId = data.id;

      if (selectedCats.size > 0) {
        const { error: categoryError } = await supabase.from("product_detail_profile_categories").insert(
          Array.from(selectedCats).map((categoryId) => ({ profile_id: createdId, category_id: categoryId })),
        );
        if (categoryError) throw categoryError;
      }
      if (attrs.length > 0) {
        const { error: attributeError } = await supabase.from("product_detail_profile_attributes").insert(
          attrs.map((attribute, index) => ({
            profile_id: createdId,
            attr_key: attribute.attr_key,
            attr_value: attribute.attr_value,
            sort_order: index,
          })),
        );
        if (attributeError) throw attributeError;
      }
      setProfileName("");
      setSelectedProfileId(createdId);
      await reloadProfiles();
      toast.success(`Perfil "${name}" criado.`);
    } catch (error: unknown) {
      if (createdId) await supabase.from("product_detail_profiles").delete().eq("id", createdId);
      const message = error instanceof Error ? error.message : "erro desconhecido";
      toast.error(message.includes("duplicate") ? "Já existe um perfil com esse nome." : `Erro: ${message}`);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleDeleteProfile = async (profile: DetailProfile) => {
    if (!confirm(`Excluir o perfil "${profile.name}"? Os produtos já cadastrados não serão alterados.`)) return;
    const { error } = await supabase.from("product_detail_profiles").delete().eq("id", profile.id);
    if (error) return toast.error("Não foi possível excluir o perfil.");
    if (selectedProfileId === profile.id) setSelectedProfileId("");
    await reloadProfiles();
    toast.success("Perfil excluído.");
  };

  const toggleBulkProduct = (id: string) => {
    setBulkSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApplyProfile = async () => {
    const profile = profiles.find((item) => item.id === selectedProfileId);
    if (!profile) return toast.error("Selecione um perfil.");
    if (bulkSelectedIds.size === 0) return toast.error("Selecione pelo menos um produto.");
    setApplyingProfile(true);
    try {
      const productIds = Array.from(bulkSelectedIds);
      const categoryIds = profileCategories
        .filter((item) => item.profile_id === profile.id)
        .map((item) => item.category_id);
      const profileAttrs = profileAttributes.filter((item) => item.profile_id === profile.id);

      if (categoryIds.length > 0) {
        const { error } = await supabase.from("product_categories").upsert(
          productIds.flatMap((shopifyProductId) => categoryIds.map((categoryId) => ({
            shopify_product_id: shopifyProductId,
            category_id: categoryId,
          }))),
          { onConflict: "shopify_product_id,category_id", ignoreDuplicates: true },
        );
        if (error) throw error;
      }
      if (profileAttrs.length > 0) {
        const { error } = await supabase.from("product_attributes").upsert(
          productIds.flatMap((shopifyProductId) => profileAttrs.map((attribute) => ({
            shopify_product_id: shopifyProductId,
            attr_key: attribute.attr_key,
            attr_value: attribute.attr_value,
            sort_order: attribute.sort_order,
          }))),
          { onConflict: "shopify_product_id,attr_key,attr_value", ignoreDuplicates: true },
        );
        if (error) throw error;
      }
      if (profile.brand_id) {
        const { error } = await supabase.from("product_content").upsert(
          productIds.map((shopifyProductId) => ({
            shopify_product_id: shopifyProductId,
            brand_id: profile.brand_id,
          })),
          { onConflict: "shopify_product_id" },
        );
        if (error) throw error;
      }

      await reloadAll();
      toast.success(`Perfil aplicado em ${productIds.length} ${productIds.length === 1 ? "produto" : "produtos"}.`);
      setBulkSelectedIds(new Set());
    } catch (error: unknown) {
      toast.error("Erro: " + (error instanceof Error ? error.message : "erro desconhecido"));
    } finally {
      setApplyingProfile(false);
    }
  };

  const selectedProduct = products.find((product) => product.node.id === productId);
  const detailSuggestion = selectedProduct
    ? suggestProductDetails(
        selectedProduct.node,
        categories,
        brands,
        allValues.map((item) => ({ attr_key: item.attr_key, attr_value: item.attr_value })),
      )
    : null;
  const hasSuggestion = Boolean(detailSuggestion && (
    detailSuggestion.categoryIds.length > 0
    || detailSuggestion.brandId
    || detailSuggestion.attributes.length > 0
  ));

  const handleApplySuggestions = async () => {
    if (!productId || !detailSuggestion || !hasSuggestion) return;
    setApplyingSuggestions(true);
    try {
      const specialized = detailSuggestion.categoryIds.some((categoryId) => {
        const name = normalizeText(categories.find((category) => category.id === categoryId)?.name || "");
        return name.includes("natural") || name.includes("prescrit") || name.includes("nutricao clinica");
      }) || detailSuggestion.attributes.some((attribute) => {
        const value = normalizeText(attribute.attr_value);
        return value === "natural" || value === "prescrita";
      });
      const staleCategoryLinkIds = specialized
        ? allProductCats
            .filter((link) => (
              link.shopify_product_id === productId
              && normalizeText(categories.find((category) => category.id === link.category_id)?.name || "").includes("racao seca")
            ))
            .map((link) => link.id)
        : [];
      const staleDryAttributeIds = specialized
        ? attrs
            .filter((attribute) => {
              const key = normalizeText(attribute.attr_key);
              const value = normalizeText(attribute.attr_value);
              return (key.includes("tipo") || key.includes("categoria") || key.includes("classificacao"))
                && (value === "seca" || value === "racao seca");
            })
            .map((attribute) => attribute.id)
        : [];
      const missingAttributes = detailSuggestion.attributes.filter((suggestion) => !attrs.some(
        (attribute) => attribute.attr_key === suggestion.attr_key && attribute.attr_value === suggestion.attr_value,
      ));

      const writes = [];
      if (staleCategoryLinkIds.length > 0) {
        writes.push(supabase.from("product_categories").delete().in("id", staleCategoryLinkIds));
      }
      if (staleDryAttributeIds.length > 0) {
        writes.push(supabase.from("product_attributes").delete().in("id", staleDryAttributeIds));
      }
      if (detailSuggestion.categoryIds.length > 0) {
        writes.push(supabase.from("product_categories").upsert(
          detailSuggestion.categoryIds.map((categoryId) => ({
            shopify_product_id: productId,
            category_id: categoryId,
          })),
          { onConflict: "shopify_product_id,category_id", ignoreDuplicates: true },
        ));
      }
      if (missingAttributes.length > 0) {
        writes.push(supabase.from("product_attributes").upsert(
          missingAttributes.map((attribute, index) => ({
            shopify_product_id: productId,
            attr_key: attribute.attr_key,
            attr_value: attribute.attr_value,
            sort_order: attrs.length + index,
          })),
          { onConflict: "shopify_product_id,attr_key,attr_value", ignoreDuplicates: true },
        ));
      }
      if (detailSuggestion.brandId) {
        writes.push(supabase.from("product_content").upsert({
          shopify_product_id: productId,
          brand_id: detailSuggestion.brandId,
        }, { onConflict: "shopify_product_id" }));
      }

      const results = await Promise.all(writes);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;

      await reloadAll();
      const [{ data: currentCats }, { data: currentAttrs }, { data: currentContent }] = await Promise.all([
        supabase.from("product_categories").select("*").eq("shopify_product_id", productId),
        supabase.from("product_attributes").select("*").eq("shopify_product_id", productId).order("sort_order"),
        supabase.from("product_content").select("id, shopify_product_id, brand_id").eq("shopify_product_id", productId).maybeSingle(),
      ]);
      const currentCategoryIds = ((currentCats || []) as ProductCategoryLink[]).map((item) => item.category_id);
      setSelectedCats(new Set(currentCategoryIds));
      const currentRoots = new Set(
        currentCategoryIds
          .map((categoryId) => rootCategoryId(categoryId, categories))
          .filter((rootId): rootId is string => Boolean(rootId)),
      );
      setCategoryRootFilter(currentRoots.size === 1 ? Array.from(currentRoots)[0] : detailSuggestion.rootCategoryId || "all");
      setAttrs((currentAttrs || []) as ProductAttribute[]);
      setContentRow((currentContent as ProductContentRow | null) || null);
      setBrandId((currentContent as ProductContentRow | null)?.brand_id || "none");
      toast.success("Sugestões preenchidas e salvas.");
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível aplicar as sugestões.");
    } finally {
      setApplyingSuggestions(false);
    }
  };

  const handleApplyAllSuggestions = async (includeConfigured = false) => {
    const pendingProducts = includeConfigured
      ? products
      : products.filter((product) => !configuredIds.has(product.node.id));
    if (pendingProducts.length === 0) return toast.info("Todos os produtos já estão cadastrados.");

    const availableAttributes = allValues.map((item) => ({
      attr_key: item.attr_key,
      attr_value: item.attr_value,
    }));
    const suggestions = pendingProducts.map((product) => ({
      productId: product.node.id,
      suggestion: suggestProductDetails(product.node, categories, brands, availableAttributes),
    }));
    const applicable = suggestions.filter(({ suggestion }) => (
      suggestion.categoryIds.length > 0
      || suggestion.brandId
      || suggestion.attributes.length > 0
    ));

    if (applicable.length === 0) {
      return toast.info("Não encontramos sugestões seguras para preencher os produtos.");
    }

    setApplyingAllSuggestions(true);
    try {
      const categoryRows = applicable.flatMap(({ productId: shopifyProductId, suggestion }) => (
        suggestion.categoryIds.map((categoryId) => ({ shopify_product_id: shopifyProductId, category_id: categoryId }))
      ));
      const attributeRows = applicable.flatMap(({ productId: shopifyProductId, suggestion }) => (
        suggestion.attributes.map((attribute, index) => ({
          shopify_product_id: shopifyProductId,
          attr_key: attribute.attr_key,
          attr_value: attribute.attr_value,
          sort_order: index,
        }))
      ));
      const brandRows = applicable.flatMap(({ productId: shopifyProductId, suggestion }) => (
        suggestion.brandId
          ? [{ shopify_product_id: shopifyProductId, brand_id: suggestion.brandId }]
          : []
      ));

      // Natural e prescrita são classificações próprias. Ao reaplicar as
      // sugestões, remova apenas a classificação antiga de ração seca que
      // possa ter sido criada pela regra anterior, preservando os demais dados.
      const specializedProductIds = new Set(
        applicable
          .filter(({ suggestion }) => (
            suggestion.categoryIds.some((categoryId) => {
              const name = normalizeText(categories.find((category) => category.id === categoryId)?.name || "");
              return name.includes("natural") || name.includes("prescrit") || name.includes("nutricao clinica");
            })
            || suggestion.attributes.some((attribute) => {
              const value = normalizeText(attribute.attr_value);
              return value === "natural" || value === "prescrita";
            })
          ))
          .map(({ productId: suggestedProductId }) => suggestedProductId),
      );
      const dryCategoryIds = new Set(
        categories
          .filter((category) => normalizeText(category.name).includes("racao seca"))
          .map((category) => category.id),
      );
      const staleCategoryLinkIds = allProductCats
        .filter((link) => specializedProductIds.has(link.shopify_product_id) && dryCategoryIds.has(link.category_id))
        .map((link) => link.id);
      const staleDryAttributeIds = allProductAttrs
        .filter((attribute) => {
          if (!specializedProductIds.has(attribute.shopify_product_id)) return false;
          const key = normalizeText(attribute.attr_key);
          const value = normalizeText(attribute.attr_value);
          const isClassification = key.includes("tipo") || key.includes("categoria") || key.includes("classificacao");
          return isClassification && (value === "seca" || value === "racao seca");
        })
        .map((attribute) => attribute.id);

      const writes = [];
      if (staleCategoryLinkIds.length > 0) {
        writes.push(supabase.from("product_categories").delete().in("id", staleCategoryLinkIds));
      }
      if (staleDryAttributeIds.length > 0) {
        writes.push(supabase.from("product_attributes").delete().in("id", staleDryAttributeIds));
      }
      if (categoryRows.length > 0) {
        writes.push(supabase.from("product_categories").upsert(categoryRows, {
          onConflict: "shopify_product_id,category_id",
          ignoreDuplicates: true,
        }));
      }
      if (attributeRows.length > 0) {
        writes.push(supabase.from("product_attributes").upsert(attributeRows, {
          onConflict: "shopify_product_id,attr_key,attr_value",
          ignoreDuplicates: true,
        }));
      }
      if (brandRows.length > 0) {
        writes.push(supabase.from("product_content").upsert(brandRows, {
          onConflict: "shopify_product_id",
        }));
      }

      const results = await Promise.all(writes);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;

      await reloadAll();

      const current = applicable.find((item) => item.productId === productId);
      if (current) {
        const [{ data: currentCats }, { data: currentAttrs }, { data: currentContent }] = await Promise.all([
          supabase.from("product_categories").select("*").eq("shopify_product_id", productId),
          supabase.from("product_attributes").select("*").eq("shopify_product_id", productId).order("sort_order"),
          supabase.from("product_content").select("id, shopify_product_id, brand_id").eq("shopify_product_id", productId).maybeSingle(),
        ]);
        const currentCategoryIds = ((currentCats || []) as ProductCategoryLink[]).map((item) => item.category_id);
        setSelectedCats(new Set(currentCategoryIds));
        const currentRoots = new Set(
          currentCategoryIds
            .map((categoryId) => rootCategoryId(categoryId, categories))
            .filter((rootId): rootId is string => Boolean(rootId)),
        );
        setCategoryRootFilter(currentRoots.size === 1 ? Array.from(currentRoots)[0] : current.suggestion.rootCategoryId || "all");
        setAttrs((currentAttrs || []) as ProductAttribute[]);
        setContentRow((currentContent as ProductContentRow | null) || null);
        setBrandId((currentContent as ProductContentRow | null)?.brand_id || "none");
      }

      const skipped = pendingProducts.length - applicable.length;
      toast.success(
        `${applicable.length} ${applicable.length === 1 ? "produto preenchido" : "produtos preenchidos"}`
        + (skipped > 0 ? `; ${skipped} sem sugestão segura.` : "."),
      );
    } catch (error) {
      console.error(error);
      toast.error("Não foi possível preencher os produtos com as novas sugestões.");
    } finally {
      setApplyingAllSuggestions(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

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
  const configuredProducts = products.filter((p) => configuredIds.has(p.node.id));
  const unregisteredProducts = products.filter((product) => !configuredIds.has(product.node.id));
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
      <Card id="details-assignment-card">
        <CardHeader className="p-4 pb-3"><CardTitle className="text-base">Atribuir detalhes a um produto</CardTitle></CardHeader>
        <CardContent className="space-y-4 p-4 pt-0">
          <div>
            <label className="text-sm font-medium mb-2 block">
              Buscar e selecionar produto <span className="text-xs text-muted-foreground font-normal">(novos cadastros)</span>
            </label>
            <ProductPicker
              products={products}
              value={productId}
              onChange={setProductId}
              excludeIds={configuredIds}
              placeholder="Pesquisar produto por nome..."
            />
            <p className="text-xs text-muted-foreground mt-1">
              Para editar um produto já configurado, selecione-o na lista abaixo.
            </p>
          </div>

          {productId && (
            <>
              {/* Preview */}
              <div className="grid gap-4 rounded-xl border border-border bg-muted/30 p-4 md:grid-cols-[180px_minmax(0,1fr)]">
                <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border bg-white">
                  {selectedProduct?.node.images.edges[0]?.node ? (
                    <img
                      src={selectedProduct.node.images.edges[0].node.url}
                      alt={selectedProduct.node.images.edges[0].node.altText || selectedProduct.node.title || ""}
                      className="h-full w-full object-contain p-2"
                    />
                  ) : (
                    <Package className="h-10 w-10 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prévia do produto</p>
                      <p className="mt-1 text-base font-bold text-foreground">{selectedProduct?.node.title}</p>
                      {selectedProduct?.node.vendor && (
                        <p className="mt-1 text-sm text-muted-foreground">{selectedProduct.node.vendor}</p>
                      )}
                    </div>
                    {selectedProduct && (
                      <Badge variant={selectedProduct.node.variants.edges.some(({ node }) => node.availableForSale) ? "default" : "secondary"}>
                        {selectedProduct.node.variants.edges.some(({ node }) => node.availableForSale) ? "Disponível" : "Esgotado"}
                      </Badge>
                    )}
                  </div>
                  {selectedProduct && (
                    <p className="mt-3 text-xl font-bold tabular-nums">
                      R$ {Number(selectedProduct.node.priceRange.minVariantPrice.amount).toFixed(2).replace(".", ",")}
                    </p>
                  )}
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Variações disponíveis</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedProduct?.node.variants.edges.map((variant) => (
                        <span key={variant.node.id} className="rounded-md border bg-white px-2 py-1 text-xs text-foreground">
                          {variant.node.title}
                          {!variant.node.availableForSale && <span className="ml-1 text-destructive">(esgotada)</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <p className="text-sm font-semibold">Sugestão de preenchimento</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Analisamos o nome, fornecedor, tipo e tags desse produto na Shopify.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleApplySuggestions}
                    disabled={!hasSuggestion || applyingSuggestions}
                  >
                    {applyingSuggestions ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    Preencher com sugestões
                  </Button>
                </div>
                {hasSuggestion && detailSuggestion ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {detailSuggestion.categoryIds.map((categoryId) => {
                      const category = categories.find((item) => item.id === categoryId);
                      return category ? (
                        <Badge key={categoryId} variant="secondary">Categoria: {category.name}</Badge>
                      ) : null;
                    })}
                    {detailSuggestion.brandId && (() => {
                      const brand = brands.find((item) => item.id === detailSuggestion.brandId);
                      return brand ? <Badge variant="outline">Marca: {brand.name}</Badge> : null;
                    })()}
                    {detailSuggestion.attributes.map((attribute) => (
                      <Badge key={`${attribute.attr_key}:${attribute.attr_value}`} variant="outline">
                        {attribute.attr_key}: {attribute.attr_value}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Não encontramos uma sugestão segura. Confira se o nome possui o pet e se a marca está cadastrada.
                  </p>
                )}
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium mb-2 block">Categorias</label>
                  {categories.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Crie categorias na aba "Categorias" primeiro.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-muted-foreground">Pet</label>
                        <Select value={categoryRootFilter} onValueChange={changeCategoryRoot}>
                          <SelectTrigger><SelectValue placeholder="Selecione o pet" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Todos os pets</SelectItem>
                            {rootCats.map((category) => (
                              <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="border border-border rounded-md p-2 max-h-72 overflow-auto">
                        {categoryRootFilter === "all" ? (
                          renderCatTree(null)
                        ) : childrenOf(categoryRootFilter).length > 0 ? (
                          renderCatTree(categoryRootFilter)
                        ) : (
                          <p className="px-2 py-3 text-xs text-muted-foreground">
                            Nenhuma subcategoria cadastrada para este pet.
                          </p>
                        )}
                      </div>
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
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label className="text-sm font-medium">Atributos extras</label>
                      {attrs.length > 0 && (
                        <Badge variant="secondary">
                          {attrs.length} {attrs.length === 1 ? "selecionado" : "selecionados"}
                        </Badge>
                      )}
                    </div>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Clique em um valor para atribuir ou remover. A alteração é salva automaticamente.
                    </p>

                    {(registeredKeys.length > 0 || attrs.length > 0) && (
                      <Input
                        className="mb-3"
                        placeholder="Buscar atributo ou valor..."
                        value={attributeFilter}
                        onChange={(event) => setAttributeFilter(event.target.value)}
                      />
                    )}

                    {registeredKeys.length === 0 && attrs.length === 0 ? (
                      <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                        Você ainda não cadastrou atributos. Vá à aba <strong>Valores</strong> para criar os títulos e valores.
                      </p>
                    ) : attributeGroups.length === 0 ? (
                      <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
                        Nenhum atributo encontrado para essa busca.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {attributeGroups.map((group) => {
                          const selectedCount = attrs.filter((attribute) => attribute.attr_key === group.key).length;
                          return (
                            <div key={group.key} className="rounded-lg border border-border p-3">
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <p className="text-sm font-semibold">{group.key}</p>
                                {selectedCount > 0 && (
                                  <span className="text-[11px] text-muted-foreground">
                                    {selectedCount} {selectedCount === 1 ? "marcado" : "marcados"}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {group.values.map((value) => {
                                  const selected = attrs.some(
                                    (attribute) => attribute.attr_key === group.key && attribute.attr_value === value,
                                  );
                                  const operationKey = `${group.key}:${value}`;
                                  const updating = updatingAttribute === operationKey;
                                  return (
                                    <button
                                      key={value}
                                      type="button"
                                      aria-pressed={selected}
                                      disabled={Boolean(updatingAttribute)}
                                      onClick={() => toggleAttribute(group.key, value)}
                                      className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
                                        selected
                                          ? "border-primary bg-primary text-primary-foreground"
                                          : "border-border bg-background text-foreground hover:border-primary hover:text-primary"
                                      }`}
                                    >
                                      {updating ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : selected ? (
                                        <Check className="h-3.5 w-3.5" />
                                      ) : (
                                        <Plus className="h-3.5 w-3.5" />
                                      )}
                                      {value}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
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

      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Perfis para cadastro em massa</CardTitle>
          <p className="text-xs text-muted-foreground">
            Salve os detalhes do produto modelo e aplique-os a todos os produtos que você selecionar.
          </p>
        </CardHeader>
        <CardContent className="space-y-5 p-4 pt-0">
          <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Criar perfil com o produto atual</label>
              <Input
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                placeholder='Ex.: Ração seca para cães'
                disabled={!productId || savingProfile}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                O perfil guardará as categorias, os atributos e a marca opcional do produto aberto acima.
              </p>
            </div>
            <Button onClick={handleCreateProfile} disabled={!productId || savingProfile}>
              {savingProfile ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Salvar perfil
            </Button>
          </div>

          {profiles.length === 0 ? (
            <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">
              Nenhum perfil criado ainda. Configure um produto acima e salve o primeiro perfil.
            </p>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Perfil que será aplicado</label>
                  <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                    <SelectTrigger><SelectValue placeholder="Selecione um perfil" /></SelectTrigger>
                    <SelectContent>
                      {profiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedProfileId && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      const profile = profiles.find((item) => item.id === selectedProfileId);
                      if (profile) handleDeleteProfile(profile);
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />Excluir perfil
                  </Button>
                )}
              </div>

              {selectedProfileId && (() => {
                const profile = profiles.find((item) => item.id === selectedProfileId);
                const categoryIds = profileCategories.filter((item) => item.profile_id === selectedProfileId);
                const profileAttrs = profileAttributes.filter((item) => item.profile_id === selectedProfileId);
                const profileBrand = profile?.brand_id ? brands.find((brand) => brand.id === profile.brand_id) : null;
                return (
                  <div className="flex flex-wrap gap-1.5 rounded-lg border p-3">
                    {profileBrand && <Badge variant="outline">Marca: {profileBrand.name}</Badge>}
                    {categoryIds.map((item) => {
                      const category = categories.find((candidate) => candidate.id === item.category_id);
                      return category ? <Badge key={item.category_id} variant="secondary">{categoryPath(category, categories)}</Badge> : null;
                    })}
                    {profileAttrs.map((attribute) => (
                      <Badge key={attribute.id} variant="outline">{attribute.attr_key}: {attribute.attr_value}</Badge>
                    ))}
                  </div>
                );
              })()}

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">Produtos que receberão o perfil</p>
                    <p className="text-xs text-muted-foreground">
                      As informações serão adicionadas sem apagar categorias ou atributos existentes.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setBulkSelectedIds(new Set(listedProducts.map((product) => product.node.id)))}
                    >
                      Selecionar visíveis
                    </Button>
                    {bulkSelectedIds.size > 0 && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setBulkSelectedIds(new Set())}>
                        Limpar
                      </Button>
                    )}
                  </div>
                </div>
                <div className="grid max-h-72 gap-2 overflow-y-auto rounded-lg border p-2 md:grid-cols-2">
                  {listedProducts.map((product) => {
                    const checked = bulkSelectedIds.has(product.node.id);
                    const image = product.node.images.edges[0]?.node;
                    return (
                      <label
                        key={product.node.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-md border p-2 transition-colors ${checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0"
                          checked={checked}
                          onChange={() => toggleBulkProduct(product.node.id)}
                        />
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border bg-white">
                          {image ? <img src={image.url} alt="" className="h-full w-full object-contain p-0.5" loading="lazy" /> : <Package className="h-4 w-4 text-muted-foreground" />}
                        </span>
                        <span className="line-clamp-2 text-sm font-medium">{product.node.title}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3">
                <span className="text-sm font-medium">
                  {bulkSelectedIds.size} {bulkSelectedIds.size === 1 ? "produto selecionado" : "produtos selecionados"}
                </span>
                <Button onClick={handleApplyProfile} disabled={!selectedProfileId || bulkSelectedIds.size === 0 || applyingProfile}>
                  {applyingProfile && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Aplicar perfil aos selecionados
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">Produtos ({listedProducts.length})</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {configuredProducts.length} cadastrados de {products.length} produtos carregados.
              </p>
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => handleApplyAllSuggestions(false)}
                disabled={unregisteredProducts.length === 0 || applyingAllSuggestions}
              >
                {applyingAllSuggestions ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Preencher não cadastrados ({unregisteredProducts.length})
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => handleApplyAllSuggestions(true)}
                disabled={products.length === 0 || applyingAllSuggestions}
              >
                {applyingAllSuggestions ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Repreencher todos
              </Button>
              <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[260px_190px]">
                <Input
                  placeholder="Filtrar por nome, marca ou variação..."
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  className="h-9"
                />
                <Select
                  value={registrationFilter}
                  onValueChange={(value) => setRegistrationFilter(value as "all" | "registered" | "unregistered")}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="registered">Cadastrados</SelectItem>
                    <SelectItem value="unregistered">Não cadastrados</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {listedProducts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum produto encontrado neste filtro.</p>
          ) : (
            <div className="grid max-h-[620px] gap-2 overflow-y-auto pr-1 lg:grid-cols-2">
              {listedProducts.map((product) => {
                const registered = configuredIds.has(product.node.id);
                const summary = summaryFor(product.node.id);
                const image = product.node.images.edges[0]?.node;
                const active = productId === product.node.id;
                return (
                  <button
                    key={product.node.id}
                    type="button"
                    onClick={() => {
                      setProductId(product.node.id);
                      window.requestAnimationFrame(() => {
                        document.getElementById("details-assignment-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      });
                    }}
                    className={`flex min-w-0 items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40 hover:bg-muted/40"
                    }`}
                  >
                    <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white">
                      {image ? (
                        <img src={image.url} alt="" className="h-full w-full object-contain p-1" loading="lazy" />
                      ) : (
                        <Package className="h-6 w-6 text-muted-foreground" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-sm font-semibold text-foreground">{product.node.title}</span>
                        <Badge variant={registered ? "default" : "secondary"} className="shrink-0 text-[10px]">
                          {registered ? "Cadastrado" : "Não cadastrado"}
                        </Badge>
                      </span>
                      {registered ? (
                        <span className="mt-2 flex flex-wrap gap-1">
                          {summary.brand && <Badge variant="outline" className="text-[10px]">{summary.brand.name}</Badge>}
                          {summary.cats.slice(0, 2).map((category) => (
                            <Badge key={category.id} variant="secondary" className="text-[10px]">
                              {categoryPath(category, categories)}
                            </Badge>
                          ))}
                          {summary.attrs.slice(0, 2).map((attribute) => (
                            <Badge key={attribute.id} variant="outline" className="text-[10px]">
                              {attribute.attr_key}: {attribute.attr_value}
                            </Badge>
                          ))}
                        </span>
                      ) : (
                        <span className="mt-2 block text-xs text-muted-foreground">Clique para cadastrar os detalhes.</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
