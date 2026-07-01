import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Crown,
  ExternalLink,
  Heart,
  LogOut,
  Mail,
  Package,
  PiggyBank,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface OrderSummary {
  id: number;
  name: string;
  created_at: string;
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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-primary border-t-transparent" />
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

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <Header />

      <main className="container mx-auto flex-1 px-4 py-5 md:py-8">
        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-background to-background p-5 shadow-sm md:p-6">
            <div className="paw-pattern pointer-events-none absolute inset-0" />
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[hsl(218_58%_20%)] text-2xl font-900 text-primary-foreground shadow-md">
                {initials}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-primary">Minha conta</p>
                <h1 className="mt-1 truncate font-display text-2xl font-900 text-foreground md:text-3xl">
                  Olá, {fullName}
                </h1>
                <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
                  <Mail className="h-4 w-4 shrink-0" />
                  {user.email}
                </p>
              </div>

              <div className="flex gap-2 sm:flex-col sm:items-end">
                {isSubscribed ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-3 py-1.5 text-xs font-bold text-white">
                    <Crown className="h-4 w-4" />
                    Clube ativo
                  </span>
                ) : (
                  <Button asChild className="rounded-full gap-2 btn-bounce">
                    <Link to="/clube">
                      <Sparkles className="h-4 w-4" />
                      Entrar no Clube
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3 shadow-sm sm:p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <PiggyBank className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Economia</p>
                <p className="truncate font-display text-base font-900 text-foreground">
                  {ordersLoading ? "..." : formatCurrency(totalSavings)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3 shadow-sm sm:p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Package className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Pedidos</p>
                <p className="truncate font-display text-base font-900 text-foreground">
                  {ordersLoading ? "..." : orderCount}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3 shadow-sm sm:p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Heart className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Status</p>
                <p className="truncate font-display text-base font-900 text-foreground">
                  {isSubscribed ? "Clube" : "Cliente"}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              to: "/meus-pedidos",
              icon: Package,
              title: "Meus pedidos",
              text: "Acompanhar compras",
            },
            {
              to: "/carrinho",
              icon: ShoppingBag,
              title: "Carrinho",
              text: "Finalizar produtos",
            },
            {
              to: "/catalogo",
              icon: ArrowRight,
              title: "Comprar de novo",
              text: "Voltar ao catálogo",
            },
            {
              to: "/clube",
              icon: Crown,
              title: "Clube TudoPraPet",
              text: isSubscribed ? "Ver benefícios" : "Assinar e economizar",
            },
          ].map((item) => (
            <Link
              key={item.title}
              to={item.to}
              className="group btn-bounce rounded-2xl border border-border bg-background p-4 shadow-sm transition hover:border-primary/50 hover:shadow-md"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                <item.icon className="h-5 w-5" />
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-sm font-bold text-foreground">
                    {item.title}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">{item.text}</p>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" />
              </div>
            </Link>
          ))}
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-border p-4 md:p-5">
              <div>
                <h2 className="font-display text-lg font-bold text-foreground">
                  Pedidos recentes
                </h2>
                <p className="text-sm text-muted-foreground">
                  Últimas compras feitas com sua conta.
                </p>
              </div>
              <Button asChild variant="ghost" className="rounded-full btn-bounce text-primary">
                <Link to="/meus-pedidos">Ver todos</Link>
              </Button>
            </div>

            <div className="p-3 md:p-4">
              {ordersLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((item) => (
                    <div
                      key={item}
                      className="h-20 animate-pulse rounded-xl bg-muted/60"
                    />
                  ))}
                </div>
              ) : orders.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                    <ShoppingBag className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <h3 className="font-display font-bold text-foreground">
                    Nenhum pedido ainda
                  </h3>
                  <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                    Quando você fizer uma compra, ela aparece aqui para acompanhar
                    com facilidade.
                  </p>
                  <Button asChild className="mt-4 rounded-full btn-bounce">
                    <Link to="/catalogo">Explorar produtos</Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {orders.map((order) => (
                    <article
                      key={order.id}
                      className="grid grid-cols-[1fr_auto] gap-3 rounded-xl border border-border p-3 transition hover:border-primary/40 hover:bg-muted/30 sm:grid-cols-[1fr_auto_auto] sm:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Package className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-bold text-foreground">
                            Pedido {order.name}
                          </h3>
                          <p className="text-xs text-muted-foreground">
                            {new Date(order.created_at).toLocaleDateString("pt-BR", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                            })}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="whitespace-nowrap font-display text-sm font-bold text-foreground">
                          {formatCurrency(order.total_price, order.currency)}
                        </p>
                        {order.savings > 0 && (
                          <p className="text-xs font-semibold text-sky-500">
                            -{formatCurrency(order.savings, order.currency)}
                          </p>
                        )}
                      </div>

                      {order.order_status_url && (
                        <a
                          href={order.order_status_url}
                          target="_blank"
                          rel="noreferrer"
                          className="col-span-2 inline-flex items-center justify-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs font-bold text-foreground transition hover:bg-primary hover:text-primary-foreground sm:col-span-1"
                        >
                          Acompanhar
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <UserIcon className="h-5 w-5" />
              </div>
              <h2 className="font-display text-lg font-bold text-foreground">
                Dados da conta
              </h2>
              <div className="mt-4 space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Nome</p>
                  <p className="font-semibold text-foreground">{fullName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="break-all font-semibold text-foreground">
                    {user.email}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-background p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pet-green/10 text-pet-green">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-display text-base font-bold text-foreground">
                    Conta protegida
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Sua sessão está autenticada pela área segura da TudoPraPet.
                  </p>
                </div>
              </div>
            </div>

            <Button
              variant="outline"
              onClick={handleLogout}
              className="h-12 w-full rounded-xl border-destructive/30 btn-bounce text-destructive hover:bg-destructive hover:text-destructive-foreground"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sair da conta
            </Button>
          </aside>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Profile;
