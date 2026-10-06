import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  CircleDollarSign,
  Crown,
  Loader2,
  Package,
  Receipt,
  ShieldCheck,
  Store,
  Users,
  Wrench,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { PrintableOrder } from "@/lib/orderPrint";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { fetchAllRowsResult } from "@/lib/fetchAllRows";

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

const STATUS_STYLES: Record<string, string> = {
  Pago: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  Concluído: "bg-blue-50 text-blue-700 ring-blue-600/20",
  "Em andamento": "bg-amber-50 text-amber-800 ring-amber-600/20",
  Reembolsado: "bg-rose-50 text-rose-700 ring-rose-600/20",
  Cancelado: "bg-slate-100 text-slate-600 ring-slate-500/20",
};

const greeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
};

export default function OverviewTab() {
  const { user } = useAuth();
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [profiles, members, administrators, maintenance, ordersResult] = await Promise.all([
      fetchAllRowsResult<{ user_id: string; is_franchisee: boolean }>("profiles", "user_id,is_franchisee", {
        orderBy: "user_id",
      }),
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

  const firstName =
    user?.user_metadata?.first_name || user?.user_metadata?.name?.split(" ")[0] || user?.email?.split("@")[0] || "";
  // "terça-feira, 29 de setembro" -> só a primeira letra maiúscula, como em português.
  const todayText = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const today = todayText.charAt(0).toUpperCase() + todayText.slice(1);
  const alertCount = Number(data.maintenance) + Number(data.pendingSales > 0) + Number(data.failedCheckouts > 0);

  const cards = [
    { label: "Clientes", value: data.users, icon: Users, color: "bg-blue-50 text-blue-700", to: "/admin?tab=users" },
    { label: "Membros ativos", value: data.members, icon: Crown, color: "bg-amber-50 text-amber-700", to: "/admin?tab=members" },
    { label: "Franqueados", value: data.franchisees, icon: Store, color: "bg-emerald-50 text-emerald-700", to: "/admin?tab=franquia" },
    { label: "Administradores", value: data.administrators, icon: ShieldCheck, color: "bg-violet-50 text-violet-700", to: "/admin?tab=administrators" },
  ];

  return (
    <div className="space-y-6">
      {/* Boas-vindas com o estado da operação em uma frase. */}
      <section className="relative overflow-hidden rounded-2xl bg-[hsl(var(--admin-sidebar))] p-6 text-white sm:p-8">
        <div
          className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-[hsl(var(--admin-gold))]/15 blur-2xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(hsl(0_0%_100%/0.08)_1px,transparent_1.5px)] [background-size:18px_18px]"
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-white/65">{today}</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
              {greeting()}{firstName ? `, ${firstName}` : ""}!
            </h2>
            <p className="mt-2 flex items-center gap-2 text-sm text-white/80">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Conferindo a operação...
                </>
              ) : alertCount > 0 ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-[hsl(var(--admin-gold))]" />
                  {alertCount === 1 ? "Há 1 ponto que precisa da sua atenção." : `Há ${alertCount} pontos que precisam da sua atenção.`}
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Nenhum alerta operacional no momento.
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { to: "/admin?tab=orders", label: "Pedidos", icon: Receipt },
              { to: "/admin?tab=retirada", label: "Retirada", icon: Package },
              { to: "/admin?tab=users", label: "Clientes", icon: Users },
            ].map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/15 transition-colors hover:bg-white/20"
              >
                <Icon className="h-4 w-4 text-[hsl(var(--admin-gold))]" />
                {label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {cards.map(({ label, value, icon: Icon, color, to }) => (
          <Link key={label} to={to} className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:border-primary/30">
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between">
                  <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl", color)}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                </div>
                {loading ? (
                  <Skeleton className="mt-4 h-8 w-16" />
                ) : (
                  <p className="mt-4 text-3xl font-bold tabular-nums tracking-tight text-foreground">{value}</p>
                )}
                <p className="mt-0.5 text-sm font-medium text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {!loading && alertCount > 0 && (
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

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-4">
            <div>
              <CardTitle className="text-base">Pedidos recentes</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">Os últimos pedidos da loja</p>
            </div>
            <Link
              to="/admin?tab=orders"
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-primary transition-colors hover:bg-accent"
            >
              Ver todos <ArrowRight className="h-4 w-4" />
            </Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-3 w-1/3" />
                    </div>
                    <Skeleton className="h-5 w-20" />
                  </div>
                ))}
              </div>
            ) : data.recentOrders.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Receipt className="h-5 w-5 text-muted-foreground" />
                </span>
                <p className="text-sm text-muted-foreground">Nenhum pedido encontrado.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border/70">
                {data.recentOrders.map((order) => {
                  const status = orderStatus(order);
                  return (
                    <li key={order.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                        <Package className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {order.name} <span className="font-normal text-muted-foreground">·</span> {order.customer_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(order.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <p className="text-sm font-bold tabular-nums text-foreground">{money(order.total_price, order.currency)}</p>
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset",
                            STATUS_STYLES[status],
                          )}
                        >
                          {status}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Acesso rápido</CardTitle>
            <p className="text-xs text-muted-foreground">
              Dica: <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-sans text-[10px] font-semibold">Ctrl K</kbd> busca qualquer seção
            </p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            <QuickLink to="/admin?tab=orders" icon={Receipt} label="Pedidos" />
            <QuickLink to="/admin?tab=users" icon={Users} label="Clientes" />
            <QuickLink to="/admin?tab=values" icon={CircleDollarSign} label="Valores" />
            <QuickLink to="/admin?tab=administrators" icon={ShieldCheck} label="Administradores" />
            <QuickLink to="/admin?tab=retirada" icon={Package} label="Retirada" />
            <QuickLink to="/admin?tab=maintenance" icon={Wrench} label="Manutenção" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function QuickLink({ to, icon: Icon, label }: { to: string; icon: typeof Package; label: string }) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-2 rounded-xl border border-border/80 p-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/30 hover:bg-accent"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-primary transition-colors group-hover:bg-white">
        <Icon className="h-4 w-4" />
      </span>
      {label}
    </Link>
  );
}

function StatusLink({ to, icon: Icon, text }: { to: string; icon: typeof Package; text: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 rounded-lg bg-white/70 p-3 font-medium hover:bg-white">
      <Icon className="h-4 w-4 shrink-0" /> <span>{text}</span>
    </Link>
  );
}
