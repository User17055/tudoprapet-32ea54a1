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
  PawPrint,
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
    <div className="flex min-h-screen flex-col bg-[#f4f6f2]">
      <Header />

      <main className="container mx-auto max-w-6xl flex-1 px-4 py-5 md:py-8">
        <section className="grid overflow-hidden rounded-[32px] bg-gradient-to-br from-primary via-[#17386f] to-[#0d224b] shadow-[0_28px_60px_-38px_rgba(11,31,68,0.95)] lg:grid-cols-[1.25fr_0.75fr]">
          <div className="relative overflow-hidden p-6 md:p-8">
            <div className="paw-pattern pointer-events-none absolute inset-0" />
            <PawPrint className="pointer-events-none absolute -bottom-9 -right-5 h-36 w-36 rotate-[-18deg] text-white/[0.04]" />
            <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-secondary text-2xl font-900 text-secondary-foreground shadow-[0_14px_30px_-18px_rgba(246,199,72,0.95)]">
                {initials}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-secondary">Minha conta TudoPraPet</p>
                <h1 className="mt-1 truncate font-display text-2xl font-900 text-white md:text-3xl">
                  Olá, {fullName}
                </h1>
                <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-white/60">
                  <Mail className="h-4 w-4 shrink-0" />
                  {user.email}
                </p>
              </div>

              <div className="flex gap-2 sm:flex-col sm:items-end">
                {isSubscribed && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-3 py-1.5 text-xs font-bold text-white">
                    <Crown className="h-4 w-4" />
                    Assinante
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-px border-t border-white/10 bg-white/10 p-4 sm:grid-cols-3 lg:grid-cols-1 lg:border-l lg:border-t-0 lg:p-5">
            <div className="flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-white/[0.06] sm:p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
                <PiggyBank className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-white/50">Economia no Clube</p>
                <p className="truncate font-display text-base font-900 text-white">
                  {ordersLoading ? "..." : formatCurrency(totalSavings)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-white/[0.06] sm:p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-400/15 text-sky-300">
                <Package className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-white/50">Pedidos feitos</p>
                <p className="truncate font-display text-base font-900 text-white">
                  {ordersLoading ? "..." : orderCount}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-white/[0.06] sm:p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pet-green/15 text-emerald-300">
                <Heart className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-white/50">Seu status</p>
                <p className="truncate font-display text-base font-900 text-white">
                  {isSubscribed ? "Clube" : "Cliente"}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-5 grid gap-2 rounded-[28px] border border-primary/5 bg-white p-3 shadow-[0_18px_46px_-38px_rgba(16,24,40,0.8)] sm:grid-cols-2 md:p-4 lg:grid-cols-4">
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
              className="group btn-bounce rounded-2xl border border-transparent bg-[#f7f8f3] p-4 transition hover:border-primary/15 hover:bg-primary/[0.04]"
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

        <section className="mt-5 grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="overflow-hidden rounded-[28px] border border-primary/5 bg-background shadow-[0_18px_46px_-38px_rgba(16,24,40,0.8)]">
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
                          {(order.cancelled_at || order.financial_status === "refunded" || order.financial_status === "partially_refunded") && (
                            <span className="mt-1 inline-flex items-center rounded-full border border-destructive/20 bg-destructive/10 px-2 py-0.5 text-[10px] font-bold text-destructive">
                              {order.cancelled_at
                                ? "Cancelado"
                                : order.financial_status === "refunded"
                                ? "Reembolsado"
                                : "Parc. reembolsado"}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <p className={`whitespace-nowrap font-display text-sm font-bold ${order.cancelled_at || order.financial_status === "refunded" ? "text-muted-foreground line-through" : "text-foreground"}`}>
                          {formatCurrency(order.total_price, order.currency)}
                        </p>
                        {order.savings > 0 && !order.cancelled_at && order.financial_status !== "refunded" && (
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

          <aside className="space-y-3 rounded-[28px] border border-primary/5 bg-white p-4 shadow-[0_18px_46px_-38px_rgba(16,24,40,0.8)]">
            <div className="rounded-2xl bg-[#f7f8f3] p-5">
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

            <div className="rounded-2xl bg-pet-green/5 p-5">
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

            {isAdmin && (
              <Button
                asChild
                className="h-12 w-full rounded-xl btn-bounce bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Link to="/admin">
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  Acessar painel admin
                </Link>
              </Button>
            )}

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
