import { Link } from "react-router-dom";
import { Sparkles, Stethoscope, ShoppingBag, Crown, Truck, Flame } from "lucide-react";
import heroPets from "@/assets/hero-petzen.png";

export const HeroSection = () => {
  return (
    <section className="relative overflow-hidden bg-background pt-6 pb-10 md:pt-10 md:pb-16">
      {/* Sparkles decorativos no fundo */}
      <Sparkles className="hidden md:block absolute top-20 left-10 h-8 w-8 text-secondary/40 rotate-12" />
      <Sparkles className="hidden md:block absolute bottom-24 right-1/3 h-6 w-6 text-secondary/30 -rotate-12" />

      <div className="container mx-auto px-4">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
          {/* Lado esquerdo — Texto */}
          <div className="relative z-10 order-2 lg:order-1 text-center lg:text-left">
            <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary bg-secondary/20 px-3 py-1.5 rounded-full mb-5">
              <Flame className="h-3.5 w-3.5 text-secondary" />
              Copa TudoPraPet 🏆⚽
            </span>

            <h1 className="font-display font-900 text-4xl md:text-5xl lg:text-6xl xl:text-7xl leading-[1.05] text-primary mb-5">
              É Copa do Mundo <br className="hidden md:block" /> pro seu{" "}
              <span className="relative inline-block text-secondary">
                pet
                <Sparkles className="absolute -top-3 -right-6 h-5 w-5 md:h-6 md:w-6 text-secondary" />
              </span>
            </h1>

            <p className="text-base md:text-lg text-muted-foreground max-w-xl mx-auto lg:mx-0 mb-7 leading-relaxed">
              Sua seleção pet entra em campo! Rações, farmácia, brinquedos e
              acessórios com preços de craque. Entrega em Presidente Prudente
              por R$ 10. 🇧🇷
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start mb-8">
              <Link
                to="/catalogo"
                className="inline-flex items-center justify-center gap-2 bg-secondary text-primary font-bold px-7 py-3.5 rounded-full hover:bg-secondary/90 hover:-translate-y-0.5 transition-all shadow-lg shadow-secondary/30"
              >
                <ShoppingBag className="h-5 w-5" />
                Entrar em campo
              </Link>
            </div>

          </div>

          {/* Lado direito — Imagem com círculo amarelo */}
          <div className="relative order-1 lg:order-2 flex items-center justify-center min-h-[340px] md:min-h-[480px]">
            {/* Círculo amarelo de fundo */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[280px] h-[280px] md:w-[440px] md:h-[440px] lg:w-[500px] lg:h-[500px] rounded-full bg-secondary" />

            {/* Sparkles ao redor */}
            <Sparkles className="absolute top-6 right-6 md:top-10 md:right-10 h-10 w-10 md:h-14 md:w-14 text-secondary fill-secondary" />
            <div className="absolute bottom-12 left-4 md:bottom-20 md:left-8 h-6 w-6 md:h-8 md:w-8 rounded-full bg-secondary/70" />
            <div className="absolute top-16 left-12 md:top-24 md:left-20 h-3 w-3 md:h-4 md:w-4 rounded-full bg-primary/30" />

            {/* Imagem do pet */}
            <img
              src={heroPets}
              alt="Cachorro e gato felizes — TudoPraPet"
              width={1024}
              height={1024}
              className="relative z-10 w-[280px] md:w-[440px] lg:w-[520px] h-auto object-contain drop-shadow-2xl"
            />

            {/* Card flutuante 1 — Farmácia */}
            <div className="absolute top-4 left-0 md:top-10 md:-left-4 z-20 bg-card border border-border/60 rounded-2xl shadow-xl px-3 py-2.5 md:px-4 md:py-3 flex items-center gap-2.5 max-w-[180px] md:max-w-[230px] animate-fade-in-up">
              <div className="h-9 w-9 md:h-11 md:w-11 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Stethoscope className="h-5 w-5 md:h-6 md:w-6 text-primary" />
              </div>
              <div className="text-left">
                <div className="font-display font-900 text-xs md:text-sm text-foreground leading-tight">
                  Farmácia Pet
                </div>
                <div className="text-[10px] md:text-xs text-muted-foreground leading-tight">
                  Antipulgas e vermífugos com até 25% OFF
                </div>
              </div>
            </div>

            {/* Card flutuante 2 — Frete */}
            <div className="absolute bottom-4 right-0 md:bottom-12 md:-right-4 z-20 bg-card border border-border/60 rounded-2xl shadow-xl px-3 py-2.5 md:px-4 md:py-3 flex items-center gap-2.5 max-w-[180px] md:max-w-[230px] animate-fade-in-up">
              <div className="h-9 w-9 md:h-11 md:w-11 rounded-xl bg-secondary/20 flex items-center justify-center flex-shrink-0">
                <Truck className="h-5 w-5 md:h-6 md:w-6 text-secondary" />
              </div>
              <div className="text-left">
                <div className="font-display font-900 text-xs md:text-sm text-foreground leading-tight">
                  Entrega rápida
                </div>
                <div className="text-[10px] md:text-xs text-muted-foreground leading-tight">
                  Pres. Prudente R$ 10
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
