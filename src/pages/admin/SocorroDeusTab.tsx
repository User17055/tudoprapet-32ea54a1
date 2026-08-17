import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Crown, Loader2, Package, RefreshCw, Store } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllShopifyProducts, type ShopifyProduct } from "@/lib/shopify";
import { invalidateAudienceCache, type ProductAudience } from "@/hooks/useProductAudience";
import { invalidateFranchisePricesCache } from "@/hooks/useFranchisePrices";

const HIDDEN = "oculto";
type AudienceValue = ProductAudience | typeof HIDDEN;
type VisibilityFilter = "todos" | AudienceValue;

interface Row {
  productId: string;
  productTitle: string;
  image?: string;
  variantId: string;
  variantTitle: string;
  retail: number;
}

function toMoney(value: number) {
  return value.toFixed(2);
}

export default function SocorroDeusTab() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [subscriber, setSubscriber] = useState<Map<string, number>>(new Map());
  const [franchise, setFranchise] = useState<Map<string, number>>(new Map());
  const [audience, setAudience] = useState<Map<string, ProductAudience>>(new Map());
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [visibility, setVisibility] = useState<VisibilityFilter>("todos");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    const [shop, sub, fr, aud] = await Promise.all([
      fetchAllShopifyProducts(),
      supabase.from("subscriber_prices").select("shopify_variant_id, subscriber_price"),
      supabase.from("franchise_prices").select("shopify_variant_id, price"),
      supabase.from("product_audience").select("shopify_product_id, audience"),
    ]);
    setProducts(shop);
    setSubscriber(new Map((sub.data || []).map((r) => [r.shopify_variant_id, Number(r.subscriber_price)])));
    setFranchise(new Map((fr.data || []).map((r) => [r.shopify_variant_id, Number(r.price)])));
    setAudience(
      new Map(
        ((aud.data || []) as { shopify_product_id: string; audience: ProductAudience }[]).map(
          (r) => [r.shopify_product_id, r.audience],
        ),
      ),
    );
    setDrafts({});
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo<Row[]>(
    () =>
      products.flatMap((p) =>
        p.node.variants.edges.map((v) => ({
          productId: p.node.id,
          productTitle: p.node.title,
          image: p.node.images.edges[0]?.node.url,
          variantId: v.node.id,
          variantTitle: v.node.title,
          retail: parseFloat(v.node.price.amount),
        })),
      ),
    [products],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesName = !q || r.productTitle.toLowerCase().includes(q);
      const current = audience.get(r.productId);
      const matchesVisibility =
        visibility === "todos" || (visibility === HIDDEN ? !current : current === visibility);
      return matchesName && matchesVisibility;
    });
  }, [rows, search, visibility, audience]);

  const draftOf = (key: string, fallback: number | null) =>
    drafts[key] ?? (fallback !== null ? toMoney(fallback) : "");

  const setDraft = (key: string, value: string) =>
    setDrafts((prev) => ({ ...prev, [key]: value }));

  const saveRetail = async (row: Row) => {
    const key = `retail:${row.variantId}`;
    const value = parseFloat((drafts[key] ?? "").replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) return toast.error("Preço inválido");
    setSavingKey(key);
    const { data, error } = await supabase.functions.invoke("admin-variant-price", {
      body: { productId: row.productId, variantId: row.variantId, price: value },
    });
    setSavingKey(null);
    if (error || !data?.ok) {
      toast.error("Erro ao salvar na Shopify: " + (error?.message || "tente novamente"));
      return;
    }
    setProducts((prev) =>
      prev.map((p) =>
        p.node.id !== row.productId
          ? p
          : {
              ...p,
              node: {
                ...p.node,
                variants: {
                  ...p.node.variants,
                  edges: p.node.variants.edges.map((v) =>
                    v.node.id !== row.variantId
                      ? v
                      : { ...v, node: { ...v.node, price: { ...v.node.price, amount: toMoney(value) } } },
                  ),
                },
              },
            },
      ),
    );
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    toast.success("Preço normal atualizado na Shopify");
  };

  const saveSubscriber = async (row: Row) => {
    const key = `sub:${row.variantId}`;
    const raw = (drafts[key] ?? "").replace(",", ".").trim();
    setSavingKey(key);
    if (raw === "") {
      const { error } = await supabase
        .from("subscriber_prices")
        .delete()
        .eq("shopify_variant_id", row.variantId);
      setSavingKey(null);
      if (error) return toast.error("Erro ao remover: " + error.message);
      setSubscriber((prev) => {
        const next = new Map(prev);
        next.delete(row.variantId);
        return next;
      });
      toast.success("Preço de assinante removido");
      return;
    }
    const value = parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) {
      setSavingKey(null);
      return toast.error("Preço inválido");
    }
    const { error } = await supabase.from("subscriber_prices").upsert(
      {
        shopify_variant_id: row.variantId,
        shopify_product_id: row.productId,
        subscriber_price: value,
      },
      { onConflict: "shopify_variant_id" },
    );
    setSavingKey(null);
    if (error) return toast.error("Erro ao salvar: " + error.message);
    setSubscriber((prev) => new Map(prev).set(row.variantId, value));
    toast.success("Preço de assinante salvo");
  };

  const saveFranchise = async (row: Row) => {
    const key = `fr:${row.variantId}`;
    const raw = (drafts[key] ?? "").replace(",", ".").trim();
    setSavingKey(key);
    if (raw === "") {
      const { error } = await supabase
        .from("franchise_prices")
        .delete()
        .eq("shopify_variant_id", row.variantId);
      setSavingKey(null);
      if (error) return toast.error("Erro ao remover: " + error.message);
      invalidateFranchisePricesCache();
      setFranchise((prev) => {
        const next = new Map(prev);
        next.delete(row.variantId);
        return next;
      });
      toast.success("Preço de franquia removido");
      return;
    }
    const value = parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) {
      setSavingKey(null);
      return toast.error("Preço inválido");
    }
    const { error } = await supabase.from("franchise_prices").upsert(
      { shopify_variant_id: row.variantId, shopify_product_id: row.productId, price: value },
      { onConflict: "shopify_variant_id" },
    );
    setSavingKey(null);
    if (error) return toast.error("Erro ao salvar: " + error.message);
    invalidateFranchisePricesCache();
    setFranchise((prev) => new Map(prev).set(row.variantId, value));
    toast.success("Preço de franquia salvo");
  };

  const changeAudience = async (productId: string, value: AudienceValue) => {
    const key = `aud:${productId}`;
    setSavingKey(key);
    const { error } = value === HIDDEN
      ? await supabase.from("product_audience").delete().eq("shopify_product_id", productId)
      : await supabase
          .from("product_audience")
          .upsert({ shopify_product_id: productId, audience: value }, { onConflict: "shopify_product_id" });
    setSavingKey(null);
    if (error) return toast.error("Erro ao salvar: " + error.message);
    invalidateAudienceCache();
    setAudience((prev) => {
      const next = new Map(prev);
      if (value === HIDDEN) next.delete(productId);
      else next.set(productId, value);
      return next;
    });
    toast.success(value === HIDDEN ? "Produto ocultado" : "Visibilidade atualizada");
  };

  const hiddenCount = rows.filter((r) => !audience.get(r.productId)).length;

  return (
    <Card>
      <CardHeader className="p-4 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Socorro Deus</CardTitle>
            <CardDescription className="mt-0.5">
              Todos os preços em um só lugar: normal (Shopify), assinante e franquia — e se o produto está oculto.
              {!loading && ` ${rows.length} variantes • ${hiddenCount} em produtos ocultos.`}
            </CardDescription>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Input
              placeholder="Filtrar produto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full sm:w-56"
            />
            <Select value={visibility} onValueChange={(v) => setVisibility(v as VisibilityFilter)}>
              <SelectTrigger className="h-9 w-full sm:w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="ambos">Ambos</SelectItem>
                <SelectItem value="cliente">Só cliente</SelectItem>
                <SelectItem value="franquia">Só franquia</SelectItem>
                <SelectItem value={HIDDEN}>Ocultos</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-9" onClick={load} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />Recarregar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">Nenhum produto.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="[&_th]:h-9 [&_td]:py-2.5">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">Produto / variante</TableHead>
                  <TableHead className="w-44">Preço normal</TableHead>
                  <TableHead className="w-44">Preço assinante</TableHead>
                  <TableHead className="w-44">Preço franquia</TableHead>
                  <TableHead className="w-44">Visibilidade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const current = audience.get(row.productId);
                  const retailKey = `retail:${row.variantId}`;
                  const subKey = `sub:${row.variantId}`;
                  const frKey = `fr:${row.variantId}`;
                  const subValue = subscriber.get(row.variantId) ?? null;
                  const frValue = franchise.get(row.variantId) ?? null;
                  return (
                    <TableRow key={row.variantId}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                            {row.image ? (
                              <img src={row.image} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <Package className="h-4 w-4 text-muted-foreground" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate">{row.productTitle}</span>
                            <span className="block text-xs text-muted-foreground">{row.variantTitle}</span>
                            {!current && (
                              <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                                Oculto
                              </span>
                            )}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="number"
                            step="0.01"
                            className="h-8 w-24 tabular-nums"
                            value={draftOf(retailKey, row.retail)}
                            onChange={(e) => setDraft(retailKey, e.target.value)}
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-8"
                            disabled={savingKey === retailKey || drafts[retailKey] === undefined}
                            onClick={() => saveRetail(row)}
                          >
                            {savingKey === retailKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Crown className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="—"
                            className="h-8 w-24 tabular-nums"
                            value={draftOf(subKey, subValue)}
                            onChange={(e) => setDraft(subKey, e.target.value)}
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-8"
                            disabled={savingKey === subKey || drafts[subKey] === undefined}
                            onClick={() => saveSubscriber(row)}
                          >
                            {savingKey === subKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Store className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          <Input
                            type="number"
                            step="0.01"
                            placeholder="—"
                            className="h-8 w-24 tabular-nums"
                            value={draftOf(frKey, frValue)}
                            onChange={(e) => setDraft(frKey, e.target.value)}
                          />
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-8"
                            disabled={savingKey === frKey || drafts[frKey] === undefined}
                            onClick={() => saveFranchise(row)}
                          >
                            {savingKey === frKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Salvar"}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={current ?? HIDDEN}
                          onValueChange={(v) => changeAudience(row.productId, v as AudienceValue)}
                          disabled={savingKey === `aud:${row.productId}`}
                        >
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={HIDDEN}>Não exibir</SelectItem>
                            <SelectItem value="cliente">Só cliente</SelectItem>
                            <SelectItem value="franquia">Só franquia</SelectItem>
                            <SelectItem value="ambos">Ambos</SelectItem>
                          </SelectContent>
                        </Select>
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
