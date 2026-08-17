import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { type PrintableOrder, orderToA4Html, orderToZpl } from "@/lib/orderPrint";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, Clipboard, Cloud, Code2, FileText, Loader2, Printer, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

interface PendingSyncSale {
  id: string;
  customerName: string;
  total: number;
  createdAt: string;
  error?: string;
}
interface CheckoutAttemptLog {
  id: string;
  created_at: string;
  checkout_session_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  payment_method: "pix" | "credit_card" | "terms" | "unknown";
  stage: "prepare" | "payment" | "shopify_completion";
  success: boolean;
  error_message: string | null;
  provider_payment_id: string | null;
}
interface OrdersResponse {
  orders: PrintableOrder[];
  count: number;
  functions_version?: string;
  recovery?: {
    recovered: number;
    pending: number;
    pendingSales?: PendingSyncSale[];
  };
  checkoutLogs?: CheckoutAttemptLog[];
}
interface PrintQueueResponse { job_id: string; already_queued?: boolean; functions_version?: string }
interface PrintStatusResponse {
  job: { status: "queued" | "printed" | "error"; error_message: string | null; printed_at: string | null };
}

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
const MINIMUM_PRINT_FUNCTION_VERSION = "2026-08-10.8";
const MINIMUM_RECOVERY_FUNCTION_VERSION = "2026-08-15.1";

const FINANCIAL: Record<string, string> = {
  pending: "Pendente", authorized: "Autorizado", partially_paid: "Parcialmente pago", paid: "Pago",
  partially_refunded: "Parcialmente reembolsado", refunded: "Reembolsado", voided: "Cancelado",
};
const FULFILLMENT: Record<string, string> = {
  fulfilled: "Encerrado", partial: "Parcial", restocked: "Devolvido", unfulfilled: "Não separado",
};
const money = (value: number, currency = "BRL") => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value || 0);

function statusLabel(order: PrintableOrder) {
  if (order.cancelled_at) return "Cancelado";
  if (order.financial_status === "refunded") return "Reembolsado";
  if (order.fulfillment_status === "fulfilled") return "Encerrado";
  return FINANCIAL[order.financial_status] || FULFILLMENT[order.fulfillment_status || ""] || "Em andamento";
}

export default function OrdersTab() {
  const [orders, setOrders] = useState<PrintableOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [zplOrder, setZplOrder] = useState<PrintableOrder | null>(null);
  const [printingId, setPrintingId] = useState<string | number | null>(null);
  const [syncPending, setSyncPending] = useState(0);
  const [pendingSales, setPendingSales] = useState<PendingSyncSale[]>([]);
  const [checkoutLogs, setCheckoutLogs] = useState<CheckoutAttemptLog[]>([]);
  const [logQuery, setLogQuery] = useState("");
  const [logStatus, setLogStatus] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-orders", { body: { action: "list" } });
    if (error) toast.error("Não foi possível carregar os pedidos", { description: error.message });
    else {
      const response = data as OrdersResponse;
      setOrders(response?.orders || []);
      setSyncPending(response?.recovery?.pending || 0);
      setPendingSales(response?.recovery?.pendingSales || []);
      setCheckoutLogs(response?.checkoutLogs || []);
      if (!response?.functions_version || response.functions_version < MINIMUM_RECOVERY_FUNCTION_VERSION) {
        toast.warning("A recuperação de vendas ainda não foi publicada no servidor", {
          description: "O site foi atualizado, mas a Edge Function admin-orders continua antiga. Publique essa função para concluir os rascunhos pagos.",
          duration: 15_000,
        });
      }
      const recovered = response?.recovery?.recovered || 0;
      if (recovered > 0) {
        toast.success(`${recovered} venda(s) paga(s) recuperada(s) na Shopify`);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => orders.filter((order) => {
    const haystack = `${order.name} ${order.customer_name} ${order.email || ""} ${order.phone || ""}`.toLowerCase();
    const matchesQuery = haystack.includes(query.trim().toLowerCase());
    const label = statusLabel(order).toLowerCase();
    const matchesStatus = status === "all" || (status === "active" ? !["cancelado", "reembolsado", "encerrado"].includes(label) : label === status);
    return matchesQuery && matchesStatus;
  }), [orders, query, status]);
  const filteredLogs = useMemo(() => checkoutLogs.filter((entry) => {
    const haystack = `${entry.customer_name || ""} ${entry.customer_email || ""} ${entry.checkout_session_id || ""} ${entry.provider_payment_id || ""} ${entry.error_message || ""}`.toLowerCase();
    const matchesQuery = haystack.includes(logQuery.trim().toLowerCase());
    const matchesStatus = logStatus === "all" || (logStatus === "success" ? entry.success : !entry.success);
    return matchesQuery && matchesStatus;
  }), [checkoutLogs, logQuery, logStatus]);

  const printA4 = (order: PrintableOrder) => {
    const popup = window.open("", "_blank");
    if (!popup) return toast.error("O navegador bloqueou a janela de impressão");
    popup.opener = null;
    popup.document.write(orderToA4Html(order));
    popup.document.close();
  };

  const printZpl = async (order: PrintableOrder) => {
    setPrintingId(order.id);
    let notificationId: string | number | undefined;
    try {
      const { data, error } = await supabase.functions.invoke("admin-orders", { body: { action: "queue_print", orderId: String(order.id), orderName: order.name, zpl: orderToZpl(order) } });
      if (error) throw error;
      const queued = data as PrintQueueResponse;
      if (!queued?.job_id) throw new Error("A fila não retornou o identificador da impressão");

      // A entrega para o computador pode funcionar em versões antigas, mas elas
      // não devolvem o resultado. Não deixamos o botão girando por 90 segundos
      // quando já sabemos que a confirmação nunca chegará.
      if (!queued.functions_version || queued.functions_version < MINIMUM_PRINT_FUNCTION_VERSION) {
        toast.warning(`Pedido ${order.name} enviado para impressão`, {
          description: "O computador pode imprimir normalmente, mas a função admin-orders publicada está antiga e não consegue devolver a confirmação.",
          duration: 12_000,
        });
        return;
      }

      notificationId = toast.loading(
        queued.already_queued
          ? `Pedido ${order.name} já estava na fila. Aguardando confirmação...`
          : `Pedido ${order.name} enviado. Aguardando a impressora...`,
      );
      setPrintingId(null);

      let lastStatusProblem = "";
      for (let attempt = 0; attempt < 45; attempt += 1) {
        await wait(2_000);
        const { data: statusData, error: statusError } = await supabase.functions.invoke("admin-orders", {
          body: { action: "print_status", jobId: queued.job_id },
        });
        if (statusError) {
          lastStatusProblem = statusError.message;
          continue;
        }

        const job = (statusData as PrintStatusResponse)?.job;
        if (!job) {
          lastStatusProblem = "A função admin-orders publicada não retornou o status da impressão.";
          continue;
        }
        if (job?.status === "printed") {
          toast.success(`Pedido ${order.name} recebido pela impressora`, {
            id: notificationId,
            description: "O computador remoto aceitou o ZPL na fila de impressão do Windows.",
          });
          return;
        }
        if (job?.status === "error") {
          toast.error(`Falha ao imprimir o pedido ${order.name}`, {
            id: notificationId,
            description: job.error_message || "O computador remoto informou uma falha na impressora.",
          });
          return;
        }
      }

      toast.warning(`Pedido ${order.name} continua aguardando`, {
        id: notificationId,
        description: lastStatusProblem || "Sem confirmação do computador remoto. A solicitação permanece na fila e será processada quando a conexão voltar.",
        duration: 10_000,
      });
    } catch (error) {
      toast.error("Não foi possível enviar à impressora remota", {
        id: notificationId,
        description: error instanceof Error ? error.message : undefined,
      });
    } finally { setPrintingId(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar número, cliente, e-mail ou telefone" className="pl-9" /></div>
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-52"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="all">Todos os status</SelectItem><SelectItem value="active">Em andamento</SelectItem><SelectItem value="encerrado">Encerrados</SelectItem><SelectItem value="cancelado">Cancelados</SelectItem><SelectItem value="reembolsado">Reembolsados</SelectItem>
        </SelectContent></Select>
        <Button variant="outline" onClick={load} disabled={loading}><RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
      </div>

      <Card className="border-blue-200 bg-blue-50/60"><CardContent className="flex items-center gap-3 p-4">
        <Cloud className="h-5 w-5 text-blue-700" /><div><p className="text-sm font-bold">Impressão ZPL remota</p><p className="text-xs text-muted-foreground">O botão envia o pedido pela nuvem ao computador conectado à Zebra. Pedidos novos também são impressos automaticamente, sem reimprimir o histórico.</p></div>
      </CardContent></Card>

      {syncPending > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-4 text-sm text-amber-900">
            <p className="font-bold">{syncPending} venda(s) paga(s) aguardando sincronização com a Shopify</p>
            <p className="mt-1 text-xs">A recuperação automática continuará tentando. Atualize a lista em instantes; a venda não fica mais invisível para a operação.</p>
            {pendingSales && pendingSales.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-amber-200 pt-2 text-xs">
                {pendingSales.slice(0, 5).map((sale) => (
                  <li key={sale.id} className="grid gap-0.5 rounded-md border border-amber-200 bg-white/60 p-2 sm:grid-cols-[1fr_auto]">
                    <span className="font-semibold">{sale.customerName}</span>
                    <span>{money(sale.total)}{sale.createdAt ? ` · ${new Date(sale.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}</span>
                    {sale.error && <span className="text-red-700 sm:col-span-2"><strong>Motivo da Shopify:</strong> {sale.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-bold">Tentativas de compra</p>
              <p className="text-xs text-muted-foreground">Últimos registros de preparação e pagamento, sem dados sensíveis do cartão.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative sm:w-72"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={logQuery} onChange={(event) => setLogQuery(event.target.value)} placeholder="Buscar cliente, e-mail ou erro" className="pl-9" /></div>
              <Select value={logStatus} onValueChange={setLogStatus}><SelectTrigger className="sm:w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="success">Sucesso</SelectItem><SelectItem value="error">Falhas</SelectItem></SelectContent></Select>
            </div>
          </div>
          {filteredLogs.length === 0 ? <p className="rounded-lg bg-slate-50 py-8 text-center text-sm text-muted-foreground">Nenhuma tentativa registrada.</p> : (
            <div className="max-h-80 overflow-auto rounded-lg border">
              <Table><TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Cliente</TableHead><TableHead>Método</TableHead><TableHead>Etapa</TableHead><TableHead>Status</TableHead><TableHead>Detalhe</TableHead></TableRow></TableHeader><TableBody>
                {filteredLogs.slice(0, 50).map((entry) => <TableRow key={entry.id}>
                  <TableCell className="whitespace-nowrap text-xs">{new Date(entry.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</TableCell>
                  <TableCell><div className="font-medium">{entry.customer_name || "Cliente não identificado"}</div><div className="text-xs text-muted-foreground">{entry.customer_email || "—"}</div></TableCell>
                  <TableCell className="whitespace-nowrap">{{ pix: "Pix", credit_card: "Cartão", terms: "Prazo", unknown: "Não informado" }[entry.payment_method]}</TableCell>
                  <TableCell>{{ prepare: "Preparação", payment: "Pagamento", shopify_completion: "Shopify" }[entry.stage]}</TableCell>
                  <TableCell><Badge variant="outline" className={entry.success ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}>{entry.success ? "Sucesso" : "Falhou"}</Badge></TableCell>
                  <TableCell className="max-w-md text-xs text-muted-foreground">{entry.error_message || (entry.provider_payment_id ? `Asaas: ${entry.provider_payment_id}` : "Concluído sem erro")}</TableCell>
                </TableRow>)}
              </TableBody></Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card><CardContent className="p-0">
        {loading ? <div className="flex justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div> : filtered.length === 0 ? <p className="py-16 text-center text-muted-foreground">Nenhum pedido encontrado.</p> :
        <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Pedido</TableHead><TableHead>Cliente</TableHead><TableHead>Data</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Imprimir</TableHead></TableRow></TableHeader><TableBody>
          {filtered.map((order) => <TableRow key={order.id}><TableCell className="font-bold">{order.name}</TableCell><TableCell><div className="font-medium">{order.customer_name}</div><div className="text-xs text-muted-foreground">{order.phone || order.email || "Sem contato"}</div></TableCell><TableCell className="whitespace-nowrap">{new Date(order.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</TableCell><TableCell><Badge variant="outline" className={order.cancelled_at || order.financial_status === "refunded" ? "border-red-200 bg-red-50 text-red-700" : order.fulfillment_status === "fulfilled" ? "border-slate-200 bg-slate-100" : "border-blue-200 bg-blue-50 text-blue-700"}>{statusLabel(order)}</Badge></TableCell><TableCell className="text-right font-semibold">{money(order.total_price, order.currency)}</TableCell><TableCell><div className="flex justify-end gap-1"><Button size="sm" variant="outline" onClick={() => printA4(order)} title="Imprimir em A4"><FileText className="h-4 w-4" /><span className="sr-only">A4</span></Button><Button size="sm" variant="outline" onClick={() => setZplOrder(order)} title="Ver código ZPL"><Code2 className="h-4 w-4" /><span className="sr-only">ZPL</span></Button><Button size="sm" onClick={() => printZpl(order)} disabled={printingId === order.id} title="Enviar à impressora ZPL remota">{printingId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}<span className="sr-only">Imprimir ZPL</span></Button></div></TableCell></TableRow>)}
        </TableBody></Table></div>}
      </CardContent></Card>

      <Dialog open={!!zplOrder} onOpenChange={(open) => !open && setZplOrder(null)}><DialogContent className="max-w-3xl"><DialogHeader><DialogTitle>Código ZPL — {zplOrder?.name}</DialogTitle><DialogDescription>Copie o código, baixe como arquivo ou envie à impressora remota.</DialogDescription></DialogHeader>{zplOrder && <><textarea readOnly value={orderToZpl(zplOrder)} className="h-80 w-full resize-none rounded-md border bg-slate-950 p-3 font-mono text-xs text-emerald-300" /><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={async () => { await navigator.clipboard.writeText(orderToZpl(zplOrder)); toast.success("Código ZPL copiado"); }}><Clipboard className="mr-2 h-4 w-4" />Copiar</Button><Button variant="outline" onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([orderToZpl(zplOrder)], { type: "text/plain" })); a.download = `pedido-${String(zplOrder.name).replace(/\D/g, "")}.zpl`; a.click(); URL.revokeObjectURL(a.href); }}><Check className="mr-2 h-4 w-4" />Baixar .zpl</Button><Button disabled={printingId === zplOrder.id} onClick={() => printZpl(zplOrder)}>{printingId === zplOrder.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}Imprimir ZPL</Button></div></>}</DialogContent></Dialog>
    </div>
  );
}
