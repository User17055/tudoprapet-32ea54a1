import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { useShopifyAuth } from "@/contexts/ShopifyAuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { Crown, Check, Loader2, Settings, Star } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import { toast } from "sonner";

const benefits = [
  "Preços exclusivos em todos os produtos",
  "Acesso antecipado a lançamentos",
  "Frete grátis em pedidos acima de R$ 99",
  "Atendimento prioritário",
  "Ofertas e promoções especiais",
];

const ClubePage = () => {
  const { customer } = useShopifyAuth();
  const { isSubscribed, subscriptionEnd, loading, createCheckout, openCustomerPortal, checkSubscription } = useSubscription();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const status = searchParams.get("status");
    if (status === "success") {
      toast.success("Assinatura realizada com sucesso! 🎉", { position: "top-center" });
      checkSubscription();
    } else if (status === "canceled") {
      toast.info("Assinatura cancelada.", { position: "top-center" });
    }
  }, [searchParams, checkSubscription]);

  const handleSubscribe = async () => {
    if (!customer) {
      toast.error("Faça login para assinar o clube!", { position: "top-center" });
      return;
    }
    const url = await createCheckout();
    if (url) {
      window.open(url, "_blank");
    } else {
      toast.error("Erro ao criar sessão de pagamento.", { position: "top-center" });
    }
  };

  const handleManage = async () => {
    const url = await openCustomerPortal();
    if (url) {
      window.open(url, "_blank");
    } else {
      toast.error("Erro ao abrir portal de gerenciamento.", { position: "top-center" });
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        {/* Hero */}
        <section className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground py-16 md:py-24">
          <div className="container mx-auto px-4 text-center">
            <div className="inline-flex items-center gap-2 bg-secondary/20 rounded-full px-4 py-2 mb-6">
              <Crown className="h-5 w-5 text-secondary" />
              <span className="font-display font-bold text-sm">Clube Exclusivo</span>
            </div>
            <h1 className="font-display font-900 text-4xl md:text-5xl mb-4">
              Clube TudoPraPet
            </h1>
            <p className="text-lg md:text-xl opacity-90 max-w-2xl mx-auto mb-8">
              Assine por apenas <span className="font-bold text-secondary">R$ 29,90/mês</span> e tenha
              acesso a preços exclusivos em toda a loja!
            </p>

            {loading ? (
              <Loader2 className="h-8 w-8 animate-spin mx-auto" />
            ) : isSubscribed ? (
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 bg-pet-green/20 rounded-full px-6 py-3">
                  <Star className="h-5 w-5 text-secondary" />
                  <span className="font-display font-bold">Você é membro do Clube! 🎉</span>
                </div>
                {subscriptionEnd && (
                  <p className="text-sm opacity-80">
                    Próxima renovação: {new Date(subscriptionEnd).toLocaleDateString("pt-BR")}
                  </p>
                )}
                <div>
                  <Button
                    variant="outline"
                    className="border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10"
                    onClick={handleManage}
                  >
                    <Settings className="h-4 w-4 mr-2" /> Gerenciar Assinatura
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {customer ? (
                  <Button
                    size="lg"
                    className="btn-bounce bg-secondary text-secondary-foreground hover:bg-secondary/90 text-lg px-8 py-6 rounded-full"
                    onClick={handleSubscribe}
                  >
                    <Crown className="h-5 w-5 mr-2" /> Assinar Agora — R$ 29,90/mês
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <p className="opacity-80">Faça login para assinar o clube</p>
                    <Link to="/login">
                      <Button
                        size="lg"
                        className="bg-secondary text-secondary-foreground hover:bg-secondary/90 text-lg px-8 py-6 rounded-full"
                      >
                        Fazer Login
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Benefits */}
        <section className="py-16 container mx-auto px-4">
          <h2 className="font-display font-900 text-3xl text-center mb-12">
            Vantagens do Clube
          </h2>
          <div className="max-w-lg mx-auto space-y-4">
            {benefits.map((benefit, i) => (
              <div
                key={i}
                className="flex items-center gap-4 p-4 rounded-xl bg-card border border-border"
              >
                <div className="h-8 w-8 rounded-full bg-pet-green/10 flex items-center justify-center flex-shrink-0">
                  <Check className="h-5 w-5 text-pet-green" />
                </div>
                <span className="font-medium">{benefit}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default ClubePage;
