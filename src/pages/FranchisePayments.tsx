import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowLeft, CalendarDays, ExternalLink, FileText, Loader2, ReceiptText, RefreshCw, WalletCards } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { useAuth } from "@/contexts/AuthContext";
import { useIsFranchisee } from "@/hooks/useIsFranchisee";
import { supabase } from "@/integrations/supabase/client";

interface FranchisePayment {
  id: string;
  checkoutSessionId: string;
  orderNumber: string | null;
  invoiceNumber: string | null;
  invoiceUrl: string | null;
  invoicePurpose: "resale" | "final_consumption" | null;
  paymentTermDays: number | null;
  amount: number;
  currency: string;
  status: string;
  dueDate: string | null;
  paymentUrl: string | null;
  providerPaymentId: string | null;
  createdAt: string;
}

const STATUS: Record<string, { label: string; className: string }> = {
  received: { label: "Pago", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  paid: { label: "Pago", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  pending: { label: "Em aberto", className: "border-amber-200 bg-amber-50 text-amber-800" },
  processing: { label: "Em processamento", className: "border-blue-200 bg-blue-50 text-blue-700" },
  confirmed: { label: "Em processamento", className: "border-blue-200 bg-blue-50 text-blue-700" },
  overdue: { label: "Vencido", className: "border-red-200 bg-red-50 text-red-700" },
  cancelled: { label: "Cancelado", className: "border-slate-200 bg-slate-100 text-slate-600" },
};

const money = (value: number, currency = "BRL") =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value || 0);

const date = (value: string | null) => value
  ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${value}T12:00:00-03:00`))
  : "Aguardando geração";

export default function FranchisePayments() {
  const { user, loading: authLoading } = useAuth();
  const { isFranchisee, loading: franchiseLoading } = useIsFranchisee();
  const navigate = useNavigate();
  const [payments, setPayments] = useState<FranchisePayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPayments = useCallback(async () => {
    if (!user || !isFranchisee) return;
    setLoading(true);
    setError("");
    const { data, error: requestError } = await supabase.functions.invoke("franchise-payments");
    if (requestError || data?.error) {
      setError(data?.error || "Não foi possível carregar seus pagamentos.");
    } else {
      setPayments(Array.isArray(data?.payments) ? data.payments : []);
    }
    setLoading(false);
  }, [isFranchisee, user]);

  useEffect(() => {
    if (authLoading || franchiseLoading) return;
    if (!user) return void navigate("/login", { replace: true });
    if (!isFranchisee) return void navigate("/perfil", { replace: true });
    void loadPayments();
  }, [authLoading, franchiseLoading, isFranchisee, loadPayments, navigate, user]);

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
              <h1 className="mt-1 font-display text-3xl font-black text-foreground">Pagamentos</h1>
              <p className="mt-2 text-muted-foreground">Acompanhe boletos, Pix, vencimentos e baixas registradas na Olist.</p>
            </div>
            <Button variant="outline" onClick={() => void loadPayments()} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Atualizar
            </Button>
          </div>

          {error && (
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><span>{error}</span>
            </div>
          )}

          {loading ? (
            <div className="mt-8 space-y-3">{[0, 1, 2].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl bg-muted" />)}</div>
          ) : payments.length === 0 ? (
            <Card className="mt-8 border-dashed"><CardContent className="flex flex-col items-center py-14 text-center">
              <WalletCards className="h-12 w-12 text-muted-foreground" />
              <h2 className="mt-4 text-lg font-bold">Nenhum pagamento encontrado</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">As cobranças dos seus próximos pedidos de franquia aparecerão aqui.</p>
              <Button className="mt-5" asChild><Link to="/catalogo">Ir ao catálogo</Link></Button>
            </CardContent></Card>
          ) : (
            <div className="mt-8 grid gap-4">
              {payments.map((payment) => {
                const status = STATUS[payment.status] || { label: payment.status || "Em aberto", className: "" };
                const canPay = Boolean(payment.paymentUrl) && !["received", "paid", "cancelled"].includes(payment.status);
                return (
                  <Card key={payment.id} className="overflow-hidden">
                    <CardContent className="p-0">
                      <div className="grid gap-5 p-5 md:grid-cols-[1fr_auto] md:items-center md:p-6">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <ReceiptText className="h-5 w-5 text-primary" />
                            <h2 className="font-display text-lg font-bold">Pedido Olist {payment.orderNumber ? `#${payment.orderNumber}` : "em processamento"}</h2>
                            <Badge variant="outline" className={status.className}>{status.label}</Badge>
                          </div>
                          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                            <div><span className="block text-xs text-muted-foreground">Valor</span><strong className="text-base">{money(payment.amount, payment.currency)}</strong></div>
                            <div><span className="block text-xs text-muted-foreground">Vencimento</span><strong className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{date(payment.dueDate)}</strong></div>
                            <div><span className="block text-xs text-muted-foreground">Finalidade da NF-e</span><strong>{payment.invoicePurpose === "final_consumption" ? "Consumo final" : payment.invoicePurpose === "resale" ? "Revenda" : "Não informada"}</strong>{payment.paymentTermDays && <span className="block text-xs text-muted-foreground">Prazo de {payment.paymentTermDays} dias</span>}</div>
                            <div>
                              <span className="block text-xs text-muted-foreground">Nota fiscal</span>
                              <strong className="flex items-center gap-1.5"><FileText className="h-4 w-4" />{payment.invoiceNumber ? `NF-e ${payment.invoiceNumber}` : "Em emissão"}</strong>
                              {payment.invoiceUrl && (
                                <a className="mt-1 inline-flex items-center gap-1 font-semibold text-primary hover:underline" href={payment.invoiceUrl} target="_blank" rel="noreferrer">
                                  <ExternalLink className="h-3.5 w-3.5" />Ver NF-e
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="md:min-w-56">
                          {canPay ? (
                            <Button className="w-full" asChild>
                              <a href={payment.paymentUrl!} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Pagar boleto ou Pix</a>
                            </Button>
                          ) : payment.paymentUrl ? (
                            <Button variant="outline" className="w-full" asChild>
                              <a href={payment.paymentUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Ver cobrança</a>
                            </Button>
                          ) : (
                            <Button variant="outline" className="w-full" disabled>Link sendo gerado</Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
