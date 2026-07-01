import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { Crown, Gift, Headphones, Loader2, Percent, Sparkles, Star, MessageCircle, Truck } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

// Atualize com seu número (formato internacional, só números): 55 + DDD + número
const WHATSAPP_NUMBER = "5518996642021";
const WHATSAPP_MESSAGE = encodeURIComponent(
  "Olá! Gostaria de saber mais sobre o Clube TudoPraPet."
);
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${WHATSAPP_MESSAGE}`;

const benefits = [
  { icon: Percent, text: "Até 50% de desconto em produtos selecionados" },
  { icon: Sparkles, text: "Acesso antecipado a lançamentos" },
  { icon: Truck, text: "Frete a partir de R$ 10 em Presidente Prudente" },
  { icon: Headphones, text: "Atendimento prioritário" },
  { icon: Gift, text: "Ofertas e promoções especiais" },
];

const ClubePage = () => {
  const { user } = useAuth();
  const { isSubscribed, loading } = useSubscription();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <section className="relative overflow-hidden bg-gradient-to-br from-primary via-primary to-[hsl(218_70%_15%)] text-primary-foreground py-16 md:py-24">
          <Crown className="pointer-events-none absolute -right-10 -top-10 h-64 w-64 text-white/10 rotate-12" />
          <Crown className="pointer-events-none absolute left-8 bottom-4 h-24 w-24 text-white/5 -rotate-12" />
          <div className="container relative mx-auto px-4 text-center">
            <div className="inline-flex items-center gap-2 bg-secondary/20 rounded-full px-4 py-2 mb-6">
              <Crown className="h-5 w-5 text-secondary" />
              <span className="font-display font-bold text-sm">Clube Exclusivo</span>
            </div>
            <h1 className="font-display font-900 text-4xl md:text-5xl mb-4">
              Clube TudoPraPet
            </h1>
            <p className="text-lg md:text-xl opacity-90 max-w-2xl mx-auto mb-8">
              Membros do clube recebem <span className="font-bold text-secondary">até 50% de desconto</span> em produtos selecionados, aplicado automaticamente no checkout!
            </p>

            {/* CTA WhatsApp - sempre visível */}
            <div className="mb-8">
              <a
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-bounce inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#1faa53] text-white font-display font-bold px-6 py-3 rounded-full shadow-lg transition-colors"
              >
                <MessageCircle className="h-5 w-5" />
                Falar com a gente no WhatsApp
              </a>
            </div>

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
                    className="btn-bounce bg-secondary text-secondary-foreground hover:bg-secondary/90 text-lg px-8 py-6 rounded-full"
                  >
                    Fazer Login
                  </Button>
                </Link>
              </div>
            )}

            <div className="mt-10 inline-block rotate-2 rounded-2xl bg-white p-5 text-left text-foreground shadow-2xl transition-transform hover:rotate-0">
              <p className="text-xs text-muted-foreground line-through tabular-nums">De R$ 189,90</p>
              <p className="font-display font-900 text-3xl tabular-nums">R$ 159,90</p>
              <div className="mt-2 border-t border-border pt-2">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-sky-600">Preço do clube</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-display font-900 text-2xl tabular-nums text-sky-500">R$ 134,90</span>
                  <Crown className="h-4 w-4 text-sky-500" />
                </div>
                <p className="text-[10px] font-medium text-sky-500/80">para assinantes</p>
              </div>
            </div>
          </div>
        </section>

        <section className="paw-pattern py-16">
          <div className="container mx-auto px-4">
            <h2 className="font-display font-900 text-3xl text-center mb-12">
              Vantagens do Clube
            </h2>
            <div className="grid max-w-4xl mx-auto gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {benefits.map((benefit, i) => (
                <div
                  key={i}
                  className="hover-lift flex items-center gap-4 p-4 rounded-xl bg-card border border-border"
                >
                  <div className="h-11 w-11 rounded-xl bg-pet-green/10 flex items-center justify-center flex-shrink-0">
                    <benefit.icon className="h-5 w-5 text-pet-green" />
                  </div>
                  <span className="font-medium">{benefit.text}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default ClubePage;
