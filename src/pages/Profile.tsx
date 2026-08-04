import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ChevronRight,
  Crown,
  ExternalLink,
  LogOut,
  Mail,
  Package,
  PiggyBank,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface OrderSummary {
  id: number;
  name: string;
  created_at: string;
  cancelled_at: string | null;
  financial_status: string | null;
  total_price: number;
  currency: string;
  savings: number;
  order_status_url: string;
}

const formatCurrency = (value: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);

const Profile = () => {
  const { user, loading, logout } = useAuth();
  const { isSubscribed } = useSubscription();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [totalSavings, setTotalSavings] = useState(0);
  const [orderCount, setOrderCount] = useState(0);
  const [ordersLoading, setOrdersLoading] = useState(true);

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
  }, [loading, navigate, user]);

  useEffect(() => {
    if (!user) return;

    setOrdersLoading(true);
    supabase.functions.invoke("customer-orders").then(({ data, error }) => {
      if (!error && data) {
        const all = data.orders || [];
        setOrders(all.slice(0, 4));
        setOrderCount(all.length);
        setTotalSavings(data.total_savings || 0);
      }
      setOrdersLoading(false);
    });
  }, [user]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const firstName = user.user_metadata?.first_name || "";
  const lastName = user.user_metadata?.last_name || "";
  const fullName =
    `${firstName} ${lastName}`.trim() || user.email?.split("@")[0] || "Cliente";
  const initials = (
    (firstName?.[0] || user.email?.[0] || "C") + (lastName?.[0] || "")
  ).toUpperCase();

  const handleLogout = async () => {
    await logout();
    toast.success("Sessão encerrada.");
    navigate("/");
  };

  const accountLinks = [
    {
      to: "/meus-pedidos",
      icon: Package,
      title: "Meus pedidos",
      description: "Acompanhe suas compras",
    },
    {
      to: "/carrinho",
      icon: ShoppingBag,
      title: "Meu carrinho",
      description: "Continue sua compra",
    },
    {
      to: "/clube",
      icon: Crown,
      title: "Clube TudoPraPet",
      description: isSubscribed ? "Confira seus benefícios" : "Conheça e economize",
    },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <Header />

      <main className="container mx-auto max-w-6xl flex-1 px-4 py-7 md:py-10">
        <div className="mb-6">
          <p className="text-sm font-medium text-primary">Minha conta</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-foreground md:text-3xl">
            Olá, {firstName || fullName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Consulte seus pedidos e gerencie sua conta.
          </p>
        </div>

        <section className="mb-6 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center md:p-6">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
              {initials}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate font-display text-lg font-bold text-foreground">
                  {fullName}
                </h2>
                <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {isSubscribed ? "Membro do Clube" : "Cliente"}
                </span>
              </div>
              <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                <Mail className="h-4 w-4 shrink-0" />
                {user.email}
              </p>
            </div>

            {!isSubscribed && (
              <Button asChild className="w-full rounded-lg sm:w-auto">
                <Link to="/clube">
                  Conhecer o Clube
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>

          <div className="grid border-t border-border bg-muted/20 sm:grid-cols-3 sm:divide-x sm:divide-border">
            <div className="flex items-center gap-3 border-b border-border px-5 py-4 sm:border-b-0">
              <Package className="h-5 w-5 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Pedidos realizados</p>
                <p className="font-semibold text-foreground">
                  {ordersLoading ? "—" : orderCount}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 border-b border-border px-5 py-4 sm:border-b-0">
              <PiggyBank className="h-5 w-5 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Economia no Clube</p>
                <p className="font-semibold text-foreground">
                  {ordersLoading ? "—" : formatCurrency(totalSavings)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 px-5 py-4">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <div>
                <p className="text-xs text-muted-foreground">Status da conta</p>
                <p className="font-semibold text-foreground">Ativa e protegida</p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <nav className="overflow-hidden rounded-2xl border border-border bg-card" aria-label="Menu da conta">
              <div className="border-b border-border px-5 py-4">
                <h2 className="font-display font-semibold text-foreground">Acessos rápidos</h2>
              </div>
              <div className="p-2">
                {accountLinks.map((item) => (
                  <Link
                    key={item.title}
                    to={item.to}
                    className="group flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-muted/60"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <item.icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">{item.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                  </Link>
                ))}
              </div>
            </nav>

            {isAdmin && (
              <Button asChild variant="outline" className="h-11 w-full justify-start rounded-xl">
                <Link to="/admin">
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Acessar painel admin
                </Link>
              </Button>
            )}

            <Button
              variant="ghost"
              onClick={handleLogout}
              className="h-11 w-full justify-start rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sair da conta
            </Button>
          </aside>

          <section className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 md:px-6">
              <div>
                <h2 className="font-display text-lg font-semibold text-foreground">Pedidos recentes</h2>
                <p className="text-sm text-muted-foreground">Suas últimas compras.</p>
              </div>
              <Button asChild variant="ghost" size="sm" className="shrink-0 text-primary">
                <Link to="/meus-pedidos">Ver todos</Link>
              </Button>
            </div>

            <div className="p-4 md:p-5">
              {ordersLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((item) => (
                    <div key={item} className="h-[72px] animate-pulse rounded-xl bg-muted/60" />
                  ))}
                </div>
              ) : orders.length === 0 ? (
                <div className="flex flex-col items-center px-4 py-12 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                    <ShoppingBag className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <h3 className="mt-4 font-semibold text-foreground">Nenhum pedido ainda</h3>
                  <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                    Seus pedidos aparecerão aqui depois da primeira compra.
                  </p>
                  <Button asChild className="mt-5 rounded-lg">
                    <Link to="/catalogo">Explorar produtos</Link>
                  </Button>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {orders.map((order) => {
                    const isInactive =
                      Boolean(order.cancelled_at) || order.financial_status === "refunded";
                    const status = order.cancelled_at
                      ? "Cancelado"
                      : order.financial_status === "refunded"
                        ? "Reembolsado"
                        : order.financial_status === "partially_refunded"
                          ? "Parcialmente reembolsado"
                          : "Pedido realizado";

                    return (
                      <article
                        key={order.id}
                        className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Package className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold text-foreground">
                              Pedido {order.name}
                            </h3>
                            <p className="text-xs text-muted-foreground">
                              {new Date(order.created_at).toLocaleDateString("pt-BR", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              })}
                              <span className="px-1.5">•</span>
                              {status}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-4 pl-[52px] sm:justify-end sm:pl-0">
                          <div className="text-right">
                            <p className={`whitespace-nowrap text-sm font-semibold ${isInactive ? "text-muted-foreground line-through" : "text-foreground"}`}>
                              {formatCurrency(order.total_price, order.currency)}
                            </p>
                            {order.savings > 0 && !isInactive && (
                              <p className="text-xs text-muted-foreground">
                                Economia de {formatCurrency(order.savings, order.currency)}
                              </p>
                            )}
                          </div>

                          {order.order_status_url && (
                            <a
                              href={order.order_status_url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Acompanhar pedido ${order.name}`}
                              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-primary hover:text-primary"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Profile;
