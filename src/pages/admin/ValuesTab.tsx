import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Download, History, Loader2, Package, Search, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { fetchAllCustomerPrices } from "@/hooks/useCustomerPrices";
import { formatPercentage, percentageOverCost, priceRisk } from "@/lib/pricePercentages";
import { fetchAllShopifyProducts, type ShopifyProduct } from "@/lib/shopify";
import { isMissingValue, isSaleAtOrBelowCost, isSubscriberPriceNotVisible, matchesMissingValueFilter, type MissingValueFilter } from "@/lib/valueCompleteness";

type SubscriberPrice = {
  shopify_variant_id: string;
  subscriber_price: number;
};

type FranchisePrice = {
  shopify_product_id: string;
  shopify_variant_id: string;
  price: number;
};

// Formas cruas do PostgREST: `numeric` chega como string, a conversao e nossa.
type SubscriberPriceRow = Omit<SubscriberPrice, "subscriber_price"> & { subscriber_price: number | string };
type FranchisePriceRow = Omit<FranchisePrice, "price"> & { price: number | string };

type ProductCost = {
  shopify_variant_id: string;
  cost: number;
  previous_cost: number | null;
  cost_changed_at: string | null;
  synced_at: string;
};

type ProductCostRow = Omit<ProductCost, "cost" | "previous_cost"> & {
  cost: number | string;
  previous_cost: number | string | null;
};

type CostHistoryRow = {
  id: string;
  old_cost: number | null;
  new_cost: number;
  changed_at: string;
  source: string;
};

type PriceDetails = {
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  shopifyPrice: number | null;
  subscriberPrice: number | null;
  franchisePrice: number | null;
  cost: ProductCost | null;
};

type Draft = { franchise?: string; customer?: string };

type OlistSyncItem = {
  productId: string;
  variantId: string;
  sku: string;
  isFeed: boolean;
};

type OlistSyncResponse = {
  ok?: boolean;
  error?: string;
  updated?: number;
  notFound?: number;
  failed?: number;
  results?: Array<{ sku?: string; status?: string }>;
};

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const parsePrice = (value: string) => Number(value.replace(",", "."));
const decimal = (value: number) => value.toFixed(2).replace(".", ",");
const VALUES_PER_PAGE = 25;

const effectivePrice = (draft: string | undefined, current: number | undefined): number | null => {
  if (draft === undefined) return current ?? null;
  if (!draft.trim()) return null;
  const parsed = parsePrice(draft);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

function PriceMetrics({
  value,
  cost,
  normalSale = false,
}: {
  value: number | null;
  cost: number | null;
  normalSale?: boolean;
}) {
  if (value === null) return <p className="mt-1 text-[11px] text-muted-foreground">Sem valor cadastrado</p>;
  const overCost = percentageOverCost(value, cost);
  if (overCost === null) return <p className="mt-1 text-[11px] text-muted-foreground">Custo ainda não importado</p>;
  const risk = priceRisk(value, cost);
  const tone = risk === "danger" ? "text-red-700" : risk === "warning" ? "text-amber-700" : "text-emerald-700";
  const warning = overCost < 0 ? " · abaixo do custo" : overCost <= 10 ? " · muito próximo do custo" : "";
  if (normalSale && isSaleAtOrBelowCost(value, cost)) {
    return <p className="mt-1 text-[11px] font-semibold text-red-700">{formatPercentage(overCost)} sobre o custo · bloqueado para clientes</p>;
  }
  return (
    <p className={`mt-1 text-[11px] font-medium ${tone}`}>
      {overCost >= 0 ? "+" : ""}{formatPercentage(overCost)} sobre o custo
      {warning}
    </p>
  );
}

const normalizedText = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("pt-BR");

// A classificacao usa os metadados da Shopify e, por ultimo, o titulo. Assim a
// operacao em massa funciona agora, mas pode ser tornada exata cadastrando a tag
// ou o tipo de produto "racao" na Shopify.
const isFeedProduct = (product: ShopifyProduct) => {
  const searchable = [product.node.productType || "", ...(product.node.tags || []), product.node.title]
    .map(normalizedText)
    .join(" ");
  return /\bracao\b|\bracoes\b/.test(searchable);
};

export default function ValuesTab() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [subscriberPrices, setSubscriberPrices] = useState<SubscriberPrice[]>([]);
  const [franchisePrices, setFranchisePrices] = useState<FranchisePrice[]>([]);
  const [customerPrices, setCustomerPrices] = useState<{ shopify_variant_id: string; price: number }[]>([]);
  const [productCosts, setProductCosts] = useState<ProductCost[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [valueFilter, setValueFilter] = useState<MissingValueFilter>("all");
  const [marginSource, setMarginSource] = useState<"all" | "shopify" | "subscriber" | "franchise">("all");
  const [minMargin, setMinMargin] = useState("");
  const [maxMargin, setMaxMargin] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncingOlistId, setSyncingOlistId] = useState<string | null>(null);
  const [bulkSyncingOlist, setBulkSyncingOlist] = useState(false);
  const [details, setDetails] = useState<PriceDetails | null>(null);
  const [costHistory, setCostHistory] = useState<CostHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Leitura paginada nas tres tabelas. Sem isso o PostgREST corta em 1000
      // linhas e esta tela mostra o campo VAZIO para variantes que tem valor
      // cadastrado -- e quem salvasse por cima apagaria o valor achando que
      // estava preenchendo pela primeira vez.
      const [shopify, subscriber, franchise, costs, customer] = await Promise.all([
        fetchAllShopifyProducts(),
        fetchAllRows<SubscriberPriceRow>(
          "subscriber_prices",
          "shopify_variant_id,subscriber_price",
          { orderBy: "shopify_variant_id" },
        ),
        fetchAllRows<FranchisePriceRow>(
          "franchise_prices",
          "shopify_product_id,shopify_variant_id,price",
          { orderBy: "shopify_variant_id" },
        ),
        fetchAllRows<ProductCostRow>(
          "product_costs",
          "shopify_variant_id,cost,previous_cost,cost_changed_at,synced_at",
          { orderBy: "shopify_variant_id" },
        ),
        fetchAllCustomerPrices(),
      ]);
      setProducts(shopify);
      setSubscriberPrices(subscriber.map((row) => ({ ...row, subscriber_price: Number(row.subscriber_price) })));
      setFranchisePrices(franchise.map((row) => ({ ...row, price: Number(row.price) })));
      setCustomerPrices(customer);
      setProductCosts(costs.map((row) => ({
        ...row,
        cost: Number(row.cost),
        previous_cost: row.previous_cost === null ? null : Number(row.previous_cost),
      })));
    } catch (error) {
      console.error(error);
      if (!silent) toast.error("Não foi possível carregar os valores.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("admin-values")
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriber_prices" }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "franchise_prices" }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "product_costs" }, () => load(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const subscriberMap = useMemo(() => new Map(subscriberPrices.map((row) => [row.shopify_variant_id, row.subscriber_price])), [subscriberPrices]);
  const franchiseMap = useMemo(() => new Map(franchisePrices.map((row) => [row.shopify_variant_id, row])), [franchisePrices]);
  const costMap = useMemo(() => new Map(productCosts.map((row) => [row.shopify_variant_id, row])), [productCosts]);

  const openDetails = async (value: PriceDetails & { variantId: string }) => {
    const { variantId, ...dialogDetails } = value;
    setDetails(dialogDetails);
    setCostHistory([]);
    setHistoryLoading(true);
    const { data, error } = await supabase
      .from("product_cost_history")
      .select("id,old_cost,new_cost,changed_at,source")
      .eq("shopify_variant_id", variantId)
      .order("changed_at", { ascending: false })
      .limit(20);
    setHistoryLoading(false);
    if (error) {
      toast.error("Não foi possível carregar o histórico de custo.");
      return;
    }
    setCostHistory((data || []).map((entry) => ({
      ...entry,
      old_cost: entry.old_cost === null ? null : Number(entry.old_cost),
      new_cost: Number(entry.new_cost),
    })));
  };

  const rows = useMemo(() => products.flatMap((product) =>
    product.node.variants.edges.map(({ node: variant }) => ({
      productId: product.node.id,
      productTitle: product.node.title,
      image: product.node.images.edges[0]?.node,
      isFeed: isFeedProduct(product),
      variant,
    }))), [products]);

  const feedRowsWithSku = useMemo(
    () => rows.filter((row) => row.isFeed && row.variant.sku?.trim()),
    [rows],
  );

  const syncFromOlist = async (items: OlistSyncItem[], bulk = false) => {
    if (items.length === 0) {
      toast.error("Nenhuma ração com SKU foi encontrada na Shopify.");
      return;
    }
    if (bulk) setBulkSyncingOlist(true);
    else setSyncingOlistId(items[0].variantId);

    let updated = 0;
    let notFound = 0;
    let failed = 0;
    let fatalError = "";
    const issueSkus: string[] = [];
    try {
      // A function aceita lotes pequenos para nao estourar o limite da API da Olist.
      for (let index = 0; index < items.length; index += 25) {
        const { data, error } = await supabase.functions.invoke("admin-olist-cost-sync", {
          body: { items: items.slice(index, index + 25) },
        });
        const response = data as OlistSyncResponse | null;
        if (error || !response?.ok) {
          fatalError = response?.error || error?.message || "A sincronização foi recusada.";
          break;
        }
        updated += response.updated || 0;
        notFound += response.notFound || 0;
        failed += response.failed || 0;
        issueSkus.push(...(response.results || [])
          .filter((result) => result.status !== "updated" && result.sku)
          .map((result) => result.sku!));
      }
      if (fatalError) {
        toast.error("Não foi possível consultar a Olist.", { description: fatalError });
      } else if (notFound || failed) {
        toast.warning(`${updated} atualizado${updated === 1 ? "" : "s"}; ${notFound} SKU${notFound === 1 ? "" : "s"} não encontrado${notFound === 1 ? "" : "s"}; ${failed} erro${failed === 1 ? "" : "s"}.`, {
          description: issueSkus.length ? `Confira: ${issueSkus.join(", ")}` : undefined,
          duration: 12000,
        });
      } else {
        toast.success(`${updated} produto${updated === 1 ? "" : "s"} atualizado${updated === 1 ? "" : "s"} pela Olist.`);
      }
      if (updated > 0) await load(true);
    } finally {
      setBulkSyncingOlist(false);
      setSyncingOlistId(null);
    }
  };

  const syncAllFeedCosts = () => syncFromOlist(feedRowsWithSku.map((row) => ({
    productId: row.productId,
    variantId: row.variant.id,
    sku: row.variant.sku!.trim(),
    isFeed: true,
  })), true);

  const franchiseBelowCost = useMemo(() => rows.filter((row) => {
    const cost = costMap.get(row.variant.id)?.cost;
    const franchise = franchiseMap.get(row.variant.id)?.price;
    return cost !== undefined && franchise !== undefined && franchise < cost;
  }), [rows, costMap, franchiseMap]);

  const missingCounts = useMemo(() => rows.reduce((counts, row) => {
    const values = {
      cost: costMap.get(row.variant.id)?.cost,
      shopify: Number(row.variant.price.amount),
      subscriber: subscriberMap.get(row.variant.id),
      franchise: franchiseMap.get(row.variant.id)?.price,
    };
    if (isMissingValue(values.cost)) counts.cost += 1;
    if (isMissingValue(values.shopify)) counts.shopify += 1;
    if (isMissingValue(values.subscriber)) counts.subscriber += 1;
    if (isMissingValue(values.franchise)) counts.franchise += 1;
    if (isSubscriberPriceNotVisible(values.subscriber, values.shopify)) counts.subscriberNotVisible += 1;
    if (isSaleAtOrBelowCost(values.shopify, values.cost)) counts.saleAtCost += 1;
    if (Object.values(values).some(isMissingValue)) counts.any += 1;
    return counts;
  }, { any: 0, cost: 0, shopify: 0, subscriber: 0, franchise: 0, subscriberNotVisible: 0, saleAtCost: 0 }), [rows, costMap, franchiseMap, subscriberMap]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    return rows.filter((row) => {
      const matchesQuery = !normalized || `${row.productTitle} ${row.variant.title} ${row.variant.sku || ""}`
        .toLocaleLowerCase("pt-BR")
        .includes(normalized);
      if (!matchesQuery) return false;
      const values = {
        cost: costMap.get(row.variant.id)?.cost,
        shopify: Number(row.variant.price.amount),
        subscriber: subscriberMap.get(row.variant.id),
        franchise: franchiseMap.get(row.variant.id)?.price,
      };
      if (!matchesMissingValueFilter(values, valueFilter)) return false;
      if (marginSource === "all") return true;
      const margin = percentageOverCost(values[marginSource], values.cost);
      if (margin === null) return false;
      const minimum = minMargin.trim() === "" ? null : Number(minMargin.replace(",", "."));
      const maximum = maxMargin.trim() === "" ? null : Number(maxMargin.replace(",", "."));
      return (minimum === null || !Number.isFinite(minimum) || margin >= minimum)
        && (maximum === null || !Number.isFinite(maximum) || margin <= maximum);
    });
  }, [query, rows, valueFilter, marginSource, minMargin, maxMargin, costMap, franchiseMap, subscriberMap]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / VALUES_PER_PAGE));
  const paginatedRows = useMemo(
    () => filteredRows.slice((currentPage - 1) * VALUES_PER_PAGE, currentPage * VALUES_PER_PAGE),
    [currentPage, filteredRows],
  );

  useEffect(() => { setCurrentPage(1); }, [query, valueFilter, marginSource, minMargin, maxMargin]);
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const setDraft = (variantId: string, field: keyof Draft, value: string) => {
    setDrafts((current) => ({ ...current, [variantId]: { ...current[variantId], [field]: value } }));
  };

  const saveRow = async (row: (typeof rows)[number]) => {
    const draft = drafts[row.variant.id] || {};
    const franchiseExisting = franchiseMap.get(row.variant.id);
    const operations: PromiseLike<{ error: { message: string } | null }>[] = [];

    if (draft.franchise !== undefined) {
      const raw = draft.franchise.trim();
      if (!raw) {
        if (franchiseExisting) operations.push(supabase.from("franchise_prices").delete().eq("shopify_variant_id", row.variant.id));
      } else {
        const price = parsePrice(raw);
        if (!Number.isFinite(price) || price <= 0) return toast.error("Informe um Valor da Franquia válido.");
        const cost = costMap.get(row.variant.id)?.cost;
        if (cost !== undefined && price < cost) {
          return toast.error("O valor da franquia não pode ficar abaixo do custo.", {
            description: `Custo atual: ${money(cost)}. Informe ${money(cost)} ou mais.`,
          });
        }
        operations.push(supabase.from("franchise_prices").upsert({
          shopify_product_id: row.productId,
          shopify_variant_id: row.variant.id,
          price,
        }, { onConflict: "shopify_variant_id" }));
      }
    }

    setSavingId(row.variant.id);
    const results = await Promise.all(operations);
    setSavingId(null);
    const error = results.find((result) => result.error)?.error;
    if (error) return toast.error(`Erro ao salvar: ${error.message}`);
    setDrafts((current) => {
      const next = { ...current };
      delete next[row.variant.id];
      return next;
    });
    toast.success("Valor da franquia atualizado.");
    await load(true);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs font-medium text-muted-foreground">Variantes</p><p className="mt-1 text-2xl font-bold">{rows.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs font-medium text-muted-foreground">Custos importados</p><p className="mt-1 text-2xl font-bold">{productCosts.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs font-medium text-muted-foreground">Preços de assinante</p><p className="mt-1 text-2xl font-bold">{subscriberPrices.length}</p></CardContent></Card>
        <Card className={franchiseBelowCost.length > 0 ? "border-red-500/50" : undefined}><CardContent className="p-4"><p className="text-xs font-medium text-muted-foreground">Franquias abaixo do custo</p><p className={`mt-1 text-2xl font-bold ${franchiseBelowCost.length > 0 ? "text-red-700" : "text-emerald-700"}`}>{franchiseBelowCost.length}</p></CardContent></Card>
      </div>

      {franchiseBelowCost.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
          <div>
            <p className="font-medium text-red-700">
              {franchiseBelowCost.length === 1 ? "1 franquia está" : `${franchiseBelowCost.length} franquias estão`} com valor abaixo do custo.
            </p>
            <p className="mt-1 text-muted-foreground">
              Sincronize novamente com a Olist ou ajuste o valor. O checkout nunca deve cobrar abaixo do custo.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-4 py-3 text-sm text-sky-950">
        <p className="font-medium">Como os percentuais são calculados</p>
        <p className="mt-0.5 text-xs text-sky-800">
          Shopify é a venda normal. Assinante e franquia são preços especiais. Todos mostram o percentual sobre o custo Olist; até 10% fica vermelho, de 10% a 15% amarelo e acima de 15% verde. Venda normal igual ou abaixo do custo é bloqueada para clientes.
        </p>
      </div>

      <Card>
        <CardHeader className="gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Valores por produto</CardTitle>
            <CardDescription>
              {filteredRows.length} de {rows.length} variantes · compare Shopify, assinante, franquia e custo real.
            </CardDescription>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button variant="outline" onClick={syncAllFeedCosts} disabled={bulkSyncingOlist || loading}>
              {bulkSyncingOlist ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Atualizar rações pela Olist ({feedRowsWithSku.length})
            </Button>
            <Select value={valueFilter} onValueChange={(value) => setValueFilter(value as MissingValueFilter)}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Filtrar pendências de valores">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos ({rows.length})</SelectItem>
                <SelectItem value="missing_any">Com alguma pendência ({missingCounts.any})</SelectItem>
                <SelectItem value="missing_cost">Sem custo Olist ({missingCounts.cost})</SelectItem>
                <SelectItem value="missing_shopify">Sem preço Shopify ({missingCounts.shopify})</SelectItem>
                <SelectItem value="missing_subscriber">Sem preço assinante ({missingCounts.subscriber})</SelectItem>
                <SelectItem value="subscriber_not_visible">Assinante não exibido ({missingCounts.subscriberNotVisible})</SelectItem>
                <SelectItem value="sale_at_cost">Venda igual/abaixo do custo ({missingCounts.saleAtCost})</SelectItem>
                <SelectItem value="missing_franchise">Sem preço franquia ({missingCounts.franchise})</SelectItem>
              </SelectContent>
            </Select>
            <Select value={marginSource} onValueChange={(value) => setMarginSource(value as typeof marginSource)}>
              <SelectTrigger className="w-full sm:w-48" aria-label="Filtrar percentual sobre o custo"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as margens</SelectItem>
                <SelectItem value="shopify">% venda normal</SelectItem>
                <SelectItem value="subscriber">% assinante</SelectItem>
                <SelectItem value="franchise">% franquia</SelectItem>
              </SelectContent>
            </Select>
            {marginSource !== "all" && <div className="flex gap-2">
              <Input value={minMargin} onChange={(event) => setMinMargin(event.target.value)} type="number" step="0.1" placeholder="Mín. %" aria-label="Percentual mínimo sobre o custo" className="w-24" />
              <Input value={maxMargin} onChange={(event) => setMaxMargin(event.target.value)} type="number" step="0.1" placeholder="Máx. %" aria-label="Percentual máximo sobre o custo" className="w-24" />
            </div>}
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar produto, variante ou SKU" className="pl-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : filteredRows.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Nenhum produto encontrado.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background"><TableRow>
                  <TableHead className="min-w-[260px]">Produto</TableHead>
                  <TableHead className="min-w-[190px]">Custo Olist</TableHead>
                  <TableHead className="min-w-[190px]">Venda normal (Shopify)</TableHead>
                  <TableHead className="min-w-[220px]">Assinante</TableHead>
                  <TableHead className="min-w-[240px]">Franquia</TableHead>
                  <TableHead className="min-w-[164px]">Ações</TableHead>
                </TableRow></TableHeader>
                <TableBody>{paginatedRows.map((row) => {
                  const subscriber = subscriberMap.get(row.variant.id);
                  const franchise = franchiseMap.get(row.variant.id);
                  const productCost = costMap.get(row.variant.id) ?? null;
                  const costValue = productCost?.cost ?? null;
                  const shopifyPrice = Number(row.variant.price.amount);
                  const displayedCost = isMissingValue(costValue) ? null : costValue;
                  const displayedShopifyPrice = isMissingValue(shopifyPrice) ? null : shopifyPrice;
                  const draft = drafts[row.variant.id];
                  const franchiseValue = effectivePrice(draft?.franchise, franchise?.price);
                  return (
                    <TableRow key={row.variant.id}>
                      <TableCell><div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                          {row.image ? <img src={row.image.url} alt="" className="h-full w-full object-cover" /> : <Package className="h-5 w-5 text-muted-foreground" />}
                        </div>
                        <div>
                          <p className="font-medium">{row.productTitle}</p>
                          <p className="text-xs text-muted-foreground">
                            {row.variant.title}{row.variant.sku ? ` · SKU ${row.variant.sku}` : " · sem SKU"}{row.isFeed ? " · ração" : ""}
                          </p>
                        </div>
                      </div></TableCell>
                      <TableCell>
                        <Input readOnly value={displayedCost === null ? "Não importado" : money(displayedCost)} className="h-10 bg-sky-50 font-semibold tabular-nums" />
                        {productCost?.previous_cost !== null && productCost?.previous_cost !== undefined ? (
                          <p className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${productCost.cost > productCost.previous_cost ? "text-red-700" : "text-emerald-700"}`}>
                            {productCost.cost > productCost.previous_cost ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {productCost.cost > productCost.previous_cost ? "Subiu" : "Baixou"} {formatPercentage(Math.abs((productCost.cost / productCost.previous_cost - 1) * 100))}
                          </p>
                        ) : <p className="mt-1 text-[11px] text-muted-foreground">Sem alteração registrada</p>}
                      </TableCell>
                      <TableCell>
                        <Input readOnly value={displayedShopifyPrice === null ? "Não cadastrado" : money(displayedShopifyPrice)} className="h-10 bg-muted/50 tabular-nums" />
                        <PriceMetrics value={displayedShopifyPrice} cost={displayedCost} normalSale />
                      </TableCell>
                      <TableCell>
                        {subscriber === undefined ? <span className="inline-flex h-10 items-center text-sm text-muted-foreground">Não cadastrado</span> : <Input readOnly value={money(subscriber)} className="h-10 bg-muted/50 font-medium tabular-nums" />}
                        <PriceMetrics value={subscriber ?? null} cost={displayedCost} />
                      </TableCell>
                      <TableCell>
                        <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">R$</span><Input type="text" inputMode="decimal" className="h-10 pl-10 pr-9 font-medium tabular-nums" placeholder="Digite o valor" value={draft?.franchise ?? (franchise ? decimal(franchise.price) : "")} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraft(row.variant.id, "franchise", event.target.value)} aria-label={`Valor da Franquia de ${row.productTitle}`} /></div>
                        <PriceMetrics value={franchiseValue} cost={displayedCost} />
                      </TableCell>
                      <TableCell><div className="flex gap-2">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Ver detalhes e histórico"
                          aria-label={`Ver detalhes e histórico de ${row.productTitle}`}
                          onClick={() => openDetails({
                            variantId: row.variant.id,
                            productTitle: row.productTitle,
                            variantTitle: row.variant.title,
                            sku: row.variant.sku ?? null,
                            shopifyPrice: displayedShopifyPrice,
                            subscriberPrice: subscriber ?? null,
                            franchisePrice: franchiseValue,
                            cost: productCost,
                          })}
                        >
                          <History className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="outline"
                          disabled={!row.variant.sku?.trim() || syncingOlistId === row.variant.id || bulkSyncingOlist}
                          title={row.variant.sku ? "Buscar custo deste SKU na Olist" : "Cadastre o SKU na Shopify primeiro"}
                          aria-label={`Buscar custo de ${row.productTitle} na Olist`}
                          onClick={() => syncFromOlist([{
                            productId: row.productId,
                            variantId: row.variant.id,
                            sku: row.variant.sku!.trim(),
                            isFeed: row.isFeed,
                          }])}
                        >
                          {syncingOlistId === row.variant.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        </Button>
                        <Button size="icon" onClick={() => saveRow(row)} disabled={!draft || savingId === row.variant.id} aria-label={`Salvar valores de ${row.productTitle}`}>{savingId === row.variant.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</Button>
                      </div></TableCell>
                    </TableRow>
                  );
                })}</TableBody>
              </Table>
              </div>
              {totalPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Página {currentPage} de {totalPages} · {filteredRows.length} variantes
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />Anterior
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Próxima<ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={details !== null} onOpenChange={(open) => { if (!open) setDetails(null); }}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes dos valores</DialogTitle>
            <DialogDescription>
              {details?.productTitle}{details?.variantTitle && details.variantTitle !== "Default Title" ? ` · ${details.variantTitle}` : ""}{details?.sku ? ` · SKU ${details.sku}` : ""}
            </DialogDescription>
          </DialogHeader>

          {details && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { label: "Custo Olist", value: details.cost?.cost ?? null },
                  { label: "Venda normal (Shopify)", value: details.shopifyPrice },
                  { label: "Assinante", value: details.subscriberPrice },
                  { label: "Franquia", value: details.franchisePrice },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className="mt-1 text-lg font-bold tabular-nums">{item.value === null ? "Não cadastrado" : money(item.value)}</p>
                    {item.label !== "Custo Olist" && <PriceMetrics value={item.value} cost={details.cost?.cost ?? null} normalSale={item.label === "Venda normal (Shopify)"} />}
                  </div>
                ))}
              </div>

              {details.cost?.previous_cost !== null && details.cost?.previous_cost !== undefined && (
                <div className={`rounded-lg border p-4 ${details.cost.cost > details.cost.previous_cost ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
                  <div className="flex items-center gap-2 font-medium">
                    {details.cost.cost > details.cost.previous_cost ? <TrendingUp className="h-4 w-4 text-red-700" /> : <TrendingDown className="h-4 w-4 text-emerald-700" />}
                    Custo {details.cost.cost > details.cost.previous_cost ? "aumentou" : "diminuiu"}
                  </div>
                  <p className="mt-1 text-sm">
                    De {money(details.cost.previous_cost)} para {money(details.cost.cost)} ({details.cost.cost > details.cost.previous_cost ? "+" : ""}{formatPercentage((details.cost.cost / details.cost.previous_cost - 1) * 100)}).
                  </p>
                  {details.cost.cost_changed_at && <p className="mt-1 text-xs text-muted-foreground">Detectado em {new Date(details.cost.cost_changed_at).toLocaleString("pt-BR")}.</p>}
                </div>
              )}

              <div>
                <h3 className="text-sm font-semibold">Histórico do custo</h3>
                {historyLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
                ) : costHistory.length === 0 ? (
                  <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhuma alteração de custo registrada ainda. O histórico começa na próxima sincronização com a Olist.</p>
                ) : (
                  <div className="mt-2 overflow-hidden rounded-lg border">
                    <Table>
                      <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Anterior</TableHead><TableHead>Novo custo</TableHead><TableHead>Variação</TableHead></TableRow></TableHeader>
                      <TableBody>{costHistory.map((entry) => {
                        const change = entry.old_cost && entry.old_cost > 0 ? (entry.new_cost / entry.old_cost - 1) * 100 : null;
                        return (
                          <TableRow key={entry.id}>
                            <TableCell className="whitespace-nowrap text-xs">{new Date(entry.changed_at).toLocaleString("pt-BR")}</TableCell>
                            <TableCell>{entry.old_cost === null ? "Primeiro registro" : money(entry.old_cost)}</TableCell>
                            <TableCell className="font-medium">{money(entry.new_cost)}</TableCell>
                            <TableCell className={change !== null && change > 0 ? "font-medium text-red-700" : "font-medium text-emerald-700"}>
                              {change === null ? "—" : `${change > 0 ? "+" : ""}${formatPercentage(change)}`}
                            </TableCell>
                          </TableRow>
                        );
                      })}</TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
