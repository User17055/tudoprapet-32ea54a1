import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ChevronRight,
  Crown,
  ExternalLink,
  LogOut,
  Mail,
  Package,
  RotateCcw,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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

const FINANCIAL_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  authorized: "Autorizado",
  partially_paid: "Parcialmente pago",
  paid: "Pago",
  partially_refunded: "Parcialmente reembolsado",
  refunded: "Reembolsado",
  voided: "Cancelado",
};

const FINANCIAL_STATUS_STYLES: Record<string, string> = {
  paid: "bg-pet-green/10 text-pet-green border-pet-green/20",
  pending: "bg-secondary/20 text-secondary-foreground border-secondary/30",
  authorized: "bg-secondary/20 text-secondary-foreground border-secondary/30",
  partially_paid: "bg-secondary/20 text-secondary-foreground border-secondary/30",
  refunded: "bg-destructive/10 text-destructive border-destructive/20",
  partially_refunded: "bg-destructive/10 text-destructive border-destructive/20",
  voided: "bg-destructive/10 text-destructive border-destructive/20",
};

const CANCELLED_BADGE = "bg-destructive/10 text-destructive border-destructive/20";

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
      to: "/catalogo",
      icon: RotateCcw,
      title: "Comprar de novo",
      description: "Voltar ao catálogo",
    },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <Header />

      <main className="flex-1">
        {/* Faixa de título no padrão do catálogo */}
        <div className="border-b border-border bg-white">
          <div className="container mx-auto py-8 md:py-10">
            <Breadcrumb className="mb-6">
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link to="/">Início</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Minha conta</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>

            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[hsl(218_70%_15%)] font-display text-xl font-bold text-white">
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate font-display font-900 text-2xl text-foreground md:text-3xl">
                      Olá, {firstName || fullName}
                    </h1>
                    {isSubscribed ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/20 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
                        <Crown className="h-3.5 w-3.5" /> Assinante
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
                        Cliente
                      </span>
                    )}
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                    <Mail className="h-4 w-4 shrink-0" />
                    {user.email}
                  </p>
                </div>
              </div>

              <Button
                variant="ghost"
                onClick={handleLogout}
                className="btn-bounce w-fit gap-2 self-start rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive sm:self-auto"
              >
                <LogOut className="h-4 w-4" /> Sair
              </Button>
            </div>
          </div>
        </div>

        <div className="container mx-auto py-8">
          {/* Resumo no padrão de Meus Pedidos */}
          <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Package className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Pedidos realizados</p>
                  <p className="font-display text-2xl font-bold">
                    {ordersLoading ? "—" : orderCount}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-pet-green/10">
                  <ShieldCheck className="h-6 w-6 text-pet-green" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status da conta</p>
                  <p className="font-display text-2xl font-bold">Ativa</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border-0 bg-gradient-to-br from-primary to-[hsl(218_70%_15%)] p-5 text-white">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20">
                  <Crown className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-xs opacity-90">Você economizou</p>
                  <p className="font-display text-2xl font-bold">
                    {ordersLoading ? "—" : formatCurrency(totalSavings)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <nav
                className="overflow-hidden rounded-xl border border-border bg-card"
                aria-label="Menu da conta"
              >
                <div className="border-b border-border px-5 py-4">
                  <h2 className="font-display font-bold text-foreground">
                    Acessos rápidos
                  </h2>
                </div>
                <div className="p-2">
                  {accountLinks.map((item) => (
                    <Link
                      key={item.title}
                      to={item.to}
                      className="group flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <item.icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-foreground">
                          {item.title}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
                    </Link>
                  ))}
                </div>
              </nav>

              {isAdmin && (
                <Button
                  asChild
                  variant="outline"
                  className="btn-bounce h-11 w-full justify-start rounded-full"
                >
                  <Link to="/admin">
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    Acessar painel admin
                  </Link>
                </Button>
              )}
            </aside>

            <section className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 md:px-6">
                <div>
                  <h2 className="font-display text-lg font-bold text-foreground">
                    Pedidos recentes
                  </h2>
                  <p className="text-sm text-muted-foreground">Suas últimas compras.</p>
                </div>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="btn-bounce shrink-0 rounded-full text-primary"
                >
                  <Link to="/meus-pedidos">Ver todos</Link>
                </Button>
              </div>

              <div className="p-4 md:p-5">
                {ordersLoading ? (
                  <div className="space-y-3">
                    {[0, 1, 2].map((item) => (
                      <div
                        key={item}
                        className="h-[72px] animate-pulse rounded-xl bg-muted/60"
                      />
                    ))}
                  </div>
                ) : orders.length === 0 ? (
                  <div className="flex flex-col items-center px-4 py-14 text-center">
                    <ShoppingBag className="h-12 w-12 text-muted-foreground" />
                    <h3 className="mt-4 font-display font-bold text-foreground">
                      Nenhum pedido ainda
                    </h3>
                    <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                      Seus pedidos aparecerão aqui depois da primeira compra.
                    </p>
                    <Button asChild className="btn-bounce mt-5 rounded-full">
                      <Link to="/catalogo">Explorar produtos</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {orders.map((order) => {
                      const isInactive =
                        Boolean(order.cancelled_at) ||
                        order.financial_status === "refunded";
                      const badgeClass = order.cancelled_at
                        ? CANCELLED_BADGE
                        : FINANCIAL_STATUS_STYLES[order.financial_status || ""] || "";
                      const badgeLabel = order.cancelled_at
                        ? "Cancelado"
                        : FINANCIAL_STATUS_LABELS[order.financial_status || ""] ||
                          "Realizado";

                      return (
                        <article
                          key={order.id}
                          className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                              <Package className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="truncate font-display text-sm font-bold text-foreground">
                                  Pedido {order.name}
                                </h3>
                                {badgeClass && (
                                  <Badge variant="outline" className={badgeClass}>
                                    {badgeLabel}
                                  </Badge>
                                )}
                              </div>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {new Date(order.created_at).toLocaleDateString("pt-BR", {
                                  day: "2-digit",
                                  month: "short",
                                  year: "numeric",
                                })}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-4 pl-[56px] sm:justify-end sm:pl-0">
                            <div className="text-right">
                              <p
                                className={`whitespace-nowrap font-display text-sm font-bold ${
                                  isInactive
                                    ? "text-muted-foreground line-through"
                                    : "text-foreground"
                                }`}
                              >
                                {formatCurrency(order.total_price, order.currency)}
                              </p>
                              {order.savings > 0 && !isInactive && (
                                <p className="text-xs text-pet-green">
                                  Economia de{" "}
                                  {formatCurrency(order.savings, order.currency)}
                                </p>
                              )}
                            </div>

                            {order.order_status_url && (
                              <a
                                href={order.order_status_url}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Acompanhar pedido ${order.name}`}
                                className="btn-bounce inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
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
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Profile;
