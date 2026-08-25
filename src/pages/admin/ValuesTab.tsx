import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Package, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { exceedsShopifyPrice } from "@/lib/priceCap";
import { fetchAllShopifyProducts, type ShopifyProduct } from "@/lib/shopify";

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

type Draft = { customer?: string; franchise?: string };

const money = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const parsePrice = (value: string) => Number(value.replace(",", "."));
const decimal = (value: number) => value.toFixed(2).replace(".", ",");

export default function ValuesTab() {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [customerPrices, setCustomerPrices] = useState<CustomerPrice[]>([]);
  const [subscriberPrices, setSubscriberPrices] = useState<SubscriberPrice[]>([]);
  const [franchisePrices, setFranchisePrices] = useState<FranchisePrice[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [shopify, customer, subscriber, franchise] = await Promise.all([
        fetchAllShopifyProducts(),
        supabase.from("customer_prices").select("shopify_product_id,shopify_variant_id,price,previous_price,price_changed_at"),
        supabase.from("subscriber_prices").select("shopify_variant_id,subscriber_price"),
        supabase.from("franchise_prices").select("shopify_product_id,shopify_variant_id,price"),
      ]);
      if (customer.error) throw customer.error;
      if (subscriber.error) throw subscriber.error;
      if (franchise.error) throw franchise.error;
      setProducts(shopify);
      setCustomerPrices((customer.data || []).map((row) => ({ ...row, price: Number(row.price), previous_price: row.previous_price === null ? null : Number(row.previous_price) })));
      setSubscriberPrices((subscriber.data || []).map((row) => ({ ...row, subscriber_price: Number(row.subscriber_price) })));
      setFranchisePrices((franchise.data || []).map((row) => ({ ...row, price: Number(row.price) })));
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
      variant,
    }))), [products]);

  // Diagnóstico do dado que já está gravado. A validação do save só vale daqui
  // para a frente; quem foi salvo acima do preço da Shopify antes dela continua
  // no banco, cobrando errado em silêncio, e precisa aparecer para ser corrigido.
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
    return rows.filter((row) => `${row.productTitle} ${row.variant.title}`.toLocaleLowerCase("pt-BR").includes(normalized));
  }, [query, rows]);

  const setDraft = (variantId: string, field: keyof Draft, value: string) => {
    setDrafts((current) => ({ ...current, [variantId]: { ...current[variantId], [field]: value } }));
  };

  // Um valor acima do Valor da Shopify não tem como ser cobrado corretamente: o
  // pedido na Shopify só registra desconto, nunca acréscimo. No checkout próprio
  // isso cobra do cliente mais do que o pedido documenta; no fluxo de assinante
  // e franquia a Shopify cobra o preço dela e a loja recebe menos do que exibiu.
  // Barrar aqui é o que impede o dado errado de nascer — o teto no servidor
  // (capPricesToShopify) é só a rede de segurança para o que já está gravado.
  const acimaDaShopifyMessage = (campo: string, shopifyPrice: number) =>
    `O ${campo} não pode passar do Valor da Shopify (${money(shopifyPrice)}). O pedido na Shopify só registra desconto, então um valor maior seria cobrado sem aparecer no pedido.`;

  const saveRow = async (row: (typeof rows)[number]) => {
    const draft = drafts[row.variant.id];
    if (!draft) return;
    const customerExisting = customerMap.get(row.variant.id);
    const franchiseExisting = franchiseMap.get(row.variant.id);
    const shopifyPrice = Number(row.variant.price.amount);
    const operations: PromiseLike<{ error: { message: string } | null }>[] = [];

    if (draft.customer !== undefined) {
      const raw = draft.customer.trim();
      if (!raw) {
        if (customerExisting) operations.push(supabase.from("customer_prices").delete().eq("shopify_variant_id", row.variant.id));
      } else {
        const price = parsePrice(raw);
        if (!Number.isFinite(price) || price <= 0) return toast.error("Informe um Valor do Cliente válido.");
        if (exceedsShopifyPrice(price, shopifyPrice)) return toast.error(acimaDaShopifyMessage("Valor do Cliente", shopifyPrice));
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
        if (franchiseExisting) operations.push(supabase.from("franchise_prices").delete().eq("shopify_variant_id", row.variant.id));
      } else {
        const price = parsePrice(raw);
        if (!Number.isFinite(price) || price <= 0) return toast.error("Informe um Valor da Franquia válido.");
        if (exceedsShopifyPrice(price, shopifyPrice)) return toast.error(acimaDaShopifyMessage("Valor da Franquia", shopifyPrice));
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
    toast.success("Valores atualizados.");
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
        <Card className={acimaDaShopify.length > 0 ? "border-destructive" : undefined}><CardContent className="p-4"><p className="text-xs font-medium text-muted-foreground">Acima do Valor da Shopify</p><p className={`mt-1 text-2xl font-bold ${acimaDaShopify.length > 0 ? "text-destructive" : ""}`}>{acimaDaShopify.length}</p></CardContent></Card>
      </div>

      {acimaDaShopify.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">
              {acimaDaShopify.length === 1 ? "1 variante está" : `${acimaDaShopify.length} variantes estão`} com valor acima do Valor da Shopify.
            </p>
            <p className="mt-1 text-muted-foreground">
              O pedido na Shopify só registra desconto, nunca acréscimo, então esses valores não são cobrados como cadastrados: o sistema usa o Valor da Shopify para o pedido não divergir. Ajuste o valor cadastrado ou o preço na Shopify. As linhas afetadas estão marcadas na tabela.
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
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar produto ou variante" className="pl-9" />
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
                  <TableHead className="w-20" />
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
                  const acimaTitle = `Acima do Valor da Shopify (${money(shopifyPrice)}). O pedido na Shopify não registra acréscimo, então o sistema cobra o Valor da Shopify.`;
                  return (
                    <TableRow key={row.variant.id}>
                      <TableCell><div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                          {row.image ? <img src={row.image.url} alt="" className="h-full w-full object-cover" /> : <Package className="h-5 w-5 text-muted-foreground" />}
                        </div>
                        <div><p className="font-medium">{row.productTitle}</p><p className="text-xs text-muted-foreground">{row.variant.title}</p></div>
                      </div></TableCell>
                      <TableCell><Input readOnly value={money(shopifyPrice)} className="h-10 bg-muted/50 tabular-nums" /></TableCell>
                      <TableCell>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">R$</span>
                          <Input type="text" inputMode="decimal" className="h-10 pl-10 pr-9 font-medium tabular-nums" placeholder="Digite o valor" value={draft?.customer ?? (customer ? decimal(customer.price) : "")} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraft(row.variant.id, "customer", event.target.value)} aria-label={`Valor do Cliente de ${row.productTitle}`} />
                          {/* Um marcador por campo: o valor acima do da Shopify é o mais grave e tem precedência sobre o aviso de alteração recente. */}
                          {customerAcima
                            ? <span title={acimaTitle} className="absolute right-3 top-1/2 -translate-y-1/2"><AlertTriangle className="h-4 w-4 text-destructive" /></span>
                            : changed && <span title={`Alterado recentemente. Preço anterior: ${customer?.previous_price ? money(customer.previous_price) : "não informado"}`} className="absolute right-3 top-1/2 -translate-y-1/2"><AlertTriangle className="h-4 w-4 text-amber-600" /></span>}
                        </div>
                      </TableCell>
                      <TableCell>{subscriber === undefined ? <span className="inline-flex h-10 items-center text-sm text-muted-foreground">Não cadastrado</span> : <Input readOnly value={money(subscriber)} className="h-10 bg-muted/50 font-medium tabular-nums" />}</TableCell>
                      <TableCell><div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">R$</span><Input type="text" inputMode="decimal" className="h-10 pl-10 pr-9 font-medium tabular-nums" placeholder="Digite o valor" value={draft?.franchise ?? (franchise ? decimal(franchise.price) : "")} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraft(row.variant.id, "franchise", event.target.value)} aria-label={`Valor da Franquia de ${row.productTitle}`} />{franchiseAcima && <span title={acimaTitle} className="absolute right-3 top-1/2 -translate-y-1/2"><AlertTriangle className="h-4 w-4 text-destructive" /></span>}</div></TableCell>
                      <TableCell><Button size="icon" onClick={() => saveRow(row)} disabled={!draft || savingId === row.variant.id} aria-label={`Salvar valores de ${row.productTitle}`}>{savingId === row.variant.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</Button></TableCell>
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
