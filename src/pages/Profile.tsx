import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { LogOut, User, Package, PiggyBank, ChevronRight, ExternalLink } from 'lucide-react';
import logo from '@/assets/logo.png';

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
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [totalSavings, setTotalSavings] = useState(0);
  const [ordersLoading, setOrdersLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase.functions.invoke('customer-orders').then(({ data, error }) => {
      if (!error && data) {
        setOrders((data.orders || []).slice(0, 3));
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

  const handleLogout = async () => {
    await logout();
    toast.success('Até logo! 👋');
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center">
          <Link to="/">
            <img src={logo} alt="TudoPraPet" className="h-16 mx-auto mb-4" />
          </Link>
          <h1 className="font-display font-900 text-2xl text-foreground">Meu Perfil</h1>
        </div>

        <div className="bg-card rounded-2xl shadow-lg border border-border p-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="font-display font-bold text-lg text-foreground">
                {firstName} {lastName}
              </p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
        </div>

        {/* Economia + Pedidos recentes */}
        <div className="bg-card rounded-2xl shadow-lg border border-border overflow-hidden">
          <div className="bg-gradient-to-r from-primary to-[#2d5499] p-5 text-white flex items-center justify-between">
            <div className="flex items-center gap-3">
              <PiggyBank className="h-7 w-7" />
              <div>
                <p className="text-xs opacity-90">Você já economizou</p>
                <p className="font-display font-bold text-2xl">
                  {ordersLoading ? '...' : formatCurrency(totalSavings)}
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/meus-pedidos')}
              className="gap-1"
            >
              Ver tudo <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <div className="p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Package className="h-4 w-4" /> Últimos pedidos
            </div>
            {ordersLoading ? (
              <p className="text-sm text-muted-foreground">Carregando...</p>
            ) : orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum pedido ainda.</p>
            ) : (
              <div className="space-y-2">
                {orders.map((o) => (
                  <div
                    key={o.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/40 transition"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate">Pedido {o.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(o.created_at).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-sm">{formatCurrency(o.total_price, o.currency)}</p>
                      {o.savings > 0 && (
                        <p className="text-xs text-sky-500 font-semibold">
                          -{formatCurrency(o.savings, o.currency)}
                        </p>
                      )}
                    </div>
                    {o.order_status_url && (
                      <a href={o.order_status_url} target="_blank" rel="noreferrer" className="ml-2">
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <Button onClick={handleLogout} variant="outline" className="w-full rounded-xl gap-2">
          <LogOut className="h-4 w-4" /> Sair da conta
        </Button>

        <div className="text-center">
          <Link to="/" className="text-sm text-primary font-semibold hover:underline">
            ← Voltar à loja
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Profile;
