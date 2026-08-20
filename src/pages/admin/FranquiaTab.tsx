import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trash2, Loader2, Store, Tag, Package, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { storefrontApiRequest, PRODUCTS_QUERY, type ShopifyProduct } from "@/lib/shopify";
import { fetchAllShopifyProducts } from "@/lib/shopify";
import { ProductPicker } from "@/components/admin/ProductPicker";
import { fetchAllProductAudience, invalidateAudienceCache, type ProductAudience } from "@/hooks/useProductAudience";
import { invalidateFranchisePricesCache } from "@/hooks/useFranchisePrices";

export default function FranquiaTab() {
  return (
    <Tabs defaultValue="audience">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="audience"><Store className="h-4 w-4 mr-2" />Visibilidade</TabsTrigger>
        <TabsTrigger value="prices"><Tag className="h-4 w-4 mr-2" />Preços de Franquia</TabsTrigger>
      </TabsList>
      <TabsContent value="audience" className="mt-4"><AudiencePanel /></TabsContent>
      <TabsContent value="prices" className="mt-4"><FranchisePricesPanel /></TabsContent>
    </Tabs>
  );
}

interface AudienceRow {
  shopify_product_id: string;
  audience: ProductAudience;
}

type AudienceFilter = "todos" | ProductAudience | "oculto";
const HIDDEN_AUDIENCE_VALUE = "oculto";

function AudiencePanel() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [audienceRows, setAudienceRows] = useState<AudienceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>("todos");

  const load = async () => {
    setLoading(true);
    // Paginado: a leitura sem paginacao trazia so as primeiras 1000 linhas, e os
    // produtos alem disso apareciam como "oculto" mesmo estando configurados --
    // e uma acao em massa sobre eles sobrescreveria a configuracao real, porque
    // o valor atual seria lido como nulo.
    const [shop, aud] = await Promise.all([
      fetchAllShopifyProducts(),
      fetchAllProductAudience(),
    ]);
    setProducts(shop);
    setAudienceRows(aud as AudienceRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  // A selecao pertence ao filtro em que foi feita. Sem isto ela sobrevivia a
  // troca de busca/filtro: o cabecalho voltava a parecer desmarcado, porque so
  // conta os itens da lista NOVA, enquanto dezenas de produtos fora da tela
  // continuavam selecionados -- e a acao em massa seguinte os atingia. Era assim
  // que produto ganhava visibilidade que ninguem pediu.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filter, audienceFilter]);

  const audienceMap = useMemo(() => {
    const m = new Map<string, ProductAudience>();
    audienceRows.forEach((r) => m.set(r.shopify_product_id, r.audience));
    return m;
  }, [audienceRows]);

  const handleChange = async (
    productId: string,
    audience: ProductAudience | typeof HIDDEN_AUDIENCE_VALUE,
  ) => {
    setSavingId(productId);
    const { error } = audience === HIDDEN_AUDIENCE_VALUE
      ? await supabase
          .from("product_audience")
          .delete()
          .eq("shopify_product_id", productId)
      : await supabase
          .from("product_audience")
          .upsert({ shopify_product_id: productId, audience }, { onConflict: "shopify_product_id" });
    setSavingId(null);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    invalidateAudienceCache();
    setAudienceRows((prev) => {
      const other = prev.filter((r) => r.shopify_product_id !== productId);
      return audience === HIDDEN_AUDIENCE_VALUE
        ? other
        : [...other, { shopify_product_id: productId, audience }];
    });
    toast.success(audience === HIDDEN_AUDIENCE_VALUE ? "Produto ocultado" : "Visibilidade atualizada");
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return products.filter((p) => {
      const matchesName = !q || p.node.title.toLowerCase().includes(q);
      const audience = audienceMap.get(p.node.id);
      const matchesAudience =
        audienceFilter === "todos"
        || (audienceFilter === HIDDEN_AUDIENCE_VALUE ? !audience : audience === audienceFilter);
      return matchesName && matchesAudience;
    });
  }, [products, filter, audienceFilter, audienceMap]);

  // Produto sem linha em product_audience nao aparece em lugar nenhum da loja --
  // nem catalogo, nem busca, nem home, nem pagina do produto. E fail-closed de
  // proposito, para nao vazar item de franquia para o consumidor, mas ate agora
  // acontecia em silencio: ninguem sabia que o item tinha sumido ate um cliente
  // reclamar de nao achar o produto.
  const semConfiguracao = useMemo(
    () => products.filter((product) => !audienceMap.get(product.node.id)).length,
    [products, audienceMap],
  );

  const filteredIds = useMemo(() => filtered.map((product) => product.node.id), [filtered]);
  const selectedFilteredCount = filteredIds.filter((id) => selectedIds.has(id)).length;
  const allFilteredSelected = filteredIds.length > 0 && selectedFilteredCount === filteredIds.length;

  const toggleAllFiltered = (checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      filteredIds.forEach((id) => checked ? next.add(id) : next.delete(id));
      return next;
    });
  };

  const toggleSelected = (productId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(productId);
      else next.delete(productId);
      return next;
    });
  };

  const applyAudienceVisibility = async (target: "cliente" | "franquia", visible: boolean) => {
    if (selectedIds.size === 0 || bulkSaving) return;

    const changes = [...selectedIds].map((productId) => {
      const current = audienceMap.get(productId) ?? null;
      const next: ProductAudience | null = target === "franquia"
        ? visible
          ? current === "cliente" ? "ambos" : current ?? "franquia"
          : current === "ambos" ? "cliente" : current === "franquia" ? null : current
        : visible
          ? current === "franquia" ? "ambos" : current ?? "cliente"
          : current === "ambos" ? "franquia" : current === "cliente" ? null : current;
      return { productId, current, next };
    }).filter((change) => change.next !== change.current);

    if (changes.length === 0) {
      toast.info("Os produtos selecionados já estão com essa configuração.");
      return;
    }

    setBulkSaving(true);
    const upserts = changes
      .filter((change): change is typeof change & { next: ProductAudience } => change.next !== null)
      .map((change) => ({ shopify_product_id: change.productId, audience: change.next }));
    const deletions = changes.filter((change) => change.next === null).map((change) => change.productId);

    const results: Array<{ error: { message: string } | null }> = [];
    if (upserts.length > 0) {
      results.push(await supabase.from("product_audience").upsert(upserts, { onConflict: "shopify_product_id" }));
    }
    for (let index = 0; index < deletions.length; index += 75) {
      results.push(await supabase.from("product_audience").delete().in("shopify_product_id", deletions.slice(index, index + 75)));
    }
    const failure = results.find((result) => result.error)?.error;
    setBulkSaving(false);

    if (failure) {
      toast.error("Erro ao alterar em massa: " + failure.message);
      await load();
      return;
    }

    invalidateAudienceCache();
    setAudienceRows((currentRows) => {
      const nextRows = new Map(currentRows.map((row) => [row.shopify_product_id, row.audience]));
      changes.forEach((change) => {
        if (change.next === null) nextRows.delete(change.productId);
        else nextRows.set(change.productId, change.next);
      });
      return [...nextRows].map(([shopify_product_id, audience]) => ({ shopify_product_id, audience }));
    });
    setSelectedIds(new Set());
    toast.success(`${changes.length} produto${changes.length === 1 ? "" : "s"} atualizado${changes.length === 1 ? "" : "s"}.`);
  };

  return (
    <Card>
      <CardHeader className="p-4 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Visibilidade por produto</CardTitle>
            <CardDescription className="mt-0.5">
              Escolha quem pode ver cada produto ou marque como oculto para removê-lo das duas lojas.
            </CardDescription>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Input
              placeholder="Filtrar produto..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-9 w-full sm:w-64"
            />
            <Select value={audienceFilter} onValueChange={(value) => setAudienceFilter(value as AudienceFilter)}>
              <SelectTrigger className="h-9 w-full sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="ambos">Ambos</SelectItem>
                <SelectItem value="cliente">Só cliente</SelectItem>
                <SelectItem value="franquia">Só franquia</SelectItem>
                <SelectItem value={HIDDEN_AUDIENCE_VALUE}>Ocultos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {!loading && semConfiguracao > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-amber-900">
            <EyeOff className="h-4 w-4 shrink-0" />
            <span className="mr-auto text-sm font-medium">
              {semConfiguracao} produto{semConfiguracao === 1 ? "" : "s"} sem visibilidade configurada
              {semConfiguracao === 1 ? " está invisível" : " estão invisíveis"} na loja e na franquia.
            </span>
            <Button
              variant="outline"
              size="sm"
              className="border-amber-400 bg-white text-amber-900 hover:bg-amber-100"
              onClick={() => setAudienceFilter(HIDDEN_AUDIENCE_VALUE)}
              disabled={audienceFilter === HIDDEN_AUDIENCE_VALUE}
            >
              Ver quais
            </Button>
          </div>
        )}
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-2.5">
          <Checkbox
            checked={allFilteredSelected ? true : selectedFilteredCount > 0 ? "indeterminate" : false}
            onCheckedChange={(checked) => toggleAllFiltered(checked === true)}
            aria-label="Selecionar todos os produtos filtrados"
            disabled={bulkSaving || filtered.length === 0}
          />
          <span className="mr-auto text-sm font-medium">
            {selectedIds.size === 0 ? "Selecionar produtos" : `${selectedIds.size} selecionado${selectedIds.size === 1 ? "" : "s"}`}
          </span>
          {selectedIds.size > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} disabled={bulkSaving}>
              Limpar
            </Button>
          )}
          <Button size="sm" onClick={() => void applyAudienceVisibility("franquia", true)} disabled={bulkSaving || selectedIds.size === 0}>
            {bulkSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
            Exibir na franquia
          </Button>
          <Button variant="outline" size="sm" onClick={() => void applyAudienceVisibility("franquia", false)} disabled={bulkSaving || selectedIds.size === 0}>
            <EyeOff className="mr-2 h-4 w-4" />
            Ocultar da franquia
          </Button>
          <Button size="sm" onClick={() => void applyAudienceVisibility("cliente", true)} disabled={bulkSaving || selectedIds.size === 0}>
            <Eye className="mr-2 h-4 w-4" />
            Exibir para cliente
          </Button>
          <Button variant="outline" size="sm" onClick={() => void applyAudienceVisibility("cliente", false)} disabled={bulkSaving || selectedIds.size === 0}>
            <EyeOff className="mr-2 h-4 w-4" />
            Ocultar do cliente
          </Button>
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">Nenhum produto.</p>
        ) : (
          <Table className="[&_th]:h-9 [&_td]:py-2.5">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allFilteredSelected ? true : selectedFilteredCount > 0 ? "indeterminate" : false}
                    onCheckedChange={(checked) => toggleAllFiltered(checked === true)}
                    aria-label="Selecionar todos os produtos filtrados"
                    disabled={bulkSaving}
                  />
                </TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="w-56">Visível para</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const current = audienceMap.get(p.node.id);
                const img = p.node.images.edges[0]?.node;
                return (
                  <TableRow key={p.node.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(p.node.id)}
                        onCheckedChange={(checked) => toggleSelected(p.node.id, checked === true)}
                        aria-label={`Selecionar ${p.node.title}`}
                        disabled={bulkSaving}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                          {img ? (
                            <img src={img.url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Package className="h-4 w-4 text-muted-foreground" />
                          )}
                        </span>
                        <span className="min-w-0">
                          {p.node.title}
                          {!current && (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                              Oculto
                            </span>
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Select
                          value={current ?? HIDDEN_AUDIENCE_VALUE}
                          onValueChange={(value) => handleChange(
                            p.node.id,
                            value as ProductAudience | typeof HIDDEN_AUDIENCE_VALUE,
                          )}
                          disabled={bulkSaving || savingId === p.node.id}
                        >
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={HIDDEN_AUDIENCE_VALUE}>Não exibir</SelectItem>
                            <SelectItem value="cliente">Só cliente</SelectItem>
                            <SelectItem value="franquia">Só franquia</SelectItem>
                            <SelectItem value="ambos">Ambos</SelectItem>
                          </SelectContent>
                        </Select>
                        {savingId === p.node.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
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

interface FranchPrice {
  shopify_product_id: string;
  shopify_variant_id: string;
  price: number;
}

function FranchisePricesPanel() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [prices, setPrices] = useState<FranchPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [price, setPrice] = useState("");

  const load = async () => {
    setLoading(true);
    const [shop, rows] = await Promise.all([
      fetchAllShopifyProducts(),
      supabase.from("franchise_prices").select("*").order("updated_at", { ascending: false }),
    ]);
    setProducts(shop);
    setPrices(((rows.data || []) as { shopify_product_id: string; shopify_variant_id: string; price: number }[]).map((r) => ({
      shopify_product_id: r.shopify_product_id,
      shopify_variant_id: r.shopify_variant_id,
      price: Number(r.price),
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const selectedProduct = useMemo(
    () => products.find((p) => p.node.id === productId),
    [products, productId]
  );

  const handleSave = async () => {
    if (!productId || !variantId || !price) return toast.error("Preencha todos os campos");
    const numeric = parseFloat(price.replace(",", "."));
    if (isNaN(numeric) || numeric <= 0) return toast.error("Preço inválido");
    setSaving(true);
    const { error } = await supabase
      .from("franchise_prices")
      .upsert(
        { shopify_variant_id: variantId, shopify_product_id: productId, price: numeric },
        { onConflict: "shopify_variant_id" }
      );
    setSaving(false);
    if (error) return toast.error("Erro: " + error.message);
    invalidateFranchisePricesCache();
    toast.success("Preço de franquia salvo");
    setProductId(""); setVariantId(""); setPrice("");
    load();
  };

  const handleDelete = async (variantId: string) => {
    const { error } = await supabase.from("franchise_prices").delete().eq("shopify_variant_id", variantId);
    if (error) return toast.error("Erro ao excluir");
    invalidateFranchisePricesCache();
    setPrices(prices.filter((p) => p.shopify_variant_id !== variantId));
    toast.success("Removido");
  };

  const productById = useMemo(() => {
    const m = new Map<string, ShopifyProduct["node"]>();
    products.forEach((p) => m.set(p.node.id, p.node));
    return m;
  }, [products]);

  const previewImage = selectedProduct?.node.images.edges[0]?.node;
  const previewVariant = selectedProduct?.node.variants.edges.find((v) => v.node.id === variantId)?.node
    || selectedProduct?.node.variants.edges[0]?.node;
  const previewPrice = previewVariant ? parseFloat(previewVariant.price.amount) : null;
  const previewFranchise = price ? parseFloat(price.replace(",", ".")) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Adicionar preço de franquia</CardTitle>
          <CardDescription>Preço exclusivo pago por franqueados.</CardDescription>
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
                    <p className="text-base font-bold tabular-nums">R$ {previewPrice.toFixed(2)}</p>
                    {previewFranchise !== null && !isNaN(previewFranchise) && previewFranchise > 0 && (
                      <div className="mt-1 flex items-center gap-1">
                        <span className="font-bold text-emerald-600 tabular-nums">
                          R$ {previewFranchise.toFixed(2)}
                        </span>
                        <Store className="h-3.5 w-3.5 text-emerald-600" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Form */}
            <div className="grid content-start gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium">Produto</label>
                <ProductPicker
                  products={products}
                  value={productId}
                  onChange={(v) => { setProductId(v); setVariantId(""); }}
                  placeholder="Selecione um produto..."
                />
              </div>
              {selectedProduct && (
                <div className="md:col-span-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <p className="text-sm font-medium text-emerald-900 mb-2">Variações disponíveis:</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedProduct.node.variants.edges.map((variant) => (
                      <span
                        key={variant.node.id}
                        className={`text-xs rounded px-2 py-1 ${variantId === variant.node.id ? 'bg-emerald-600 text-white border border-emerald-600' : 'bg-white border border-emerald-300 text-emerald-800'}`}
                      >
                        {variant.node.title} • R$ {parseFloat(variant.node.price.amount).toFixed(2)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium">Variante</label>
                <Select value={variantId} onValueChange={setVariantId} disabled={!selectedProduct}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {selectedProduct?.node.variants.edges.map((v) => (
                      <SelectItem key={v.node.id} value={v.node.id}>
                        {v.node.title} — R$ {parseFloat(v.node.price.amount).toFixed(2)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Preço franquia (R$)</label>
                <Input type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" />
              </div>
              <div className="md:col-span-2">
                <Button onClick={handleSave} disabled={saving} className="w-full">
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
                  <TableHead className="text-right">Preço franquia</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prices.map((sp) => {
                  const prod = productById.get(sp.shopify_product_id);
                  const variant = prod?.variants.edges.find((v) => v.node.id === sp.shopify_variant_id);
                  return (
                    <TableRow key={sp.shopify_variant_id}>
                      <TableCell className="font-medium">{prod?.title || "Produto removido"}</TableCell>
                      <TableCell>{variant?.node.title || sp.shopify_variant_id}</TableCell>
                      <TableCell className="text-right font-bold text-emerald-600">R$ {sp.price.toFixed(2)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(sp.shopify_variant_id)}>
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
