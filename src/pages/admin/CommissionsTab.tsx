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

interface CommissionCode {
  id: string;
  code: string;
  employee_name: string;
  active: boolean;
  commission_percent: number;
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
  referral_code_id: string;
  scope: "category" | "product";
  category_id: string | null;
  shopify_product_id: string | null;
  percent: number;
}
interface Category { id: string; name: string; parent_id: string | null }

const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const PAGE_SIZE = 20;

export default function CommissionsTab() {
  const [codes, setCodes] = useState<CommissionCode[]>([]);
  const [sales, setSales] = useState<CommissionSale[]>([]);
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [ruleCodeId, setRuleCodeId] = useState("");
  const [ruleScope, setRuleScope] = useState<"category" | "product">("category");
  const [ruleTarget, setRuleTarget] = useState("");
  const [rulePercent, setRulePercent] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [person, setPerson] = useState("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const load = async () => {
    setLoading(true);
    try {
      const [report, categoryResult, catalog] = await Promise.all([
        supabase.functions.invoke("admin-commissions", { body: { action: "list" } }),
        supabase.from("categories").select("id,name,parent_id").order("name"),
        fetchAllShopifyProducts(),
      ]);
      const { data, error } = report;
      if (error || categoryResult.error || !Array.isArray(data?.codes) || !Array.isArray(data?.sales) || !Array.isArray(data?.rules)) throw error || categoryResult.error || new Error("Resposta inválida");
      setCodes(data.codes);
      setSales(data.sales);
      setRules(data.rules);
      setCategories(categoryResult.data || []);
      setProducts(catalog);
      setRuleCodeId((current) => current || data.codes[0]?.id || "");
      setRates(Object.fromEntries((data.codes as CommissionCode[]).map((code) => [code.id, String(code.commission_percent)])));
    } catch (error) {
      toast.error("Não foi possível carregar as comissões", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const saveRate = async (code: CommissionCode) => {
    const percent = Number((rates[code.id] || "").replace(",", "."));
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      toast.error("Informe uma comissão entre 0% e 100%.");
      return;
    }
    setSavingId(code.id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-commissions", {
        body: { action: "update_rate", codeId: code.id, percent },
      });
      if (error || !data?.ok) throw error || new Error("Não foi possível salvar a taxa");
      toast.success("Taxa atualizada para as próximas vendas.");
      await load();
    } catch (error) {
      toast.error("Não foi possível salvar a comissão", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSavingId(null);
    }
  };

  const saveRule = async () => {
    const percent = Number(rulePercent.replace(",", "."));
    if (!ruleCodeId || !ruleTarget || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      toast.error("Selecione a pessoa, o alcance e uma porcentagem de 0% a 100%.");
      return;
    }
    setSavingId("rule");
    try {
      const { data, error } = await supabase.functions.invoke("admin-commissions", { body: {
        action: "save_rule", codeId: ruleCodeId, scope: ruleScope, targetId: ruleTarget, percent,
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
  const filtered = useMemo(() => sales.filter((sale) => {
    if (person !== "all" && sale.code !== person) return false;
    if (status !== "all" && sale.status !== status) return false;
    const term = query.trim().toLocaleLowerCase("pt-BR");
    return !term || [sale.customerName, sale.customerEmail, sale.employeeName, sale.code,
      ...sale.products.map((product) => product.name)].join(" ").toLocaleLowerCase("pt-BR").includes(term);
  }), [sales, person, status, query]);
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
        <div><CardTitle className="text-base">Comissão por pessoa</CardTitle>
          <CardDescription>Taxa da loja toda: usada quando não há regra de produto ou categoria. Alterações valem apenas para novas compras.</CardDescription>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {codes.length === 0 && <p className="text-sm text-muted-foreground">Nenhum código cadastrado. Crie um na aba Indicações.</p>}
        {codes.map((code) => {
          const ownPaid = sales.filter((sale) => sale.code === code.code && sale.status === "paid");
          return <div key={code.id} className="rounded-lg border p-4">
            <p className="font-semibold">{code.employee_name} <span className="text-xs font-normal text-muted-foreground">· {code.code}{!code.active ? " · inativo" : ""}</span></p>
            <p className="mt-1 text-sm text-muted-foreground">{ownPaid.length} vendas pagas · {money(ownPaid.reduce((sum, sale) => sum + sale.productsTotal, 0))} vendidos</p>
            <p className="mt-2 text-xs text-muted-foreground">Loja toda (padrão)</p>
            <div className="mt-1 flex items-center gap-2">
              <Input aria-label={`Comissão de ${code.employee_name} em percentual`} type="number" min="0" max="100" step="0.01" value={rates[code.id] ?? ""} onChange={(event) => setRates((current) => ({ ...current, [code.id]: event.target.value }))} className="w-24" />
              <span className="text-sm">%</span>
              <Button size="sm" variant="outline" onClick={() => void saveRate(code)} disabled={savingId === code.id || rates[code.id] === String(code.commission_percent)}>
                {savingId === code.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
              </Button>
            </div>
          </div>;
        })}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle className="text-base">Regras por categoria ou produto</CardTitle>
        <CardDescription>Produto prevalece sobre subgrupo; o subgrupo mais próximo prevalece sobre o grupo geral. Sem regra específica, vale a taxa da loja toda. Frete não gera comissão.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_minmax(0,2fr)_120px_auto] md:items-end">
          <div><p className="mb-1 text-xs">Pessoa</p><Select value={ruleCodeId} onValueChange={setRuleCodeId}><SelectTrigger aria-label="Pessoa da regra"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent>{codes.map((code) => <SelectItem key={code.id} value={code.id}>{code.employee_name} · {code.code}</SelectItem>)}</SelectContent></Select></div>
          <div><p className="mb-1 text-xs">Alcance</p><Select value={ruleScope} onValueChange={(value: "category" | "product") => { setRuleScope(value); setRuleTarget(""); }}><SelectTrigger aria-label="Alcance da regra"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="category">Categoria / subgrupo</SelectItem><SelectItem value="product">Produto</SelectItem></SelectContent></Select></div>
          <div><p className="mb-1 text-xs">{ruleScope === "category" ? "Grupo ou subgrupo" : "Produto"}</p>{ruleScope === "category"
            ? <Select value={ruleTarget} onValueChange={setRuleTarget}><SelectTrigger aria-label="Categoria da regra"><SelectValue placeholder="Selecione uma categoria" /></SelectTrigger><SelectContent>{categories.map((category) => <SelectItem key={category.id} value={category.id}>{categoryPath(category.id)}</SelectItem>)}</SelectContent></Select>
            : <ProductPicker products={products} value={ruleTarget} onChange={setRuleTarget} />}</div>
          <div><p className="mb-1 text-xs">Comissão %</p><Input aria-label="Percentual da regra" type="number" min="0" max="100" step="0.01" value={rulePercent} onChange={(event) => setRulePercent(event.target.value)} /></div>
          <Button onClick={() => void saveRule()} disabled={savingId === "rule" || !codes.length}>{savingId === "rule" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar regra"}</Button>
        </div>
        <div className="space-y-2">{rules.map((rule) => {
          const code = codes.find((item) => item.id === rule.referral_code_id);
          const target = rule.scope === "category" ? categoryPath(rule.category_id || "") : products.find((item) => item.node.id === rule.shopify_product_id)?.node.title || rule.shopify_product_id;
          return <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"><span><b>{code?.employee_name || "Pessoa removida"}</b> · {rule.scope === "category" ? "Categoria" : "Produto"}: {target} · <b>{rule.percent}%</b></span><Button size="sm" variant="outline" onClick={() => void deleteRule(rule.id)} disabled={savingId === rule.id}>Remover</Button></div>;
        })}{!rules.length && <p className="text-sm text-muted-foreground">Nenhuma regra específica. Vale a taxa da loja toda.</p>}</div>
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
