import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Printer, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  formatDateTime,
  formatMoney,
  orderStatusSummary,
  printOrder,
  statusLabel,
  type PrintOrder,
} from "@/lib/orderPrint";

type AdminOrder = PrintOrder & {
  id: number;
  name: string;
  order_number: number;
  closed_at?: string | null;
};

const STATUS_FILTERS = [
  { value: "all", label: "Todos os status" },
  { value: "cancelled", label: "Cancelados" },
  { value: "closed", label: "Encerrados" },
  { value: "refunded", label: "Reembolsados" },
  { value: "paid", label: "Pagos" },
  { value: "pending", label: "Pagamento pendente" },
  { value: "unfulfilled", label: "Não processados" },
  { value: "fulfilled", label: "Processados" },
];

export default function OrdersTab() {
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // status=any na função: cancelados, encerrados e reembolsados vêm juntos.
      const { data, error } = await supabase.functions.invoke("admin-orders", {
        body: { status: "any", limit: 250 },
      });
      if (error) throw error;
      setOrders((data?.orders as AdminOrder[]) ?? []);
    } catch (e) {
      toast.error("Não foi possível carregar os pedidos", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (term) {
        const haystack = [o.name, o.order_number, o.customer_name, o.customer_email, o.pickup_code]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      switch (statusFilter) {
        case "cancelled":
          return !!o.cancelled_at;
        case "closed":
          return !!o.closed_at;
        case "refunded":
          return o.financial_status === "refunded" || o.financial_status === "partially_refunded";
        case "paid":
          return o.financial_status === "paid";
        case "pending":
          return o.financial_status === "pending" || o.financial_status === "authorized";
        case "fulfilled":
          return o.fulfillment_status === "fulfilled" || o.fulfillment_status === "partial";
        case "unfulfilled":
          return !o.fulfillment_status;
        default:
          return true;
      }
    });
  }, [orders, search, statusFilter]);

  const handlePrint = (order: AdminOrder) => {
    if (!printOrder(order)) {
      toast.error("Libere as janelas pop-up para imprimir o pedido.");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Pedidos</CardTitle>
          <CardDescription>
            Todos os pedidos da loja, incluindo cancelados, encerrados e reembolsados.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Atualizar
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por pedido, cliente, e-mail ou código de retirada"
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhum pedido encontrado.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Retirada</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Imprimir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-semibold">{o.name}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{formatDateTime(o.created_at)}</TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{o.customer_name}</div>
                      {o.customer_email && (
                        <div className="text-xs text-muted-foreground">{o.customer_email}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {o.cancelled_at ? "Cancelado" : orderStatusSummary(o)}
                      {o.closed_at && !o.cancelled_at && (
                        <div className="text-xs text-muted-foreground">Encerrado</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {o.pickup_code ?? "-"}
                      {o.picked_up_at && (
                        <div className="text-xs text-muted-foreground">Retirado</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {formatMoney(o.total_price, o.currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" className="gap-2" onClick={() => handlePrint(o)}>
                        <Printer className="h-4 w-4" />
                        <span className="hidden sm:inline">Imprimir</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Legenda de pagamento: {statusLabel("paid")}, {statusLabel("pending")}, {statusLabel("refunded")}.
        </p>
      </CardContent>
    </Card>
  );
}
