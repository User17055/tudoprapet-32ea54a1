import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Download, Loader2, Package, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { exceedsShopifyPrice, resolveSyncPrice } from "@/lib/priceCap";
import { fetchAllShopifyProducts, invalidateShopifyCatalogCache, type ShopifyProduct } from "@/lib/shopify";

type CustomerPrice = {
  shopify_product_id: string;
  shopify_variant_id: string;
  price: number;
  previous_price: number | null;
  price_changed_at: string | null;
};

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
type CustomerPriceRow = Omit<CustomerPrice, "price" | "previous_price"> & { price: number | string; previous_price: number | string | null };
type SubscriberPriceRow = Omit<SubscriberPrice, "subscriber_price"> & { subscriber_price: number | string };
type FranchisePriceRow = Omit<FranchisePrice, "price"> & { price: number | string };

type Draft = { customer?: string; franchise?: string };

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
  const [customerPrices, setCustomerPrices] = useState<CustomerPrice[]>([]);
  const [subscriberPrices, setSubscriberPrices] = useState<SubscriberPrice[]>([]);
  const [franchisePrices, setFranchisePrices] = useState<FranchisePrice[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncingOlistId, setSyncingOlistId] = useState<string | null>(null);
  const [bulkSyncingOlist, setBulkSyncingOlist] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Leitura paginada nas tres tabelas. Sem isso o PostgREST corta em 1000
      // linhas e esta tela mostra o campo VAZIO para variantes que tem valor
      // cadastrado -- e quem salvasse por cima apagaria o valor achando que
      // estava preenchendo pela primeira vez.
      const [shopify, customer, subscriber, franchise] = await Promise.all([
        fetchAllShopifyProducts(),
        fetchAllRows<CustomerPriceRow>(
          "customer_prices",
          "shopify_product_id,shopify_variant_id,price,previous_price,price_changed_at",
          { orderBy: "shopify_variant_id" },
        ),
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
      ]);
      setProducts(shopify);
      setCustomerPrices(customer.map((row) => ({ ...row, price: Number(row.price), previous_price: row.previous_price === null ? null : Number(row.previous_price) })));
      setSubscriberPrices(subscriber.map((row) => ({ ...row, subscriber_price: Number(row.subscriber_price) })));
      setFranchisePrices(franchise.map((row) => ({ ...row, price: Number(row.price) })));
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
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_prices" }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriber_prices" }, () => load(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "franchise_prices" }, () => load(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const customerMap = useMemo(() => new Map(customerPrices.map((row) => [row.shopify_variant_id, row])), [customerPrices]);
  const subscriberMap = useMemo(() => new Map(subscriberPrices.map((row) => [row.shopify_variant_id, row.subscriber_price])), [subscriberPrices]);
  const franchiseMap = useMemo(() => new Map(franchisePrices.map((row) => [row.shopify_variant_id, row])), [franchisePrices]);

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

  // Variantes cujo preço-base ainda precisa ser sincronizado com a Shopify.
  // Depois da sincronização, o pedido mantém a variante e não precisa exibir
  // uma linha adicional de ajuste para o cliente.
  const acimaDaShopify = useMemo(() => rows.filter((row) => {
    const shopifyPrice = Number(row.variant.price.amount);
    const customer = customerMap.get(row.variant.id);
    const franchise = franchiseMap.get(row.variant.id);
    return (customer !== undefined && exceedsShopifyPrice(customer.price, shopifyPrice))
      || (franchise !== undefined && exceedsShopifyPrice(franchise.price, shopifyPrice));
  }), [rows, customerMap, franchiseMap]);

  const filteredRows = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return rows;
    return rows.filter((row) => `${row.productTitle} ${row.variant.title} ${row.variant.sku || ""}`.toLocaleLowerCase("pt-BR").includes(normalized));
  }, [query, rows]);

  const setDraft = (variantId: string, field: keyof Draft, value: string) => {
    setDrafts((current) => ({ ...current, [variantId]: { ...current[variantId], [field]: value } }));
  };

  const saveRow = async (row: (typeof rows)[number]) => {
    const draft = drafts[row.variant.id] || {};
    const customerExisting = customerMap.get(row.variant.id);
    const franchiseExisting = franchiseMap.get(row.variant.id);
    const shopifyPrice = Number(row.variant.price.amount);
    const operations: PromiseLike<{ error: { message: string } | null }>[] = [];
    // Valor que cada tabela vai ter DEPOIS de salvar -- é só isso que pode
    // entrar na sincronização, porque o destino da escrita é o preço público da
    // Shopify. Partir do valor atual e nunca descartá-lo fazia com que baixar
    // um valor de 570 para 200 ainda empurrasse 570 para o catálogo, e apagar o
    // valor empurrasse o valor apagado. Campo não editado mantém o que existe;
    // campo esvaziado vira undefined, porque a linha será removida.
    let customerAfter = customerExisting?.price;
    let franchiseAfter = franchiseExisting?.price;

    if (draft.customer !== undefined) {
      const raw = draft.customer.trim();
      if (!raw) {
        customerAfter = undefined;
        if (customerExisting) operations.push(supabase.from("customer_prices").delete().eq("shopify_variant_id", row.variant.id));
      } else {
        const price = parsePrice(raw);
        if (!Number.isFinite(price) || price <= 0) return toast.error("Informe um Valor do Cliente válido.");
        customerAfter = price;
        operations.push(supabase.from("customer_prices").upsert({
          shopify_product_id: row.productId,
          shopify_variant_id: row.variant.id,
          price,
        }, { onConflict: "shopify_variant_id" }));
      }
    }

    if (draft.franchise !== undefined) {
      const raw = draft.franchise.trim();
      if (!raw) {
        franchiseAfter = undefined;
        if (franchiseExisting) operations.push(supabase.from("franchise_prices").delete().eq("shopify_variant_id", row.variant.id));
      } else {
        const price = parsePrice(raw);
        if (!Number.isFinite(price) || price <= 0) return toast.error("Informe um Valor da Franquia válido.");
        franchiseAfter = price;
        operations.push(supabase.from("franchise_prices").upsert({
          shopify_product_id: row.productId,
          shopify_variant_id: row.variant.id,
          price,
        }, { onConflict: "shopify_variant_id" }));
      }
    }

    const synchronizedShopifyPrice = resolveSyncPrice(shopifyPrice, customerAfter, franchiseAfter);

    setSavingId(row.variant.id);
    if (exceedsShopifyPrice(synchronizedShopifyPrice, shopifyPrice)) {
      const { data, error } = await supabase.functions.invoke("admin-variant-price", {
        body: {
          productId: row.productId,
          variantId: row.variant.id,
          price: synchronizedShopifyPrice,
        },
      });
      const response = data as { ok?: boolean; error?: string } | null;
      if (error || !response?.ok) {
        setSavingId(null);
        return toast.error("Não foi possível sincronizar o preço com a Shopify.", {
          description: response?.error || error?.message,
        });
      }
      invalidateShopifyCatalogCache();
    }
    const results = await Promise.all(operations);
    setSavingId(null);
    const error = results.find((result) => result.error)?.error;
    if (error) return toast.error(`Erro ao salvar: ${error.message}`);
    setDrafts((current) => {
      const next = { ...current };
      delete next[row.variant.id];
      return next;
    });
    toast.success(
      synchronizedShopifyPrice > shopifyPrice
        ? "Valor salvo e preço da Shopify sincronizado."
        : "Valores atualizados.",
    );
    await load(true);
  };

  const recentlyChanged = (row: CustomerPrice | undefined) => Boolean(
    row?.price_changed_at && Date.now() - new Date(row.price_changed_at).getTime() <= 30 * 24 * 60 * 60 * 1000,
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="p-4"><p className="text-xs font-medium text-muted-foreground">Variantes</p><p className="mt-1 text-2xl font-bold">{rows.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs font-medium text-muted-foreground">Valores personalizados</p><p className="mt-1 text-2xl font-bold">{customerPrices.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs font-medium text-muted-foreground">Alterados nos últimos 30 dias</p><p className="mt-1 text-2xl font-bold text-amber-600">{customerPrices.filter(recentlyChanged).length}</p></CardContent></Card>
        <Card className={acimaDaShopify.length > 0 ? "border-amber-500/50" : undefined}><CardContent className="p-4"><p className="text-xs font-medium text-muted-foreground">Aguardando sincronização</p><p className={`mt-1 text-2xl font-bold ${acimaDaShopify.length > 0 ? "text-amber-600" : ""}`}>{acimaDaShopify.length}</p></CardContent></Card>
      </div>

      {acimaDaShopify.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium text-amber-700">
              {acimaDaShopify.length === 1 ? "1 variante precisa" : `${acimaDaShopify.length} variantes precisam`} sincronizar com a Shopify.
            </p>
            <p className="mt-1 text-muted-foreground">
              Clique no ✓ da linha marcada. O preço-base será atualizado antes de salvar, mantendo o produto e a baixa de estoque sem mostrar uma linha adicional no pedido do cliente.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Valores por produto</CardTitle>
            <CardDescription>Cadastre os valores específicos de cliente e franquia para cada variante.</CardDescription>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button variant="outline" onClick={syncAllFeedCosts} disabled={bulkSyncingOlist || loading}>
              {bulkSyncingOlist ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Atualizar rações pela Olist ({feedRowsWithSku.length})
            </Button>
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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="min-w-[260px]">Produto</TableHead>
                  <TableHead className="min-w-[150px]">Valor da Shopify</TableHead>
                  <TableHead className="min-w-[250px]">Valor do Cliente</TableHead>
                  <TableHead className="min-w-[160px]">Valor do Assinante</TableHead>
                  <TableHead className="min-w-[230px]">Valor da Franquia</TableHead>
                  <TableHead className="min-w-[120px]" />
                </TableRow></TableHeader>
                <TableBody>{filteredRows.map((row) => {
                  const customer = customerMap.get(row.variant.id);
                  const subscriber = subscriberMap.get(row.variant.id);
                  const franchise = franchiseMap.get(row.variant.id);
                  const shopifyPrice = Number(row.variant.price.amount);
                  const draft = drafts[row.variant.id];
                  const changed = recentlyChanged(customer);
                  const customerAcima = customer !== undefined && exceedsShopifyPrice(customer.price, shopifyPrice);
                  const franchiseAcima = franchise !== undefined && exceedsShopifyPrice(franchise.price, shopifyPrice);
                  const acimaTitle = `Acima do Valor da Shopify (${money(shopifyPrice)}). Clique em salvar para sincronizar o preço-base e evitar uma linha adicional no pedido.`;
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
                      <TableCell><Input readOnly value={money(shopifyPrice)} className="h-10 bg-muted/50 tabular-nums" /></TableCell>
                      <TableCell>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">R$</span>
                          <Input type="text" inputMode="decimal" className="h-10 pl-10 pr-9 font-medium tabular-nums" placeholder="Digite o valor" value={draft?.customer ?? (customer ? decimal(customer.price) : "")} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraft(row.variant.id, "customer", event.target.value)} aria-label={`Valor do Cliente de ${row.productTitle}`} />
                          {/* Um marcador por campo: o valor acima do da Shopify é o mais grave e tem precedência sobre o aviso de alteração recente. */}
                          {customerAcima
                            ? <span title={acimaTitle} className="absolute right-3 top-1/2 -translate-y-1/2"><AlertTriangle className="h-4 w-4 text-amber-600" /></span>
                            : changed && <span title={`Alterado recentemente. Preço anterior: ${customer?.previous_price ? money(customer.previous_price) : "não informado"}`} className="absolute right-3 top-1/2 -translate-y-1/2"><AlertTriangle className="h-4 w-4 text-amber-600" /></span>}
                        </div>
                      </TableCell>
                      <TableCell>{subscriber === undefined ? <span className="inline-flex h-10 items-center text-sm text-muted-foreground">Não cadastrado</span> : <Input readOnly value={money(subscriber)} className="h-10 bg-muted/50 font-medium tabular-nums" />}</TableCell>
                      <TableCell><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">R$</span><Input type="text" inputMode="decimal" className="h-10 pl-10 pr-9 font-medium tabular-nums" placeholder="Digite o valor" value={draft?.franchise ?? (franchise ? decimal(franchise.price) : "")} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraft(row.variant.id, "franchise", event.target.value)} aria-label={`Valor da Franquia de ${row.productTitle}`} />{franchiseAcima && <span title={acimaTitle} className="absolute right-3 top-1/2 -translate-y-1/2"><AlertTriangle className="h-4 w-4 text-amber-600" /></span>}</div></TableCell>
                      <TableCell><div className="flex gap-2">
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
                        <Button size="icon" onClick={() => saveRow(row)} disabled={(!draft && !customerAcima && !franchiseAcima) || savingId === row.variant.id} aria-label={`Salvar valores de ${row.productTitle}`}>{savingId === row.variant.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</Button>
                      </div></TableCell>
                    </TableRow>
                  );
                })}</TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
