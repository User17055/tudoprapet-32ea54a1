import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Tag, Crown } from "lucide-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import heroImage from "@/assets/hero-pets.jpg";

// Substitua pelas suas imagens reais (1600x600 recomendado).
type Banner = {
  alt: string;
  href: string;
  badge: string;
  title: string;
  subtitle: string;
  cta: string;
  gradient: string;
  textColor: string;
  ctaClass: string;
};

const banners: Banner[] = [
  {
    alt: "Mega Promoção da Semana",
    href: "/catalogo",
    badge: "Oferta da semana",
    title: "Mega Promoção TudoPraPet",
    subtitle: "Descontos imperdíveis em todo o catálogo",
    cta: "Aproveitar agora",
    gradient: "from-primary via-primary to-[hsl(218_70%_18%)]",
    textColor: "text-white",
    ctaClass: "bg-secondary text-primary hover:bg-white",
  },
  {
    alt: "Farmácia Pet",
    href: "/catalogo?categoria=farmacia",
    badge: "Farmácia",
    title: "Cuide da saúde do seu pet",
    subtitle: "Antipulgas, vermífugos e suplementos com até 25% OFF",
    cta: "Ver farmácia",
    gradient: "from-secondary via-[hsl(40_85%_55%)] to-[hsl(40_90%_48%)]",
    textColor: "text-primary",
    ctaClass: "bg-primary text-primary-foreground hover:bg-primary/90",
  },
  {
    alt: "Rações com até 30% off",
    href: "/catalogo?categoria=racoes",
    badge: "Rações Premium",
    title: "Até 30% OFF em rações",
    subtitle: "As melhores marcas com preço de clube",
    cta: "Ver rações",
    gradient: "from-[hsl(218_70%_18%)] via-primary to-secondary",
    textColor: "text-white",
    ctaClass: "bg-secondary text-primary hover:bg-white",
  },
  {
    alt: "Frete R$ 10 em Presidente Prudente",
    href: "/catalogo",
    badge: "Entrega rápida",
    title: "Frete R$ 10 em Presidente Prudente",
    subtitle: "Receba no mesmo dia em pedidos selecionados",
    cta: "Comprar agora",
    gradient: "from-[hsl(218_70%_25%)] via-primary to-[hsl(218_70%_15%)]",
    textColor: "text-white",
    ctaClass: "bg-secondary text-primary hover:bg-white",
  },
  {
    alt: "Clube TudoPraPet",
    href: "/clube",
    badge: "Clube TudoPraPet",
    title: "Vire assinante e pague menos",
    subtitle: "Frete grátis acima de R$ 99 e preços exclusivos",
    cta: "Quero assinar",
    gradient: "from-primary via-[hsl(218_70%_22%)] to-secondary",
    textColor: "text-white",
    ctaClass: "bg-secondary text-primary hover:bg-white",
  },
  {
    alt: "Brinquedos e diversão",
    href: "/catalogo?categoria=brinquedos",
    badge: "Diversão",
    title: "Brinquedos para todos os pets",
    subtitle: "Estimule e divirta seu melhor amigo",
    cta: "Ver brinquedos",
    gradient: "from-secondary/80 via-[hsl(40_85%_60%)] to-primary",
    textColor: "text-white",
    ctaClass: "bg-white text-primary hover:bg-secondary",
  },
];

const promoStrip = [
  { icon: Tag, title: "Até 30% OFF", desc: "Em rações premium" },
  { icon: Crown, title: "Clube TudoPraPet", desc: "Preços exclusivos" },
];

export const HeroSection = () => {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!api) return;
    setCount(api.scrollSnapList().length);
    setCurrent(api.selectedScrollSnap());
    api.on("select", () => setCurrent(api.selectedScrollSnap()));
  }, [api]);

  useEffect(() => {
    if (!api) return;
    const id = setInterval(() => api.scrollNext(), 6000);
    return () => clearInterval(id);
  }, [api]);

  return (
    <section className="relative bg-gradient-to-br from-primary/10 via-secondary/5 to-background pt-4 pb-6 md:pt-6 md:pb-10">
      <div className="container mx-auto px-2 md:px-4">
        {/* Faixa promocional topo */}
        <div className="hidden md:flex items-center justify-center gap-3 mb-4">
          {promoStrip.map((p, i) => (
            <div
              key={i}
              className="flex items-center gap-2 bg-card border border-border/60 rounded-full px-4 py-1.5 shadow-sm"
            >
              <p.icon className="h-4 w-4 text-secondary" />
              <span className="text-xs font-bold text-foreground">{p.title}</span>
              <span className="text-xs text-muted-foreground">· {p.desc}</span>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-[1fr_320px] gap-4">
          {/* Carousel principal */}
          <Carousel
            setApi={setApi}
            opts={{ loop: true, align: "center" }}
            className="relative"
          >
            <CarouselContent>
              {banners.map((banner, i) => (
                <CarouselItem key={i}>
                  <Link
                    to={banner.href}
                    className="block group rounded-2xl md:rounded-3xl overflow-hidden shadow-xl hover:shadow-2xl transition-all duration-500 ring-1 ring-border/50"
                  >
                    <div className="relative aspect-[16/8] md:aspect-[21/9] bg-muted">
                      <img
                        src={banner.image}
                        alt={banner.alt}
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-700"
                        loading={i === 0 ? "eager" : "lazy"}
                      />
                    </div>
                  </Link>
                </CarouselItem>
              ))}
            </CarouselContent>

            <CarouselPrevious className="hidden md:flex left-3 h-11 w-11 bg-background/95 hover:bg-background border-border shadow-lg" />
            <CarouselNext className="hidden md:flex right-3 h-11 w-11 bg-background/95 hover:bg-background border-border shadow-lg" />

            {/* Dots */}
            <div className="flex justify-center gap-2 mt-3">
              {Array.from({ length: count }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => api?.scrollTo(i)}
                  aria-label={`Banner ${i + 1}`}
                  className={`h-2 rounded-full transition-all ${
                    current === i
                      ? "w-8 bg-primary"
                      : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
                  }`}
                />
              ))}
            </div>
          </Carousel>

          {/* Mini banners laterais (desktop) */}
          <div className="hidden lg:flex flex-col gap-4">
            <Link
              to="/clube"
              className="group relative flex-1 rounded-2xl overflow-hidden bg-gradient-to-br from-primary to-[hsl(218_70%_15%)] text-white p-5 shadow-lg hover:shadow-2xl transition-all hover-lift"
            >
              <Crown className="absolute -top-2 -right-2 h-24 w-24 text-white/10 rotate-12" />
              <span className="inline-block text-[10px] font-bold uppercase tracking-wider bg-white/20 px-2 py-0.5 rounded-full mb-2">
                Clube
              </span>
              <h3 className="font-display font-900 text-xl leading-tight mb-1">
                Vire assinante e pague menos
              </h3>
              <p className="text-xs text-white/90 mb-3">
                Preços exclusivos com a coroa em todos os produtos.
              </p>
              <span className="inline-flex items-center gap-1 text-xs font-bold bg-secondary text-primary px-3 py-1.5 rounded-full group-hover:bg-white transition-colors">
                Quero assinar →
              </span>
            </Link>

            <Link
              to="/catalogo?categoria=farmacia"
              className="group relative flex-1 rounded-2xl overflow-hidden bg-gradient-to-br from-secondary to-secondary/70 text-primary p-5 shadow-lg hover:shadow-2xl transition-all hover-lift"
            >
              <Tag className="absolute -top-2 -right-2 h-24 w-24 text-primary/10 -rotate-12" />
              <span className="inline-block text-[10px] font-bold uppercase tracking-wider bg-primary/10 px-2 py-0.5 rounded-full mb-2">
                Promoção
              </span>
              <h3 className="font-display font-900 text-xl leading-tight mb-1">
                Farmácia com até 25% OFF
              </h3>
              <p className="text-xs text-primary/80 mb-3">
                Antipulgas, vermífugos e suplementos.
              </p>
              <span className="inline-flex items-center gap-1 text-xs font-bold bg-primary text-primary-foreground px-3 py-1.5 rounded-full">
                Ver ofertas →
              </span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};
