import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Package, PiggyBank, ExternalLink, Crown, Wallet, Store, ArrowRight } from 'lucide-react';
import logo from '@/assets/tpp-logo.svg';
import { useIsFranchisee } from '@/hooks/useIsFranchisee';
import { FranchiseOpenOrderCard } from '@/components/FranchiseOpenOrderCard';
import { SaleDocuments } from '@/components/SaleDocuments';
import { formatDate, formatMoney, situationState, TONE_CLASSES, type SaleInvoice, type SaleOrder } from '@/lib/saleOrders';

interface OrderLine {
  title: string;
  variant_title: string | null;
  quantity: number;
  price: number;
  compare_at_price: number | null;
  image: string | null;
  savings: number;
}

interface Order {
  id: number;
  order_number: number | string;
  name: string;
  created_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  total_price: number;
  currency: string;
  financial_status: string;
  fulfillment_status: string | null;
  order_status_url: string;
  savings: number;
  sale_order_number?: string | null;
  invoice?: SaleInvoice | null;
  line_items: OrderLine[];
}


interface OrdersResponse {
  orders: Order[];
  total_savings: number;
  total_spent: number;
  count: number;
}

const formatCurrency = (n: number, currency = 'BRL') =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(n);

const FINANCIAL_STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  authorized: 'Autorizado',
  partially_paid: 'Parcialmente pago',
  paid: 'Pago',
  partially_refunded: 'Parcialmente reembolsado',
  refunded: 'Reembolsado',
  voided: 'Cancelado',
};

const FINANCIAL_STATUS_STYLES: Record<string, string> = {
  paid: 'bg-pet-green/10 text-pet-green border-pet-green/20',
  pending: 'bg-secondary/20 text-secondary-foreground border-secondary/30',
  authorized: 'bg-secondary/20 text-secondary-foreground border-secondary/30',
  partially_paid: 'bg-secondary/20 text-secondary-foreground border-secondary/30',
  refunded: 'bg-destructive/10 text-destructive border-destructive/20',
  partially_refunded: 'bg-destructive/10 text-destructive border-destructive/20',
  voided: 'bg-destructive/10 text-destructive border-destructive/20',
};

const CANCELLED_BADGE = 'bg-destructive/10 text-destructive border-destructive/20';


const MeusPedidos = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { isFranchisee } = useIsFranchisee();
  // Compras lançadas pela equipe direto no pedido de venda (loja/presencial).
  const [storeOrders, setStoreOrders] = useState<SaleOrder[]>([]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/login');
      return;
    }

    const load = async () => {
      // Falha nas compras da loja não esconde os pedidos do site.
      void supabase.functions.invoke('sales-orders').then(({ data: sales }) => {
        const list = Array.isArray(sales?.orders) ? (sales.orders as SaleOrder[]) : [];
        setStoreOrders(list.filter((order) => order.origin === 'olist'));
      }).catch(() => setStoreOrders([]));
      try {
        const { data, error } = await supabase.functions.invoke('customer-orders');
        if (error) throw error;
        setData(data as OrdersResponse);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao buscar pedidos');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, authLoading, navigate]);

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="TudoPraPet" className="h-auto w-44" />
          </Link>
          <Button variant="ghost" size="sm" onClick={() => navigate('/perfil')} className="btn-bounce gap-2">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="font-display font-900 text-3xl text-foreground">Meus Pedidos</h1>
          <p className="text-muted-foreground">Veja seu histórico e quanto você economizou.</p>
        </div>

        <FranchiseOpenOrderCard enabled={isFranchisee} />

        {isFranchisee && (
          <Link
            to="/franquia/pedidos"
            className="flex items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm font-semibold text-primary hover:bg-primary/10"
          >
            <span className="flex items-center gap-2"><Store className="h-4 w-4" /> Ver todos os pedidos da franquia, com nota fiscal e boleto</span>
            <ArrowRight className="h-4 w-4 shrink-0" />
          </Link>
        )}

        {loading && (
          <div className="flex justify-center py-16">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        )}

        {!loading && error && (
          <Card><CardContent className="py-8 text-center text-destructive">{error}</CardContent></Card>
        )}

        {!loading && data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-5 flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Package className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Pedidos</p>
                    <p className="font-display font-bold text-2xl">{data.count}</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5 flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-secondary/10 flex items-center justify-center">
                    <Wallet className="h-6 w-6 text-secondary-foreground" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total gasto</p>
                    <p className="font-display font-bold text-2xl">{formatCurrency(data.total_spent)}</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-primary to-[hsl(218_70%_15%)] text-white border-0">
                <CardContent className="p-5 flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
                    <Crown className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <p className="text-xs opacity-90">Você economizou</p>
                    <p className="font-display font-bold text-2xl">{formatCurrency(data.total_savings)}</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {data.orders.length === 0 ? (
              <Card>
                <CardContent className="py-16 text-center space-y-3">
                  <Package className="h-12 w-12 text-muted-foreground mx-auto" />
                  <p className="text-muted-foreground">Você ainda não tem pedidos.</p>
                  <Button className="btn-bounce" onClick={() => navigate('/catalogo')}>Ver catálogo</Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {data.orders.map((order) => (
                  <Card key={order.id}>
                    <CardContent className="p-5 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-display font-bold text-lg">Pedido {order.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(order.created_at).toLocaleDateString('pt-BR', {
                              day: '2-digit', month: 'short', year: 'numeric',
                            })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {order.cancelled_at ? (
                            <Badge variant="outline" className={CANCELLED_BADGE}>
                              Cancelado
                            </Badge>
                          ) : order.financial_status === 'refunded' ? (
                            <Badge variant="outline" className={CANCELLED_BADGE}>
                              Reembolsado
                            </Badge>
                          ) : order.financial_status === 'partially_refunded' ? (
                            <Badge variant="outline" className={CANCELLED_BADGE}>
                              Parcialmente reembolsado
                            </Badge>
                          ) : order.financial_status ? (
                            <Badge
                              variant="outline"
                              className={FINANCIAL_STATUS_STYLES[order.financial_status] || ''}
                            >
                              {FINANCIAL_STATUS_LABELS[order.financial_status] || order.financial_status}
                            </Badge>
                          ) : null}

                          {order.order_status_url && (
                            <a href={order.order_status_url} target="_blank" rel="noreferrer">
                              <Button size="sm" variant="outline" className="btn-bounce gap-1">
                                <ExternalLink className="h-3 w-3" /> Detalhes
                              </Button>
                            </a>
                          )}
                        </div>
                      </div>

                      {!order.cancelled_at && (order.sale_order_number || order.invoice) && (
                        <SaleDocuments saleOrderNumber={order.sale_order_number ?? null} invoice={order.invoice ?? null} />
                      )}

                      <div className="space-y-2">
                        {order.line_items.map((li, i) => (
                          <div key={i} className="flex items-center gap-3 text-sm">
                            {li.image && (
                              <img src={li.image} alt={li.title} className="h-12 w-12 rounded-md object-cover bg-muted" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{li.title}</p>
                              {li.variant_title && (
                                <p className="text-xs text-muted-foreground truncate">{li.variant_title}</p>
                              )}
                            </div>
                            <p className="text-muted-foreground">x{li.quantity}</p>
                            <p className="font-semibold w-20 text-right">
                              {formatCurrency(li.price * li.quantity, order.currency)}
                            </p>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between border-t border-border pt-3">
                        {order.savings > 0 ? (
                          <div className="flex items-center gap-2 text-sky-500">
                            <PiggyBank className="h-4 w-4" />
                            <span className="text-sm font-bold">
                              Economia: {formatCurrency(order.savings, order.currency)}
                            </span>
                          </div>
                        ) : <div />}
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Total</p>
                          <p className="font-display font-bold text-lg">
                            {formatCurrency(order.total_price, order.currency)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {!loading && storeOrders.length > 0 && (
          <section className="space-y-4" aria-labelledby="compras-na-loja">
            <div>
              <h2 id="compras-na-loja" className="font-display font-bold text-xl text-foreground">Compras na loja</h2>
              <p className="text-sm text-muted-foreground">Pedidos lançados pela nossa equipe no seu CPF ou CNPJ.</p>
            </div>
            {storeOrders.map((order) => {
              const situation = situationState(order.situation);
              return (
                <Card key={order.id}>
                  <CardContent className="p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-display font-bold text-lg">
                          {order.saleOrderNumber ? `Pedido ${order.saleOrderNumber}` : 'Pedido na loja'}
                        </p>
                        <p className="text-xs text-muted-foreground">{formatDate(order.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className={TONE_CLASSES[situation.tone]}>{situation.label}</Badge>
                        <p className="font-display font-bold text-lg">{formatMoney(order.total, order.currency)}</p>
                      </div>
                    </div>
                    <SaleDocuments saleOrderNumber={order.saleOrderNumber} invoice={order.invoice} />
                    {order.items.length > 0 && (
                      <ul className="space-y-1 border-t border-border pt-3 text-sm">
                        {order.items.map((item, index) => (
                          <li key={index} className="flex items-center gap-3">
                            <span className="flex-1 min-w-0 truncate">{item.title}</span>
                            <span className="text-muted-foreground">x{item.quantity}</span>
                            <span className="w-20 text-right font-semibold">{formatMoney(item.unitPrice * item.quantity, order.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </section>
        )}
      </main>
    </div>
  );
};

export default MeusPedidos;
