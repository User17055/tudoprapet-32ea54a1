import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trash2, Loader2, Store, Tag } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { storefrontApiRequest, PRODUCTS_QUERY, type ShopifyProduct } from "@/lib/shopify";
import { invalidateAudienceCache, type ProductAudience } from "@/hooks/useProductAudience";
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

function AudiencePanel() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [audienceRows, setAudienceRows] = useState<AudienceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = async () => {
    setLoading(true);
    const [shop, aud] = await Promise.all([
      storefrontApiRequest(PRODUCTS_QUERY, { first: 100 }),
      supabase.from("product_audience").select("shopify_product_id, audience"),
    ]);
    setProducts(shop?.data?.products?.edges || []);
    setAudienceRows((aud.data || []) as AudienceRow[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const audienceMap = useMemo(() => {
    const m = new Map<string, ProductAudience>();
    audienceRows.forEach((r) => m.set(r.shopify_product_id, r.audience));
    return m;
  }, [audienceRows]);

  const handleChange = async (productId: string, audience: ProductAudience) => {
    setSavingId(productId);
    const { error } = await supabase
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
      return [...other, { shopify_product_id: productId, audience }];
    });
    toast.success("Visibilidade atualizada");
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.node.title.toLowerCase().includes(q));
  }, [products, filter]);

  return (
    <Card>
      <CardHeader className="p-4 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Visibilidade por produto</CardTitle>
            <CardDescription className="mt-0.5">
              Somente produtos marcados como Cliente, Franquia ou Ambos aparecem na loja. Sem configuração = oculto.
            </CardDescription>
          </div>
          <Input
            placeholder="Filtrar produto..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-9 w-full sm:w-64"
          />
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">Nenhum produto.</p>
        ) : (
          <Table className="[&_th]:h-9 [&_td]:py-2.5">
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="w-56">Visível para</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const current = audienceMap.get(p.node.id);
                return (
                  <TableRow key={p.node.id}>
                    <TableCell className="font-medium">
                      {p.node.title}
                      {!current && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                          Oculto
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Select
                          value={current ?? ""}
                          onValueChange={(v) => handleChange(p.node.id, v as ProductAudience)}
                          disabled={savingId === p.node.id}
                        >
                          <SelectTrigger className="h-8"><SelectValue placeholder="Não exibir" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cliente">Cliente</SelectItem>
                            <SelectItem value="franquia">Franquia</SelectItem>
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
      storefrontApiRequest(PRODUCTS_QUERY, { first: 100 }),
      supabase.from("franchise_prices").select("*").order("updated_at", { ascending: false }),
    ]);
    setProducts(shop?.data?.products?.edges || []);
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

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3">
          <CardTitle className="text-base">Adicionar preço de franquia</CardTitle>
          <CardDescription>Preço exclusivo pago por franqueados.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0 md:grid-cols-3">
          <div className="md:col-span-3">
            <label className="mb-1 block text-sm font-medium">Produto</label>
            <Select value={productId} onValueChange={(v) => { setProductId(v); setVariantId(""); }}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.node.id} value={p.node.id}>{p.node.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
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
          <div className="md:col-span-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Salvar
            </Button>
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
