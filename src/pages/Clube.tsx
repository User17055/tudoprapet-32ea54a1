import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { Crown, Check, Loader2, Star } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const benefits = [
  "Até 50% de desconto em produtos selecionados",
  "Acesso antecipado a lançamentos",
  "Frete grátis em pedidos acima de R$ 99",
  "Atendimento prioritário",
  "Ofertas e promoções especiais",
];

const ClubePage = () => {
  const { user } = useAuth();
  const { isSubscribed, loading } = useSubscription();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
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
              Membros do clube recebem <span className="font-bold text-secondary">50% de desconto</span> em todos os produtos, aplicado automaticamente no checkout!
            </p>

            {loading ? (
              <Loader2 className="h-8 w-8 animate-spin mx-auto" />
            ) : isSubscribed ? (
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 bg-pet-green/20 rounded-full px-6 py-3">
                  <Star className="h-5 w-5 text-secondary" />
                  <span className="font-display font-bold">Você é membro do Clube! 🎉</span>
                </div>
                <p className="text-sm opacity-80">
                  Seu desconto é aplicado automaticamente ao finalizar a compra.
                </p>
              </div>
            ) : user ? (
              <div className="space-y-4">
                <p className="opacity-80 text-lg">
                  O Clube é exclusivo para membros convidados.
                </p>
                <p className="opacity-60 text-sm">
                  Se você acredita que deveria ser membro, entre em contato conosco.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="opacity-80">Faça login para verificar seu status de membro</p>
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
        </section>

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
