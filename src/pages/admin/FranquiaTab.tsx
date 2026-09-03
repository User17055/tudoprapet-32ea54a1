import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trash2, Loader2, Store, Tag, Package, Eye, EyeOff, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { storefrontApiRequest, PRODUCTS_QUERY, type ShopifyProduct } from "@/lib/shopify";
import { fetchAllShopifyProducts } from "@/lib/shopify";
import { ProductPicker } from "@/components/admin/ProductPicker";
import { fetchAllProductAudience, invalidateAudienceCache, type ProductAudience } from "@/hooks/useProductAudience";
import { invalidateFranchisePricesCache } from "@/hooks/useFranchisePrices";
import { cn } from "@/lib/utils";

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

type FranchisePriceCalculationMode = "automatic" | "manual";
type FranchisePriceAdjustment = "percentage" | "amount";
type FranchisePriceFilter = "all" | "registered" | "unregistered";

function FranchisePricesPanel() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [prices, setPrices] = useState<FranchPrice[]>([]);
  const [customerPrices, setCustomerPrices] = useState<{ shopify_variant_id: string; price: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [calculationMode, setCalculationMode] = useState<FranchisePriceCalculationMode>("automatic");
  const [manualCost, setManualCost] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<FranchisePriceAdjustment>("percentage");
  const [adjustment, setAdjustment] = useState("0");
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState("");
  const [updatingPrice, setUpdatingPrice] = useState(false);
  const [registrationFilter, setRegistrationFilter] = useState<FranchisePriceFilter>("all");

  const loadAll = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [shop, franchise, customer] = await Promise.all([
        fetchAllShopifyProducts(),
        supabase.from("franchise_prices").select("*").order("updated_at", { ascending: false }),
        supabase.from("customer_prices").select("shopify_variant_id,price"),
      ]);
      if (franchise.error) throw franchise.error;
      if (customer.error) throw customer.error;
      setProducts(shop);
      setPrices((franchise.data || []).map((row) => ({ ...row, price: Number(row.price) })));
      setCustomerPrices((customer.data || []).map((row) => ({ ...row, price: Number(row.price) })));
    } catch (error) {
      if (!silent) toast.error("Erro ao carregar dados");
      console.error(error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    const onFocus = () => loadAll(true);
    window.addEventListener("focus", onFocus);
    const channel = supabase
      .channel("admin-franchise-prices")
      .on("postgres_changes", { event: "*", schema: "public", table: "franchise_prices" }, () => loadAll(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_prices" }, () => loadAll(true))
      .subscribe();
    return () => {
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, []);

  const selectedProduct = useMemo(
    () => products.find((p) => p.node.id === productId),
    [products, productId]
  );

  const registeredProductIds = useMemo(
    () => new Set(prices.map((item) => item.shopify_product_id)),
    [prices],
  );

  const priceByProductId = useMemo(() => {
    const map = new Map<string, FranchPrice>();
    prices.forEach((item) => map.set(item.shopify_product_id, item));
    return map;
  }, [prices]);

  const listedProducts = useMemo(() => products.filter((product) => {
    const registered = registeredProductIds.has(product.node.id);
    if (registrationFilter === "registered") return registered;
    if (registrationFilter === "unregistered") return !registered;
    return true;
  }), [products, registeredProductIds, registrationFilter]);

  useEffect(() => {
    if (productId && registeredProductIds.has(productId)) {
      setProductId("");
      setVariantId("");
      setManualCost("");
      setAdjustment("0");
    }
  }, [productId, registeredProductIds]);

  const selectedVariant = selectedProduct?.node.variants.edges.find((variant) => variant.node.id === variantId)?.node
    || selectedProduct?.node.variants.edges[0]?.node;
  const shopifyPrice = selectedVariant ? Number(selectedVariant.price.amount) : null;
  const selectedCustomerPrice = selectedVariant
    ? customerPrices.find((row) => row.shopify_variant_id === selectedVariant.id)?.price ?? shopifyPrice
    : null;
  const estimatedCost = selectedCustomerPrice === null ? null : selectedCustomerPrice / 2;
  const manualCostValue = Number(manualCost.replace(",", "."));
  const calculationBaseCost = calculationMode === "manual"
    ? (manualCost.trim() !== "" && Number.isFinite(manualCostValue) ? manualCostValue : null)
    : estimatedCost;
  const adjustmentValue = Number(adjustment.replace(",", "."));
  const calculatedFranchisePrice = calculationBaseCost === null || !Number.isFinite(adjustmentValue)
    ? null
    : Math.round((adjustmentType === "percentage"
      ? calculationBaseCost * (1 + adjustmentValue / 100)
      : calculationBaseCost + adjustmentValue) * 100) / 100;

  const handleSave = async () => {
    if (!productId || !variantId) return toast.error("Preencha todos os campos");
    if (registeredProductIds.has(productId)) return toast.error("Este produto já possui preço de franquia cadastrado.");
    if (!Number.isFinite(adjustmentValue) || adjustmentValue < 0) return toast.error("Informe um reajuste igual ou maior que zero");
    if (calculationMode === "manual" && (calculationBaseCost === null || calculationBaseCost <= 0)) {
      return toast.error("Informe um custo manual maior que zero");
    }
    if (calculatedFranchisePrice === null || calculatedFranchisePrice <= 0) return toast.error("Preço inválido");
    setSaving(true);
    const { error } = await supabase
      .from("franchise_prices")
      .upsert(
        { shopify_variant_id: variantId, shopify_product_id: productId, price: calculatedFranchisePrice },
        { onConflict: "shopify_variant_id" }
      );
    setSaving(false);
    if (error) return toast.error("Erro: " + error.message);
    invalidateFranchisePricesCache();
    toast.success("Preço de franquia salvo");
    setProductId(""); setVariantId(""); setManualCost(""); setAdjustment("0");
    loadAll(true);
  };

  const handleDelete = async (variantId: string) => {
    const { error } = await supabase.from("franchise_prices").delete().eq("shopify_variant_id", variantId);
    if (error) return toast.error("Erro ao excluir");
    invalidateFranchisePricesCache();
    setPrices((current) => current.filter((item) => item.shopify_variant_id !== variantId));
    if (editingVariantId === variantId) {
      setEditingVariantId(null);
      setEditingPrice("");
    }
    toast.success("Removido");
  };

  const startEditingPrice = (item: FranchPrice) => {
    setEditingVariantId(item.shopify_variant_id);
    setEditingPrice(String(item.price));
  };

  const cancelEditingPrice = () => {
    setEditingVariantId(null);
    setEditingPrice("");
  };

  const handleUpdatePrice = async (item: FranchPrice) => {
    if (updatingPrice) return;
    const numeric = parseFloat(editingPrice.replace(",", "."));
    if (isNaN(numeric) || numeric <= 0) return toast.error("Preço inválido");
    setUpdatingPrice(true);
    const { error } = await supabase
      .from("franchise_prices")
      .update({ price: numeric })
      .eq("shopify_variant_id", item.shopify_variant_id);
    setUpdatingPrice(false);
    if (error) return toast.error("Erro ao atualizar: " + error.message);
    invalidateFranchisePricesCache();
    setPrices((current) => current.map((row) => row.shopify_variant_id === item.shopify_variant_id ? { ...row, price: numeric } : row));
    cancelEditingPrice();
    toast.success("Preço atualizado!");
  };

  const previewImage = selectedProduct?.node.images.edges[0]?.node;
  const previewVariant = selectedVariant;
  const previewPrice = previewVariant ? parseFloat(previewVariant.price.amount) : null;
  const previewCompare = previewVariant?.compareAtPrice ? parseFloat(previewVariant.compareAtPrice.amount) : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Adicionar preço de franquia</CardTitle>
          <CardDescription>
            Escolha entre usar o custo estimado atual ou informar o custo manualmente e aplicar o reajuste desejado.
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
                      <p className="text-[11px] text-muted-foreground line-through tabular-nums">R$ {previewCompare.toFixed(2)}</p>
                    )}
                    <p className="text-base font-bold tabular-nums">R$ {previewPrice.toFixed(2)}</p>
                    {calculatedFranchisePrice !== null && calculatedFranchisePrice > 0 && (
                      <div className="mt-1 flex items-center gap-1">
                        <span className="font-bold text-emerald-600 tabular-nums">
                          R$ {calculatedFranchisePrice.toFixed(2)}
                        </span>
                        <Store className="h-3.5 w-3.5 text-emerald-600" />
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
                  excludeIds={registeredProductIds}
                  onChange={(value) => { setProductId(value); setVariantId(""); setManualCost(""); setAdjustment("0"); }}
                  placeholder="Pesquisar ou selecionar um produto..."
                />
              </div>
              <div className="md:col-span-4">
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
              <div className="md:col-span-4">
                <label className="mb-1 block text-sm font-medium">Modo de cálculo</label>
                <Select value={calculationMode} onValueChange={(value) => setCalculationMode(value as FranchisePriceCalculationMode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="automatic">Automático (custo estimado atual)</SelectItem>
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
                    <label className="mb-1 block text-sm font-medium">Custo estimado (50%)</label>
                    <Input value={estimatedCost === null ? "" : `R$ ${estimatedCost.toFixed(2)}`} readOnly placeholder="Selecione a variante" />
                  </div>
                </>
              ) : (
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium">Custo manual (R$)</label>
                  <Input type="number" min="0.01" step="0.01" value={manualCost} onChange={(event) => setManualCost(event.target.value)} placeholder="Ex: 50,00" />
                  <p className="mt-1 text-xs text-muted-foreground">Use margem de 0% para manter o preço igual ao custo.</p>
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium">Forma de reajuste</label>
                <Select value={adjustmentType} onValueChange={(value) => setAdjustmentType(value as FranchisePriceAdjustment)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Margem em %</SelectItem>
                    <SelectItem value="amount">Acréscimo em R$</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{adjustmentType === "percentage" ? "Margem (%)" : "Acréscimo (R$)"}</label>
                <Input type="number" min="0" step={adjustmentType === "percentage" ? "1" : "0.01"} value={adjustment} onChange={(event) => setAdjustment(event.target.value)} placeholder="0" />
              </div>
              <div className="rounded-lg bg-emerald-50 p-3 md:col-span-4">
                <p className="text-xs font-medium text-emerald-700">Preço calculado para a franquia</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
                  {calculatedFranchisePrice === null ? "—" : `R$ ${calculatedFranchisePrice.toFixed(2)}`}
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
              <CardDescription>Todos os produtos do Shopify e seus preços para franquias.</CardDescription>
            </div>
            <Select value={registrationFilter} onValueChange={(value) => setRegistrationFilter(value as FranchisePriceFilter)}>
              <SelectTrigger className="h-9 w-full sm:w-48"><SelectValue /></SelectTrigger>
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
                  <TableHead className="text-right">Custo estimado</TableHead>
                  <TableHead className="text-right">Preço franquia</TableHead>
                  <TableHead className="w-28"><span className="sr-only">Ações</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listedProducts.map((product) => {
                  const registeredPrice = priceByProductId.get(product.node.id);
                  const firstVariant = product.node.variants.edges[0]?.node;
                  const registeredVariant = registeredPrice
                    ? product.node.variants.edges.find((variant) => variant.node.id === registeredPrice.shopify_variant_id)?.node
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
                            {productImage ? <img src={productImage.url} alt={productImage.altText || product.node.title} className="h-full w-full object-cover" loading="lazy" /> : <Package className="h-5 w-5 text-muted-foreground" />}
                          </div>
                          <span className="font-medium line-clamp-2">{product.node.title}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", registeredPrice ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>
                          <span className={cn("h-1.5 w-1.5 rounded-full", registeredPrice ? "bg-emerald-500" : "bg-amber-500")} />
                          {registeredPrice ? "Cadastrado" : "Não cadastrado"}
                        </span>
                      </TableCell>
                      <TableCell>{displayedVariant?.title || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{customerPrice === null ? "—" : `R$ ${customerPrice.toFixed(2)}`}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{customerPrice === null ? "—" : `R$ ${(customerPrice / 2).toFixed(2)}`}</TableCell>
                      <TableCell className="text-right">
                        {registeredPrice ? editingVariantId === registeredPrice.shopify_variant_id ? (
                          <div className="ml-auto flex w-36 items-center gap-2">
                            <span className="text-sm text-muted-foreground">R$</span>
                            <Input type="number" min="0.01" step="0.01" value={editingPrice} onChange={(event) => setEditingPrice(event.target.value)} disabled={updatingPrice} onKeyDown={(event) => { if (event.key === "Enter") handleUpdatePrice(registeredPrice); if (event.key === "Escape") cancelEditingPrice(); }} className="h-8 text-right font-bold" autoFocus aria-label={`Novo preço de ${product.node.title}`} />
                          </div>
                        ) : <span className="font-bold text-emerald-600 tabular-nums">R$ {registeredPrice.price.toFixed(2)}</span> : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {registeredPrice ? (
                          <div className="flex justify-end">
                            {editingVariantId === registeredPrice.shopify_variant_id ? <>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600" onClick={() => handleUpdatePrice(registeredPrice)} disabled={updatingPrice} aria-label="Salvar novo preço">{updatingPrice ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={cancelEditingPrice} disabled={updatingPrice} aria-label="Cancelar edição"><X className="h-4 w-4" /></Button>
                            </> : <>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEditingPrice(registeredPrice)} aria-label={`Editar preço de ${product.node.title}`}><Pencil className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(registeredPrice.shopify_variant_id)} aria-label={`Excluir preço de ${product.node.title}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </>}
                          </div>
                        ) : (
                          <Button variant="outline" size="sm" disabled={!firstVariant} onClick={() => { setProductId(product.node.id); setVariantId(firstVariant?.id || ""); setManualCost(""); setAdjustment("0"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
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
    </div>
  );
}
