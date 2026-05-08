import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import heroImage from "@/assets/hero-pets.jpg";

// Substitua estes banners pelas suas imagens reais (1600x600 recomendado).
// É só trocar `image` por um import do seu arquivo em src/assets.
const banners = [
  {
    image: heroImage,
    alt: "Banner promocional 1",
    href: "/catalogo",
  },
  {
    image: heroImage,
    alt: "Banner promocional 2",
    href: "/catalogo?categoria=farmacia",
  },
  {
    image: heroImage,
    alt: "Banner promocional 3",
    href: "/catalogo?categoria=racoes",
  },
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

  // Auto-play
  useEffect(() => {
    if (!api) return;
    const interval = setInterval(() => api.scrollNext(), 6000);
    return () => clearInterval(interval);
  }, [api]);

  return (
    <section className="relative bg-gradient-to-b from-pet-navy-light/40 to-background py-6 md:py-10">
      <div className="container mx-auto px-2 md:px-4">
        <Carousel
          setApi={setApi}
          opts={{ loop: true, align: "center" }}
          className="relative"
        >
          <CarouselContent className="-ml-2 md:-ml-4">
            {banners.map((banner, i) => (
              <CarouselItem
                key={i}
                className="pl-2 md:pl-4 basis-[88%] md:basis-[75%] lg:basis-[70%]"
              >
                <Link
                  to={banner.href}
                  className="block group rounded-2xl md:rounded-3xl overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-500"
                >
                  <div className="relative aspect-[16/7] md:aspect-[21/8] bg-muted">
                    <img
                      src={banner.image}
                      alt={banner.alt}
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-700"
                      loading={i === 0 ? "eager" : "lazy"}
                    />
                  </div>
                </Link>
              </CarouselItem>
            ))}
          </CarouselContent>

          <CarouselPrevious className="hidden md:flex -left-2 lg:-left-4 h-12 w-12 bg-background/90 hover:bg-background border-border shadow-lg" />
          <CarouselNext className="hidden md:flex -right-2 lg:-right-4 h-12 w-12 bg-background/90 hover:bg-background border-border shadow-lg" />
        </Carousel>

        {/* Dots */}
        <div className="flex justify-center gap-2 mt-4">
          {Array.from({ length: count }).map((_, i) => (
            <button
              key={i}
              onClick={() => api?.scrollTo(i)}
              aria-label={`Ir para banner ${i + 1}`}
              className={`h-2 rounded-full transition-all ${
                current === i ? "w-8 bg-primary" : "w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
};
