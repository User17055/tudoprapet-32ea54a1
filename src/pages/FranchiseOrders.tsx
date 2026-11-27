import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, CalendarDays, ExternalLink, Loader2, Package, RefreshCw, Store, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { SaleDocuments } from "@/components/SaleDocuments";
import { useAuth } from "@/contexts/AuthContext";
import { useIsFranchisee } from "@/hooks/useIsFranchisee";
import { supabase } from "@/integrations/supabase/client";
import {
  formatDate,
  formatDueDate,
  formatMoney,
  paymentState,
  situationState,
  TONE_CLASSES,
  type SaleOrder,
} from "@/lib/saleOrders";
import { cn } from "@/lib/utils";

type OriginFilter = "all" | "site" | "olist";

const FILTERS: Array<{ value: OriginFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "site", label: "Site" },
  { value: "olist", label: "Pedido de venda" },
];

export default function FranchiseOrders() {
  const { user, loading: authLoading } = useAuth();
  const { isFranchisee, loading: franchiseLoading } = useIsFranchisee();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<SaleOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<OriginFilter>("all");
  const [reviews, setReviews] = useState<PriceReview[]>([]);

  const load = useCallback(async () => {
    if (!user || !isFranchisee) return;
    setLoading(true);
    setError("");
    // Revisões de preço são um extra: falha aqui não esconde os pedidos.
    void supabase.functions.invoke("franchise-price-review", { body: { action: "mine" } })
      .then(({ data }) => setReviews(Array.isArray(data?.reviews) ? data.reviews : []))
      .catch(() => setReviews([]));
    const { data, error: requestError } = await supabase.functions.invoke("sales-orders");
    if (requestError || data?.error) {
      setError(data?.error || "Não foi possível carregar seus pedidos.");
    } else {
      setOrders(Array.isArray(data?.orders) ? data.orders : []);
    }
    setLoading(false);
  }, [isFranchisee, user]);

  useEffect(() => {
    if (authLoading || franchiseLoading) return;
    if (!user) return void navigate("/login", { replace: true });
    if (!isFranchisee) return void navigate("/meus-pedidos", { replace: true });
    void load();
  }, [authLoading, franchiseLoading, isFranchisee, load, navigate, user]);

  const visible = useMemo(
    () => (filter === "all" ? orders : orders.filter((order) => order.origin === filter)),
    [filter, orders],
  );

  if (authLoading || franchiseLoading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <Header />
      <main className="container mx-auto flex-1 py-6 sm:py-10">
        <div className="mx-auto max-w-5xl">
          <Button variant="ghost" className="mb-4 -ml-3" asChild>
            <Link to="/perfil"><ArrowLeft className="mr-2 h-4 w-4" />Minha conta</Link>
          </Button>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-wider text-primary">Franquia</p>
              <h1 className="mt-1 font-display text-3xl font-black text-foreground">Pedidos</h1>
              <p className="mt-2 text-muted-foreground">
                Todos os seus pedidos, do site e da loja, com pedido de venda, nota fiscal e boleto.
              </p>
            </div>
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Atualizar
            </Button>
          </div>

          {reviews.length > 0 && <PriceReviewList reviews={reviews} />}

          <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Origem do pedido">
            {FILTERS.map(({ value, label }) => (
              <Button
                key={value}
                role="tab"
                aria-selected={filter === value}
                size="sm"
                variant={filter === value ? "default" : "outline"}
                className="rounded-full"
                onClick={() => setFilter(value)}
              >
                {label}
                <span className="ml-1.5 tabular-nums opacity-70">
                  {value === "all" ? orders.length : orders.filter((order) => order.origin === value).length}
                </span>
              </Button>
            ))}
          </div>

          {error && (
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="mt-6 space-y-3">{[0, 1, 2].map((item) => <div key={item} className="h-40 animate-pulse rounded-xl bg-muted" />)}</div>
          ) : visible.length === 0 ? (
            <Card className="mt-6 border-dashed"><CardContent className="flex flex-col items-center py-14 text-center">
              <Package className="h-12 w-12 text-muted-foreground" />
              <h2 className="mt-4 text-lg font-bold">Nenhum pedido encontrado</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Os pedidos feitos no site e os lançados pela nossa equipe aparecerão aqui.
              </p>
              <Button className="mt-5" asChild><Link to="/catalogo">Ir ao catálogo</Link></Button>
            </CardContent></Card>
          ) : (
            <div className="mt-6 grid gap-4">
              {visible.map((order) => <FranchiseOrderCard key={`${order.origin}-${order.id}`} order={order} />)}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

interface PriceReview {
  id: string;
  variantId: string;
  title: string | null;
  status: "blocked" | "requested" | "approved" | "changed" | "rejected";
  price: number | null;
  note: string | null;
  requestedAt: string;
  decidedAt: string | null;
}

const REVIEW_STATES: Record<PriceReview["status"], { label: string; tone: keyof typeof TONE_CLASSES }> = {
  blocked: { label: "Em revisão", tone: "info" },
  requested: { label: "Em revisão", tone: "info" },
  approved: { label: "Liberado", tone: "success" },
  changed: { label: "Liberado", tone: "success" },
  rejected: { label: "Indisponível", tone: "muted" },
};

/** Produtos que a franquia pediu para revisar e o resultado de cada um. */
function PriceReviewList({ reviews }: { reviews: PriceReview[] }) {
  return (
    <Card className="mt-6">
      <CardContent className="space-y-3 p-5">
        <div>
          <h2 className="font-display text-lg font-bold">Produtos em revisão de preço</h2>
          <p className="text-sm text-muted-foreground">
            Produtos que estavam sem preço de franquia e que você pediu para a nossa equipe revisar.
          </p>
        </div>
        <ul className="divide-y divide-border/70">
          {reviews.map((review) => {
            const state = REVIEW_STATES[review.status] ?? REVIEW_STATES.requested;
            const released = review.status === "approved" || review.status === "changed";
            return (
              <li key={review.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{review.title || "Produto"}</p>
                  <p className="text-xs text-muted-foreground">
                    {released
                      ? `Liberado${review.price !== null ? ` por ${formatMoney(review.price)}` : ""}. Já pode adicionar ao carrinho.`
                      : review.status === "rejected"
                      ? `Não disponível para franquia${review.note ? `: ${review.note}` : "."}`
                      : `Pedido em ${formatDate(review.requestedAt)}. Avisaremos aqui quando for decidido.`}
                  </p>
                </div>
                <Badge variant="outline" className={cn("w-fit", TONE_CLASSES[state.tone])}>{state.label}</Badge>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function FranchiseOrderCard({ order }: { order: SaleOrder }) {
  const situation = situationState(order.situation);
  const payment = paymentState(order.payment.status);
  const dueDate = formatDueDate(order.payment.dueDate);
  const canPay = Boolean(order.payment.boletoUrl) &&
    !["received", "confirmed", "paid", "cancelled"].includes(order.payment.status || "");

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-4 p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1">
                {order.origin === "site" ? <Package className="h-3 w-3" /> : <Store className="h-3 w-3" />}
                {order.origin === "site" ? "Site" : "Pedido de venda"}
              </Badge>
              <Badge variant="outline" className={TONE_CLASSES[situation.tone]}>{situation.label}</Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{formatDate(order.createdAt)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="font-display text-xl font-bold">{formatMoney(order.total, order.currency)}</p>
          </div>
        </div>

        <SaleDocuments saleOrderNumber={order.saleOrderNumber} invoice={order.invoice} />

        {order.items.length > 0 && (
          <ul className="space-y-1.5 border-t border-border pt-3 text-sm">
            {order.items.map((item, index) => (
              <li key={index} className="flex items-center gap-3">
                {item.imageUrl && <img src={item.imageUrl} alt="" className="h-10 w-10 rounded-md bg-muted object-cover" />}
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="text-muted-foreground">x{item.quantity}</span>
                <span className="w-24 text-right font-semibold tabular-nums">{formatMoney(item.unitPrice * item.quantity, order.currency)}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {payment ? (
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">Boleto</span>
                <Badge variant="outline" className={TONE_CLASSES[payment.tone]}>{payment.label}</Badge>
              </span>
            ) : (
              <span className="text-muted-foreground">Boleto em geração</span>
            )}
            {dueDate && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <CalendarDays className="h-4 w-4" /> Vence em {dueDate}
              </span>
            )}
            {order.trackingCode && (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Truck className="h-4 w-4" /> Rastreio {order.trackingCode}
              </span>
            )}
          </div>
          {order.payment.boletoUrl && (
            <Button size="sm" variant={canPay ? "default" : "outline"} className={cn("gap-1", canPay && "btn-bounce")} asChild>
              <a href={order.payment.boletoUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" /> {canPay ? "Pagar boleto" : "Ver boleto"}
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
