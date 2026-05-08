import heroImage from "@/assets/hero-pets.jpg";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

export const HeroSection = () => {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-pet-navy-light via-background to-pet-gold-light">
      <div className="container mx-auto grid md:grid-cols-2 items-center gap-8 py-12 md:py-20">
        <div className="space-y-6 text-center md:text-left animate-fade-in-up">
          <h1 className="font-display font-900 text-4xl md:text-5xl lg:text-6xl leading-tight text-foreground">
            O Melhor para o seu Pet. <span className="text-primary">O Menor Preço para Você.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-md mx-auto md:mx-0">
            Qualidade premium com preços que cabem no seu bolso. Aproveite nossas ofertas exclusivas.
          </p>
          <Button
            size="lg"
            className="btn-bounce text-lg px-8 py-6 rounded-full font-display font-bold shadow-lg hover:shadow-xl transition-shadow bg-secondary text-secondary-foreground hover:bg-secondary/90"
          >
            Ver Ofertas
          </Button>
        </div>
        <div className="flex justify-center animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
          <img
            src={heroImage}
            alt="Cachorro e gato felizes com brinquedos e ração"
            width={1920}
            height={1080}
            className="rounded-3xl shadow-2xl max-w-full h-auto object-cover"
          />
        </div>
      </div>
    </section>
  );
};
