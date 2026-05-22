import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { supabase } from '@/integrations/supabase/client';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { toast } from 'sonner';
import {
  LogOut,
  User as UserIcon,
  Package,
  PiggyBank,
  ChevronRight,
  ExternalLink,
  Crown,
  ShoppingBag,
  Heart,
  Sparkles,
} from 'lucide-react';

interface OrderSummary {
  id: number;
  name: string;
  created_at: string;
  total_price: number;
  currency: string;
  savings: number;
  order_status_url: string;
}

const formatCurrency = (n: number, currency = 'BRL') =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(n);

const Profile = () => {
  const { user, loading, logout } = useAuth();
  const { isSubscribed } = useSubscription();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [totalSavings, setTotalSavings] = useState(0);
  const [orderCount, setOrderCount] = useState(0);
  const [ordersLoading, setOrdersLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase.functions.invoke('customer-orders').then(({ data, error }) => {
      if (!error && data) {
        const all = data.orders || [];
        setOrders(all.slice(0, 4));
        setOrderCount(all.length);
        setTotalSavings(data.total_savings || 0);
      }
      setOrdersLoading(false);
    });
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) {
    navigate('/login');
    return null;
  }

  const firstName = user.user_metadata?.first_name || '';
  const lastName = user.user_metadata?.last_name || '';
  const fullName = `${firstName} ${lastName}`.trim() || user.email?.split('@')[0] || 'Cliente';
  const initials =
    (firstName?.[0] || user.email?.[0] || 'C').toUpperCase() + (lastName?.[0]?.toUpperCase() || '');

  const handleLogout = async () => {
    await logout();
    toast.success('Até logo! 👋');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-6 md:py-10">
        {/* Hero do perfil */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-[#2d5499] text-primary-foreground p-6 md:p-8 shadow-xl">
          <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-secondary/20 blur-2xl" aria-hidden />
          <div className="absolute -left-10 -bottom-12 h-40 w-40 rounded-full bg-white/10 blur-2xl" aria-hidden />

          <div className="relative flex flex-col md:flex-row md:items-center gap-5 md:gap-6">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 md:h-20 md:w-20 rounded-2xl bg-white/15 border border-white/30 backdrop-blur flex items-center justify-center text-2xl md:text-3xl font-display font-900 shadow-lg">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-xs md:text-sm opacity-90">Olá, bem-vindo de volta 🐾</p>
                <h1 className="font-display font-900 text-2xl md:text-3xl leading-tight truncate">
                  {fullName}
                </h1>
                <p className="text-xs md:text-sm opacity-90 truncate">{user.email}</p>
              </div>
            </div>

            <div className="md:ml-auto flex flex-wrap gap-2">
              {isSubscribed ? (
                <span className="inline-flex items-center gap-1.5 bg-secondary text-secondary-foreground font-bold text-xs px-3 py-1.5 rounded-full shadow">
                  <Crown className="h-3.5 w-3.5" /> Membro do Clube
                </span>
              ) : (
                <Link
                  to="/clube"
                  className="inline-flex items-center gap-1.5 bg-secondary text-secondary-foreground hover:scale-105 transition font-bold text-xs px-3 py-1.5 rounded-full shadow"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Entrar no Clube
                </Link>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="relative mt-6 grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="bg-white/10 backdrop-blur rounded-2xl p-4 border border-white/15">
              <div className="flex items-center gap-2 opacity-90 text-xs"><PiggyBank className="h-4 w-4" /> Economizou</div>
              <p className="font-display font-900 text-xl md:text-2xl mt-1 tabular-nums">
                {ordersLoading ? '...' : formatCurrency(totalSavings)}
              </p>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-2xl p-4 border border-white/15">
              <div className="flex items-center gap-2 opacity-90 text-xs"><Package className="h-4 w-4" /> Pedidos</div>
              <p className="font-display font-900 text-xl md:text-2xl mt-1 tabular-nums">
                {ordersLoading ? '...' : orderCount}
              </p>
            </div>
            <div className="col-span-2 md:col-span-1 bg-white/10 backdrop-blur rounded-2xl p-4 border border-white/15">
              <div className="flex items-center gap-2 opacity-90 text-xs"><Heart className="h-4 w-4" /> Status</div>
              <p className="font-display font-900 text-xl md:text-2xl mt-1">
                {isSubscribed ? 'Clube ativo' : 'Cliente'}
              </p>
            </div>
          </div>
        </section>

        {/* Atalhos rápidos */}
        <section className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Link
            to="/meus-pedidos"
            className="group bg-card border border-border rounded-2xl p-4 hover:border-primary hover:shadow-md transition flex flex-col items-start gap-2"
          >
            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Package className="h-5 w-5" />
            </div>
            <p className="font-display font-bold text-sm">Meus pedidos</p>
            <p className="text-xs text-muted-foreground">Acompanhar entregas</p>
          </Link>

          <Link
            to="/catalogo"
            className="group bg-card border border-border rounded-2xl p-4 hover:border-primary hover:shadow-md transition flex flex-col items-start gap-2"
          >
            <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <p className="font-display font-bold text-sm">Continuar comprando</p>
            <p className="text-xs text-muted-foreground">Voltar ao catálogo</p>
          </Link>

          <Link
            to="/clube"
            className="group bg-card border border-border rounded-2xl p-4 hover:border-primary hover:shadow-md transition flex flex-col items-start gap-2"
          >
            <div className="h-10 w-10 rounded-xl bg-secondary/20 text-secondary-foreground flex items-center justify-center">
              <Crown className="h-5 w-5" />
            </div>
            <p className="font-display font-bold text-sm">Clube TudoPraPet</p>
            <p className="text-xs text-muted-foreground">
              {isSubscribed ? 'Ver benefícios' : 'Economize com assinatura'}
            </p>
          </Link>

          <button
            onClick={handleLogout}
            className="group bg-card border border-border rounded-2xl p-4 hover:border-destructive hover:shadow-md transition flex flex-col items-start gap-2 text-left"
          >
            <div className="h-10 w-10 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center">
              <LogOut className="h-5 w-5" />
            </div>
            <p className="font-display font-bold text-sm">Sair</p>
            <p className="text-xs text-muted-foreground">Encerrar sessão</p>
          </button>
        </section>

        {/* Pedidos recentes */}
        <section className="mt-6 bg-card rounded-3xl shadow-sm border border-border overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-border">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <h2 className="font-display font-bold text-lg">Pedidos recentes</h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/meus-pedidos')}
              className="gap-1 text-primary hover:text-primary"
            >
              Ver todos <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="p-3 md:p-5">
            {ordersLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-16 rounded-xl bg-muted/40 animate-pulse" />
                ))}
              </div>
            ) : orders.length === 0 ? (
              <div className="text-center py-10">
                <div className="mx-auto h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-3">
                  <ShoppingBag className="h-7 w-7 text-muted-foreground" />
                </div>
                <p className="font-display font-bold text-foreground">Nenhum pedido ainda</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Que tal mimar seu pet hoje?
                </p>
                <Button onClick={() => navigate('/catalogo')} className="rounded-xl">
                  Explorar produtos
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {orders.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between gap-3 p-3 md:p-4 rounded-2xl border border-border hover:border-primary/40 hover:bg-muted/30 transition"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Package className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate">Pedido {o.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(o.created_at).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-display font-bold text-sm tabular-nums">
                        {formatCurrency(o.total_price, o.currency)}
                      </p>
                      {o.savings > 0 && (
                        <p className="text-[11px] text-sky-500 font-semibold tabular-nums">
                          -{formatCurrency(o.savings, o.currency)}
                        </p>
                      )}
                    </div>
                    {o.order_status_url && (
                      <a
                        href={o.order_status_url}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition shrink-0"
                        aria-label="Acompanhar pedido"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Profile;
