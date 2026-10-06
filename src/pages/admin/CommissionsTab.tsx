import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllShopifyProducts, type ShopifyProduct } from "@/lib/shopify";
import { ProductPicker } from "@/components/admin/ProductPicker";
import { fetchAllRowsResult } from "@/lib/fetchAllRows";

interface CommissionCode {
  id: string;
  code: string;
  employee_name: string;
  active: boolean;
}

interface CommissionSale {
  id: string;
  createdAt: string;
  code: string;
  employeeName: string;
  customerName: string;
  customerEmail: string;
  shopifyOrderId: string | null;
  status: "paid" | "pending" | "reversed";
  products: Array<{ name: string; variant: string; quantity: number; total: number; commissionPercent: number; commissionAmount: number }>;
  productsTotal: number;
  commissionPercent: number | null;
  commissionAmount: number;
}

interface CommissionRule {
  id: string;
  scope: "category" | "product";
  category_id: string | null;
  shopify_product_id: string | null;
  percent: number;
}
interface BlockedCustomer { id: string; email: string; reason: string | null; created_at: string }
interface Category { id: string; name: string; parent_id: string | null }

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const PAGE_SIZE = 20;
const pad2 = (value: number) => String(value).padStart(2, "0");
const localDateValue = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
const localMonthValue = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
const parseDateParts = (value: string): [number, number, number] => value.split("-").map(Number) as [number, number, number];

export default function CommissionsTab() {
  const [codes, setCodes] = useState<CommissionCode[]>([]);
  const [sales, setSales] = useState<CommissionSale[]>([]);
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [blockedCustomers, setBlockedCustomers] = useState<BlockedCustomer[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [ruleScope, setRuleScope] = useState<"category" | "product">("category");
  const [ruleTarget, setRuleTarget] = useState("");
  const [rulePercent, setRulePercent] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [storeRate, setStoreRate] = useState("");
  const [storeRateSaved, setStoreRateSaved] = useState("");
  const [blockEmail, setBlockEmail] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [person, setPerson] = useState("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState<"all" | "month" | "day" | "custom">("all");
  const [monthValue, setMonthValue] = useState(() => localMonthValue(new Date()));
  const [dayValue, setDayValue] = useState(() => localDateValue(new Date()));
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [report, categoryResult, catalog] = await Promise.all([
        supabase.functions.invoke("admin-commissions", { body: { action: "list" } }),
        fetchAllRowsResult<{ id: string; name: string; parent_id: string | null }>(
          "categories",
          "id,name,parent_id",
          { orderBy: ["name", "id"] },
        ),
        fetchAllShopifyProducts(),
      ]);
      const { data, error } = report;
      if (error || categoryResult.error || !Array.isArray(data?.codes) || !Array.isArray(data?.sales) || !Array.isArray(data?.rules)) throw error || categoryResult.error || new Error("Resposta inválida");
      setCodes(data.codes);
      setSales(data.sales);
      setRules(data.rules);
      setBlockedCustomers(Array.isArray(data.blockedCustomers) ? data.blockedCustomers : []);
      setCategories(categoryResult.data || []);
      setProducts(catalog);
      const rate = String(data.storePercent ?? 0);
      setStoreRate(rate);
      setStoreRateSaved(rate);
    } catch (error) {
      toast.error("Não foi possível carregar as comissões", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const saveStoreRate = async () => {
    const percent = Number(storeRate.replace(",", "."));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      toast.error("Informe uma comissão entre 0% e 100%.");
      return;
    }
    setSavingId("store-rate");
    try {
      const { data, error } = await supabase.functions.invoke("admin-commissions", {
        body: { action: "update_store_rate", percent },
      });
      if (error || !data?.ok) throw error || new Error("Não foi possível salvar a taxa");
      toast.success("Taxa padrão atualizada para as próximas vendas.");
      await load();
    } catch (error) {
      toast.error("Não foi possível salvar a comissão", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSavingId(null);
    }
  };

  const saveRule = async () => {
    const percent = Number(rulePercent.replace(",", "."));
    if (!ruleTarget || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      toast.error("Selecione o alcance e uma porcentagem de 0% a 100%.");
      return;
    }
    setSavingId("rule");
    try {
      const { data, error } = await supabase.functions.invoke("admin-commissions", { body: {
        action: "save_rule", scope: ruleScope, targetId: ruleTarget, percent,
      } });
      if (error || !data?.ok) throw error || new Error("Não foi possível salvar a regra");
      toast.success("Regra salva para as próximas compras.");
      setRuleTarget("");
      setRulePercent("");
      await load();
    } catch (error) {
      toast.error("Não foi possível salvar a regra", { description: error instanceof Error ? error.message : undefined });
    } finally { setSavingId(null); }
  };

  const deleteRule = async (ruleId: string) => {
    setSavingId(ruleId);
    try {
      const { data, error } = await supabase.functions.invoke("admin-commissions", { body: { action: "delete_rule", ruleId } });
      if (error || !data?.ok) throw error || new Error("Não foi possível excluir a regra");
      toast.success("Regra removida para as próximas compras.");
      await load();
    } catch (error) {
      toast.error("Não foi possível remover a regra", { description: error instanceof Error ? error.message : undefined });
    } finally { setSavingId(null); }
  };

  const blockCustomer = async () => {
    const email = blockEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    setSavingId("block-customer");
    try {
      const { data, error } = await supabase.functions.invoke("admin-commissions", {
        body: { action: "block_customer", email, reason: blockReason.trim() || undefined },
      });
      if (error || !data?.ok) throw error || new Error("Não foi possível bloquear o cliente");
      toast.success("Cliente não vai mais gerar comissão.");
      setBlockEmail("");
      setBlockReason("");
      await load();
    } catch (error) {
      toast.error("Não foi possível bloquear o cliente", { description: error instanceof Error ? error.message : undefined });
    } finally { setSavingId(null); }
  };

  const unblockCustomer = async (id: string) => {
    setSavingId(id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-commissions", { body: { action: "unblock_customer", id } });
      if (error || !data?.ok) throw error || new Error("Não foi possível remover o bloqueio");
      toast.success("Cliente volta a poder gerar comissão.");
      await load();
    } catch (error) {
      toast.error("Não foi possível remover o bloqueio", { description: error instanceof Error ? error.message : undefined });
    } finally { setSavingId(null); }
  };

  const categoryPath = (categoryId: string) => {
    const byId = new Map(categories.map((category) => [category.id, category]));
    const names: string[] = [];
    const visited = new Set<string>();
    let id: string | null = categoryId;
    while (id && !visited.has(id)) {
      visited.add(id);
      const category = byId.get(id);
      if (!category) break;
      names.unshift(category.name);
      id = category.parent_id;
    }
    return names.join(" › ") || categoryId;
  };

  const people = useMemo(() => {
    const map = new Map(codes.map((code) => [code.code, code.employee_name]));
    sales.forEach((sale) => { if (!map.has(sale.code)) map.set(sale.code, sale.employeeName); });
    return [...map].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  }, [codes, sales]);
  // Fim é sempre exclusivo (início do próximo dia/mês), pra pegar o dia/mês inteiro
  // sem depender do horário exato de cada venda.
  const periodRange = useMemo<{ start: Date | null; end: Date | null }>(() => {
    if (period === "month" && monthValue) {
      const [year, month] = parseDateParts(monthValue);
      return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) };
    }
    if (period === "day" && dayValue) {
      const [year, month, day] = parseDateParts(dayValue);
      return { start: new Date(year, month - 1, day), end: new Date(year, month - 1, day + 1) };
    }
    if (period === "custom" && (customFrom || customTo)) {
      const start = customFrom ? (([year, month, day]) => new Date(year, month - 1, day))(parseDateParts(customFrom)) : null;
      const end = customTo ? (([year, month, day]) => new Date(year, month - 1, day + 1))(parseDateParts(customTo)) : null;
      return { start, end };
    }
    return { start: null, end: null };
  }, [period, monthValue, dayValue, customFrom, customTo]);
  const filtered = useMemo(() => sales.filter((sale) => {
    if (person !== "all" && sale.code !== person) return false;
    if (status !== "all" && sale.status !== status) return false;
    const createdAt = new Date(sale.createdAt);
    if (periodRange.start && createdAt < periodRange.start) return false;
    if (periodRange.end && createdAt >= periodRange.end) return false;
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return !term || [sale.customerName, sale.customerEmail, sale.employeeName, sale.code,
      ...sale.products.map((product) => product.name)].join(" ").toLocaleLowerCase("pt-BR").includes(term);
  }), [sales, person, status, query, periodRange]);
  const paid = filtered.filter((sale) => sale.status === "paid");
  const totalSold = paid.reduce((sum, sale) => sum + sale.productsTotal, 0);
  const totalCommission = paid.reduce((sum, sale) => sum + sale.commissionAmount, 0);
  const totalProducts = paid.reduce((sum, sale) => sum + sale.products.reduce((count, product) => count + product.quantity, 0), 0);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        ["Vendas pagas", String(paid.length)],
        ["Produtos vendidos (sem frete)", money(totalSold)],
        ["Produtos vendidos", String(totalProducts)],
        ["Comissão calculada", money(totalCommission)],
      ].map(([label, value]) => <Card key={label}><CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-bold">{value}</p>
      </CardContent></Card>)}
    </div>

    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><CardTitle className="text-base">Taxa padrão da loja</CardTitle>
          <CardDescription>Vale para qualquer pessoa, em qualquer venda, quando não há regra de categoria ou produto. Alterações valem apenas para novas compras.</CardDescription>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <Input aria-label="Comissão padrão da loja em percentual" type="number" min="0" max="100" step="0.01" value={storeRate} onChange={(event) => setStoreRate(event.target.value)} className="w-24" />
          <span className="text-sm">%</span>
          <Button size="sm" variant="outline" onClick={() => void saveStoreRate()} disabled={savingId === "store-rate" || storeRate === storeRateSaved}>
            {savingId === "store-rate" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle className="text-base">Regras por categoria ou produto</CardTitle>
        <CardDescription>Vale igual para qualquer pessoa que indicar. Produto prevalece sobre subgrupo; o subgrupo mais próximo prevalece sobre o grupo geral. Sem regra específica, vale a taxa padrão da loja. Frete não gera comissão.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[160px_minmax(0,2fr)_120px_auto] md:items-end">
          <div><p className="mb-1 text-xs">Alcance</p><Select value={ruleScope} onValueChange={(value: "category" | "product") => { setRuleScope(value); setRuleTarget(""); }}><SelectTrigger aria-label="Alcance da regra"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="category">Categoria / subgrupo</SelectItem><SelectItem value="product">Produto</SelectItem></SelectContent></Select></div>
          <div><p className="mb-1 text-xs">{ruleScope === "category" ? "Grupo ou subgrupo" : "Produto"}</p>{ruleScope === "category"
            ? <Select value={ruleTarget} onValueChange={setRuleTarget}><SelectTrigger aria-label="Categoria da regra"><SelectValue placeholder="Selecione uma categoria" /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{categoryPath(category.id)}</SelectItem>)}</SelectContent></Select>
            : <ProductPicker products={products} value={ruleTarget} onChange={setRuleTarget} />}</div>
          <div><p className="mb-1 text-xs">Comissão %</p><Input aria-label="Percentual da regra" type="number" min="0" max="100" step="0.01" value={rulePercent} onChange={(event) => setRulePercent(event.target.value)} /></div>
          <Button onClick={() => void saveRule()} disabled={savingId === "rule"}>{savingId === "rule" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar regra"}</Button>
        </div>
        <div className="space-y-2">{rules.map((rule) => {
          const target = rule.scope === "category" ? categoryPath(rule.category_id || "") : products.find((item) => item.node.id === rule.shopify_product_id)?.node.title || rule.shopify_product_id;
          return <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"><span>{rule.scope === "category" ? "Categoria" : "Produto"}: <b>{target}</b> · <b>{rule.percent}%</b></span><Button size="sm" variant="outline" onClick={() => void deleteRule(rule.id)} disabled={savingId === rule.id}>Remover</Button></div>;
        })}{!rules.length && <p className="text-sm text-muted-foreground">Nenhuma regra específica. Vale a taxa padrão da loja.</p>}</div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle className="text-base">Clientes sem comissão</CardTitle>
        <CardDescription>Pessoas nesta lista nunca geram comissão, mesmo comprando com um código de indicação válido — por exemplo, quem compra sozinho todo dia.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
          <div><p className="mb-1 text-xs">E-mail do cliente</p><Input aria-label="E-mail do cliente bloqueado" type="email" value={blockEmail} onChange={(event) => setBlockEmail(event.target.value)} placeholder="cliente@exemplo.com" /></div>
          <div><p className="mb-1 text-xs">Motivo (opcional)</p><Input aria-label="Motivo do bloqueio" value={blockReason} onChange={(event) => setBlockReason(event.target.value)} placeholder="Ex.: compra todo dia" /></div>
          <Button onClick={() => void blockCustomer()} disabled={savingId === "block-customer"}>{savingId === "block-customer" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Bloquear"}</Button>
        </div>
        <div className="space-y-2">{blockedCustomers.map((customer) => (
          <div key={customer.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm">
            <span><b>{customer.email}</b>{customer.reason ? ` · ${customer.reason}` : ""}</span>
            <Button size="sm" variant="outline" onClick={() => void unblockCustomer(customer.id)} disabled={savingId === customer.id}>Remover</Button>
          </div>
        ))}{!blockedCustomers.length && <p className="text-sm text-muted-foreground">Nenhum cliente bloqueado.</p>}</div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle className="text-base">Vendas atribuídas</CardTitle>
        <CardDescription>Somente pagamentos confirmados geram comissão calculada sobre os produtos, sem frete. Pedidos pendentes e estornados continuam visíveis. O pagamento da comissão não é automático.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-wrap gap-2">
          <Select value={person} onValueChange={(value) => { setPerson(value); setPage(1); }}><SelectTrigger className="w-full sm:w-56" aria-label="Filtrar pessoa"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">Todas as pessoas</SelectItem>
            {people.map(([code, name]) => <SelectItem key={code} value={code}>{name} · {code}</SelectItem>)}
          </SelectContent></Select>
          <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger className="w-full sm:w-44" aria-label="Filtrar situação"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">Todas as situações</SelectItem><SelectItem value="paid">Pagas</SelectItem><SelectItem value="pending">Pendentes</SelectItem><SelectItem value="reversed">Estornadas/canceladas</SelectItem>
          </SelectContent></Select>
          <div className="relative flex-1 sm:min-w-60"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar cliente, pessoa, código ou produto" className="pl-9" />
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select value={period} onValueChange={(value: "all" | "month" | "day" | "custom") => { setPeriod(value); setPage(1); }}><SelectTrigger className="w-full sm:w-44" aria-label="Filtrar período"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="all">Todo o período</SelectItem><SelectItem value="month">Mês</SelectItem><SelectItem value="day">Dia</SelectItem><SelectItem value="custom">Personalizado</SelectItem>
          </SelectContent></Select>
          {period === "month" && <Input aria-label="Mês da comissão" type="month" value={monthValue} onChange={(event) => { setMonthValue(event.target.value); setPage(1); }} className="w-full sm:w-44" />}
          {period === "day" && <Input aria-label="Dia da comissão" type="date" value={dayValue} onChange={(event) => { setDayValue(event.target.value); setPage(1); }} className="w-full sm:w-44" />}
          {period === "custom" && <>
            <Input aria-label="De" type="date" value={customFrom} onChange={(event) => { setCustomFrom(event.target.value); setPage(1); }} className="w-full sm:w-40" />
            <span className="text-sm text-muted-foreground">até</span>
            <Input aria-label="Até" type="date" value={customTo} onChange={(event) => { setCustomTo(event.target.value); setPage(1); }} className="w-full sm:w-40" />
          </>}
        </div>
        {loading ? <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
          : visible.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma venda encontrada.</p>
          : <div className="overflow-x-auto"><Table><TableHeader><TableRow>
            <TableHead>Data / pedido</TableHead><TableHead>Pessoa</TableHead><TableHead>Cliente</TableHead><TableHead>Produtos e quantidades</TableHead><TableHead>Situação</TableHead><TableHead className="text-right">Venda / comissão</TableHead>
          </TableRow></TableHeader><TableBody>{visible.map((sale) => <TableRow key={sale.id}>
            <TableCell className="whitespace-nowrap text-sm">{new Date(sale.createdAt).toLocaleDateString("pt-BR")}<p className="text-xs text-muted-foreground">{sale.shopifyOrderId ? `Pedido ${sale.shopifyOrderId.split("/").at(-1)}` : `Sessão ${sale.id.slice(0, 8)}`}</p></TableCell>
            <TableCell><p className="font-medium">{sale.employeeName}</p><p className="text-xs text-muted-foreground">{sale.code}</p></TableCell>
            <TableCell><p>{sale.customerName}</p><p className="text-xs text-muted-foreground">{sale.customerEmail}</p></TableCell>
            <TableCell className="min-w-56">{sale.products.map((product, index) => <p key={`${sale.id}-${index}`} className="text-sm">{product.quantity}× {product.name}{product.variant && product.variant !== "Default Title" ? ` · ${product.variant}` : ""} <span className="text-muted-foreground">({money(product.total)} · {product.commissionPercent}% = {sale.status === "paid" ? money(product.commissionAmount) : sale.status === "pending" ? "pendente" : "estornada"})</span></p>)}</TableCell>
            <TableCell className="text-sm">{sale.status === "paid" ? "Paga" : sale.status === "pending" ? "Pendente" : "Estornada/cancelada"}</TableCell>
            <TableCell className="whitespace-nowrap text-right"><p className="font-semibold">{money(sale.productsTotal)}</p><p className="text-xs text-muted-foreground">{sale.commissionPercent === null ? "Taxas por item" : `${sale.commissionPercent}%`} · {sale.status === "paid" ? money(sale.commissionAmount) : "sem comissão"}</p></TableCell>
          </TableRow>)}</TableBody></Table></div>}
        {pages > 1 && <div className="mt-4 flex items-center justify-end gap-2 text-sm"><Button size="icon" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>Página {page} de {pages}<Button size="icon" variant="outline" disabled={page === pages} onClick={() => setPage(page + 1)} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></Button></div>}
      </CardContent>
    </Card>
  </div>;
}
