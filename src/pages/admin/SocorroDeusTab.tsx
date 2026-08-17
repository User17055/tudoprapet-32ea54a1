import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  const [saving, setSaving] = useState(false);
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

  const saveAll = async () => {
    const changes = Object.entries(drafts);
    if (changes.length === 0 || saving) return;

    const rowsByVariant = new Map(rows.map((row) => [row.variantId, row]));
    for (const [key, rawValue] of changes) {
      if (key.startsWith("aud:")) continue;
      const allowsEmpty = key.startsWith("sub:") || key.startsWith("fr:");
      const normalized = rawValue.replace(",", ".").trim();
      const value = Number(normalized);
      if ((!allowsEmpty || normalized !== "") && (!Number.isFinite(value) || value <= 0)) {
        toast.error("Existe um preço inválido. Corrija antes de salvar.");
        return;
      }
    }

    setSaving(true);
    const failed: Record<string, string> = {};
    let savedCount = 0;
    let changedFranchise = false;
    let changedAudience = false;

    for (const [key, rawValue] of changes) {
      try {
        const separator = key.indexOf(":");
        const kind = key.slice(0, separator);
        const id = key.slice(separator + 1);
        const row = rowsByVariant.get(id);
        const normalized = rawValue.replace(",", ".").trim();

        if (kind === "retail") {
          if (!row) throw new Error("Produto não encontrado");
          const { data, error } = await supabase.functions.invoke("admin-variant-price", {
            body: { productId: row.productId, variantId: row.variantId, price: Number(normalized) },
          });
          if (error || !data?.ok) throw new Error(data?.error || error?.message || "Falha na Shopify");
        } else if (kind === "sub") {
          if (!row) throw new Error("Produto não encontrado");
          const result = normalized === ""
            ? await supabase.from("subscriber_prices").delete().eq("shopify_variant_id", row.variantId)
            : await supabase.from("subscriber_prices").upsert(
                {
                  shopify_variant_id: row.variantId,
                  shopify_product_id: row.productId,
                  subscriber_price: Number(normalized),
                },
                { onConflict: "shopify_variant_id" },
              );
          if (result.error) throw result.error;
        } else if (kind === "fr") {
          if (!row) throw new Error("Produto não encontrado");
          const result = normalized === ""
            ? await supabase.from("franchise_prices").delete().eq("shopify_variant_id", row.variantId)
            : await supabase.from("franchise_prices").upsert(
                { shopify_variant_id: row.variantId, shopify_product_id: row.productId, price: Number(normalized) },
                { onConflict: "shopify_variant_id" },
              );
          if (result.error) throw result.error;
          changedFranchise = true;
        } else if (kind === "aud") {
          const value = rawValue as AudienceValue;
          const result = value === HIDDEN
            ? await supabase.from("product_audience").delete().eq("shopify_product_id", id)
            : await supabase
                .from("product_audience")
                .upsert({ shopify_product_id: id, audience: value }, { onConflict: "shopify_product_id" });
          if (result.error) throw result.error;
          changedAudience = true;
        }
        savedCount += 1;
      } catch (error) {
        failed[key] = rawValue;
        console.error(`Falha ao salvar ${key}:`, error);
      }
    }

    if (changedFranchise) invalidateFranchisePricesCache();
    if (changedAudience) invalidateAudienceCache();
    await load();
    setDrafts(failed);
    setSaving(false);

    if (Object.keys(failed).length > 0) {
      toast.error(`${savedCount} alterações salvas; ${Object.keys(failed).length} falharam e continuam marcadas.`);
    } else {
      toast.success(`${savedCount} alterações salvas com sucesso.`);
    }
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
          <div className="space-y-3 pb-20">
            {filtered.map((row) => {
              const current = audience.get(row.productId);
              const retailKey = `retail:${row.variantId}`;
              const subKey = `sub:${row.variantId}`;
              const frKey = `fr:${row.variantId}`;
              const audienceKey = `aud:${row.productId}`;
              const subValue = subscriber.get(row.variantId) ?? null;
              const frValue = franchise.get(row.variantId) ?? null;
              return (
                <div key={row.variantId} className="min-w-0 rounded-xl border border-border bg-card p-3 shadow-sm">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                      {row.image ? (
                        <img src={row.image} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Package className="h-5 w-5 text-muted-foreground" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-semibold leading-snug">{row.productTitle}</span>
                      <span className="block text-xs text-muted-foreground">{row.variantTitle}</span>
                      {!current && (
                        <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
                          Oculto
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <label className="min-w-0 space-y-1">
                      <span className="text-xs font-semibold text-muted-foreground">Preço normal</span>
                      <Input
                        type="number"
                        step="0.01"
                        className="h-9 w-full tabular-nums"
                        value={draftOf(retailKey, row.retail)}
                        onChange={(e) => setDraft(retailKey, e.target.value)}
                        disabled={saving}
                      />
                    </label>
                    <label className="min-w-0 space-y-1">
                      <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                        <Crown className="h-3.5 w-3.5 text-sky-500" />Preço assinante
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="—"
                        className="h-9 w-full tabular-nums"
                        value={draftOf(subKey, subValue)}
                        onChange={(e) => setDraft(subKey, e.target.value)}
                        disabled={saving}
                      />
                    </label>
                    <label className="min-w-0 space-y-1">
                      <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                        <Store className="h-3.5 w-3.5 text-emerald-600" />Preço franquia
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="—"
                        className="h-9 w-full tabular-nums"
                        value={draftOf(frKey, frValue)}
                        onChange={(e) => setDraft(frKey, e.target.value)}
                        disabled={saving}
                      />
                    </label>
                    <div className="min-w-0 space-y-1">
                      <span className="text-xs font-semibold text-muted-foreground">Visibilidade</span>
                      <Select
                        value={(drafts[audienceKey] as AudienceValue | undefined) ?? current ?? HIDDEN}
                        onValueChange={(value) => setDraft(audienceKey, value)}
                        disabled={saving}
                      >
                        <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={HIDDEN}>Não exibir</SelectItem>
                          <SelectItem value="cliente">Só cliente</SelectItem>
                          <SelectItem value="franquia">Só franquia</SelectItem>
                          <SelectItem value="ambos">Ambos</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              );
            })}

            <div className="fixed bottom-4 left-4 right-4 z-50 flex items-center justify-between gap-4 rounded-xl border border-[#173a70]/20 bg-white/95 p-3 shadow-2xl backdrop-blur sm:left-auto sm:w-auto sm:min-w-[340px]">
              <span className="text-sm font-medium text-muted-foreground">
                {Object.keys(drafts).length === 0
                  ? "Nenhuma alteração"
                  : `${Object.keys(drafts).length} alteração(õ) pendente(s)`}
              </span>
              <Button onClick={saveAll} disabled={saving || Object.keys(drafts).length === 0}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar alterações
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
