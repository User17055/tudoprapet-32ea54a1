import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Crown,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
  Store,
  Users,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import type { PrintableOrder } from "@/lib/orderPrint";
import { toast } from "sonner";

interface DashboardData {
  users: number;
  franchisees: number;
  members: number;
  administrators: number;
  recentOrders: PrintableOrder[];
  pendingSales: number;
  failedCheckouts: number;
  maintenance: boolean;
}

const initialData: DashboardData = {
  users: 0,
  franchisees: 0,
  members: 0,
  administrators: 0,
  recentOrders: [],
  pendingSales: 0,
  failedCheckouts: 0,
  maintenance: false,
};

const money = (value: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value || 0);

const orderStatus = (order: PrintableOrder) => {
  if (order.cancelled_at) return "Cancelado";
  if (order.financial_status === "paid") return "Pago";
  if (order.financial_status === "refunded") return "Reembolsado";
  if (order.fulfillment_status === "fulfilled") return "Concluído";
  return "Em andamento";
};

export default function OverviewTab() {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [profiles, members, administrators, maintenance, ordersResult] = await Promise.all([
      supabase.from("profiles").select("user_id,is_franchisee"),
      supabase.from("club_members").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("user_roles").select("id", { count: "exact", head: true }).eq("role", "admin"),
      supabase.from("site_maintenance").select("enabled").eq("id", true).maybeSingle(),
      supabase.functions.invoke("admin-orders", { body: { action: "list", limit: 8 } }),
    ]);

    const firstError = profiles.error || members.error || administrators.error || maintenance.error || ordersResult.error;
    if (firstError) {
      toast.error("Não foi possível carregar toda a visão geral", {
        description: firstError.message,
      });
    }

    const orderPayload = (ordersResult.data || {}) as {
      orders?: PrintableOrder[];
      recovery?: { pending?: number };
      checkoutLogs?: Array<{ success?: boolean }>;
    };
    const profileRows = profiles.data || [];
    setData({
      users: profileRows.length,
      franchisees: profileRows.filter((profile) => profile.is_franchisee).length,
      members: members.count || 0,
      administrators: administrators.count || 0,
      recentOrders: orderPayload.orders || [],
      pendingSales: orderPayload.recovery?.pending || 0,
      failedCheckouts: (orderPayload.checkoutLogs || []).filter((entry) => entry.success === false).length,
      maintenance: Boolean(maintenance.data?.enabled),
    });
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-72 items-center justify-center">
          <div className="text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-[#112f5f]" />
            Carregando indicadores...
          </div>
        </CardContent>
      </Card>
    );
  }

  const cards = [
    { label: "Clientes", value: data.users, icon: Users, color: "bg-blue-50 text-blue-700", to: "/admin?tab=users" },
    { label: "Membros ativos", value: data.members, icon: Crown, color: "bg-amber-50 text-amber-700", to: "/admin?tab=members" },
    { label: "Franqueados", value: data.franchisees, icon: Store, color: "bg-emerald-50 text-emerald-700", to: "/admin?tab=franquia" },
    { label: "Administradores", value: data.administrators, icon: ShieldCheck, color: "bg-violet-50 text-violet-700", to: "/admin?tab=administrators" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, color, to }) => (
          <Link key={label} to={to} className="group">
            <Card className="h-full border-0 shadow-sm transition-transform group-hover:-translate-y-0.5 group-hover:shadow-md">
              <CardContent className="flex items-center gap-4 p-5">
                <span className={`flex h-12 w-12 items-center justify-center rounded-xl ${color}`}>
                  <Icon className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-2xl font-extrabold tabular-nums text-[#0a1931]">{value}</p>
                  <p className="text-sm font-medium text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {(data.maintenance || data.pendingSales > 0 || data.failedCheckouts > 0) && (
        <Card className="border-amber-200 bg-amber-50/70">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-amber-900">
              <AlertTriangle className="h-5 w-5" /> Atenção necessária
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 pt-0 text-sm text-amber-900 md:grid-cols-3">
            {data.maintenance && <StatusLink to="/admin?tab=maintenance" icon={Wrench} text="A loja está em manutenção" />}
            {data.pendingSales > 0 && <StatusLink to="/admin?tab=orders" icon={Package} text={`${data.pendingSales} venda(s) aguardando sincronização`} />}
            {data.failedCheckouts > 0 && <StatusLink to="/admin?tab=orders" icon={AlertTriangle} text={`${data.failedCheckouts} falha(s) recente(s) no checkout`} />}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="border-0 shadow-sm">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-lg text-[#0a1931]">Pedidos recentes</CardTitle>
            <Button asChild variant="ghost" size="sm" className="gap-1 text-[#112f5f]">
              <Link to="/admin?tab=orders">Ver todos <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            {data.recentOrders.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Nenhum pedido encontrado.</p>
            ) : (
              <div className="divide-y">
                {data.recentOrders.map((order) => (
                  <div key={order.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[#112f5f]">
                      <Package className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-slate-900">{order.name} · {order.customer_name}</p>
                      <p className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-900">{money(order.total_price, order.currency)}</p>
                      <Badge variant="outline" className="mt-1 text-[10px]">{orderStatus(order)}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg text-[#0a1931]">Acesso rápido</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <QuickLink to="/admin?tab=orders" icon={Package} label="Gerenciar pedidos" />
            <QuickLink to="/admin?tab=users" icon={Users} label="Consultar clientes" />
            <QuickLink to="/admin?tab=administrators" icon={ShieldCheck} label="Cadastrar administrador" />
            <QuickLink to="/admin?tab=maintenance" icon={Wrench} label="Controlar manutenção" />
            <Button type="button" variant="outline" className="mt-4 w-full gap-2" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Atualizar indicadores
            </Button>
          </CardContent>
        </Card>
      </div>

      {!data.maintenance && data.pendingSales === 0 && data.failedCheckouts === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="h-5 w-5" /> Nenhum alerta operacional no momento.
        </div>
      )}
    </div>
  );
}

function QuickLink({ to, icon: Icon, label }: { to: string; icon: typeof Package; label: string }) {
  return (
    <Button asChild variant="ghost" className="h-11 w-full justify-between px-3">
      <Link to={to}>
        <span className="flex items-center gap-3"><Icon className="h-4 w-4 text-[#112f5f]" />{label}</span>
        <ArrowRight className="h-4 w-4 text-muted-foreground" />
      </Link>
    </Button>
  );
}

function StatusLink({ to, icon: Icon, text }: { to: string; icon: typeof Package; text: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 rounded-lg bg-white/70 p-3 font-medium hover:bg-white">
      <Icon className="h-4 w-4 shrink-0" /> <span>{text}</span>
    </Link>
  );
}

