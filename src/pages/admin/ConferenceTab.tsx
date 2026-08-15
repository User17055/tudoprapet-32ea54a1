import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EyeOff, Loader2, Package, RefreshCw, Search, Tag, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllShopifyProducts, type ShopifyProduct } from "@/lib/shopify";
import type { ProductAudience } from "@/hooks/useProductAudience";

interface AudienceRow {
  shopify_product_id: string;
  audience: ProductAudience;
}

interface SubscriberPriceRow {
  shopify_variant_id: string;
  subscriber_price: number;
}

type VisibilityFilter = "todos" | ProductAudience | "oculto";
type PriceFilter = "todos" | "com_preco" | "sem_preco";

const money = (value: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value || 0);

function visibilityLabel(audience: ProductAudience | null) {
  if (!audience) return "Oculto";
  if (audience === "cliente") return "Só cliente";
  if (audience === "franquia") return "Só franquia";
  return "Clientes e franquias";
}

function visibilityClass(audience: ProductAudience | null) {
  if (!audience) return "border-slate-300 bg-slate-100 text-slate-700";
  if (audience === "cliente") return "border-blue-200 bg-blue-50 text-blue-700";
  if (audience === "franquia") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export default function ConferenceTab() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [audiences, setAudiences] = useState<AudienceRow[]>([]);
  const [subscriberPrices, setSubscriberPrices] = useState<SubscriberPriceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [visibility, setVisibility] = useState<VisibilityFilter>("todos");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("todos");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [shopifyProducts, audienceResult, subscriberResult] = await Promise.all([
        fetchAllShopifyProducts(),
        supabase.from("product_audience").select("shopify_product_id,audience"),
        supabase.from("subscriber_prices").select("shopify_variant_id,subscriber_price"),
      ]);
      if (audienceResult.error) throw audienceResult.error;
      if (subscriberResult.error) throw subscriberResult.error;
      setProducts(shopifyProducts);
      setAudiences((audienceResult.data || []) as AudienceRow[]);
      setSubscriberPrices(
        ((subscriberResult.data || []) as SubscriberPriceRow[]).map((row) => ({
          ...row,
          subscriber_price: Number(row.subscriber_price),
        })),
      );
    } catch (error) {
      toast.error("Não foi possível carregar a conferência", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const audienceMap = useMemo(
    () => new Map(audiences.map((row) => [row.shopify_product_id, row.audience])),
    [audiences],
  );
  const subscriberMap = useMemo(
    () => new Map(subscriberPrices.map((row) => [row.shopify_variant_id, row.subscriber_price])),
    [subscriberPrices],
  );

  const rows = useMemo(() => products.flatMap((product) => {
    const audience = audienceMap.get(product.node.id) ?? null;
    const image = product.node.images.edges[0]?.node ?? null;
    return product.node.variants.edges.map(({ node: variant }) => ({
      productId: product.node.id,
      productTitle: product.node.title,
      vendor: product.node.vendor || "",
      image,
      variant,
      audience,
      subscriberPrice: subscriberMap.get(variant.id) ?? null,
    }));
  }).sort((left, right) =>
    left.productTitle.localeCompare(right.productTitle, "pt-BR") ||
    left.variant.title.localeCompare(right.variant.title, "pt-BR")
  ), [products, audienceMap, subscriberMap]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery = !normalizedQuery ||
        `${row.productTitle} ${row.variant.title} ${row.vendor}`.toLowerCase().includes(normalizedQuery);
      const matchesVisibility = visibility === "todos" ||
        (visibility === "oculto" ? row.audience === null : row.audience === visibility);
      const matchesPrice = priceFilter === "todos" ||
        (priceFilter === "com_preco" ? row.subscriberPrice !== null : row.subscriberPrice === null);
      return matchesQuery && matchesVisibility && matchesPrice;
    });
  }, [rows, query, visibility, priceFilter]);

  const hiddenProducts = useMemo(
    () => new Set(rows.filter((row) => row.audience === null).map((row) => row.productId)).size,
    [rows],
  );
  const missingSubscriberPrices = rows.filter((row) => row.subscriberPrice === null).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={Package} label="Produtos" value={products.length} />
        <SummaryCard icon={Tag} label="Variações" value={rows.length} />
        <SummaryCard icon={EyeOff} label="Produtos ocultos" value={hiddenProducts} tone="slate" />
        <SummaryCard icon={Users} label="Sem preço de assinante" value={missingSubscriberPrices} tone="amber" />
      </div>

      <Card>
        <CardHeader className="p-4 pb-3">
          <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-end">
            <div>
              <CardTitle className="text-base">Conferência do catálogo</CardTitle>
              <CardDescription className="mt-1">
                Preços são exibidos por variação. Produto sem audiência configurada está oculto na loja.
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative sm:w-72">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar produto, variação ou marca"
                  className="h-9 pl-9"
                />
              </div>
              <Select value={visibility} onValueChange={(value) => setVisibility(value as VisibilityFilter)}>
                <SelectTrigger className="h-9 sm:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Toda visibilidade</SelectItem>
                  <SelectItem value="oculto">Ocultos</SelectItem>
                  <SelectItem value="cliente">Só cliente</SelectItem>
                  <SelectItem value="franquia">Só franquia</SelectItem>
                  <SelectItem value="ambos">Clientes e franquias</SelectItem>
                </SelectContent>
              </Select>
              <Select value={priceFilter} onValueChange={(value) => setPriceFilter(value as PriceFilter)}>
                <SelectTrigger className="h-9 sm:w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todo preço de clube</SelectItem>
                  <SelectItem value="com_preco">Com preço de assinante</SelectItem>
                  <SelectItem value="sem_preco">Sem preço de assinante</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-9" onClick={() => void load()} disabled={loading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Atualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
          ) : filteredRows.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Nenhum produto encontrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Variação</TableHead>
                    <TableHead className="text-right">Valor de venda</TableHead>
                    <TableHead className="text-right">Valor para assinante</TableHead>
                    <TableHead>Visibilidade</TableHead>
                    <TableHead>Disponibilidade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row) => {
                    const salePrice = Number(row.variant.price.amount);
                    const compareAt = Number(row.variant.compareAtPrice?.amount || 0);
                    const currency = row.variant.price.currencyCode || "BRL";
                    return (
                      <TableRow key={row.variant.id}>
                        <TableCell className="min-w-[280px]">
                          <div className="flex items-center gap-3">
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                              {row.image ? (
                                <img src={row.image.url} alt="" className="h-full w-full object-contain" />
                              ) : (
                                <Package className="h-4 w-4 text-muted-foreground" />
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="block font-semibold text-foreground">{row.productTitle}</span>
                              {row.vendor && <span className="block text-xs text-muted-foreground">{row.vendor}</span>}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="min-w-36">{row.variant.title === "Default Title" ? "Produto único" : row.variant.title}</TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {compareAt > salePrice && (
                            <span className="mr-2 text-xs text-muted-foreground line-through">{money(compareAt, currency)}</span>
                          )}
                          <span className="font-semibold">{money(salePrice, currency)}</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          {row.subscriberPrice === null ? (
                            <span className="text-xs font-medium text-amber-700">Não configurado</span>
                          ) : (
                            <span className="font-semibold text-blue-700">{money(row.subscriberPrice, currency)}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={visibilityClass(row.audience)}>
                            {visibilityLabel(row.audience)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={row.variant.availableForSale
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-red-200 bg-red-50 text-red-700"}
                          >
                            {row.variant.availableForSale ? "Disponível" : "Esgotado"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {!loading && filteredRows.length > 0 && (
            <div className="border-t px-4 py-3 text-xs text-muted-foreground">
              Exibindo {filteredRows.length} de {rows.length} variações.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "blue",
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone?: "blue" | "slate" | "amber";
}) {
  const tones = {
    blue: "bg-blue-50 text-blue-700",
    slate: "bg-slate-100 text-slate-700",
    amber: "bg-amber-50 text-amber-800",
  };
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </span>
        <span>
          <span className="block text-2xl font-extrabold text-[#0a1931]">{value}</span>
          <span className="block text-xs text-muted-foreground">{label}</span>
        </span>
      </CardContent>
    </Card>
  );
}
