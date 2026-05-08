import { Star, Quote } from "lucide-react";

const testimonials = [
  {
    name: "Maria S.",
    pet: "Tutora da Luna 🐶",
    text: "Comprei a ração premium pela metade do preço que encontrava em outras lojas. Minha cachorra amou!",
    stars: 5,
  },
  {
    name: "João P.",
    pet: "Tutor do Frajola 🐱",
    text: "Entrega super rápida e produtos de excelente qualidade. Minha gatinha ficou muito feliz com o brinquedo novo.",
    stars: 5,
  },
  {
    name: "Ana L.",
    pet: "Tutora do Thor 🐶",
    text: "Melhor custo-benefício! Já comprei várias vezes e sempre fui muito bem atendida. Recomendo demais!",
    stars: 5,
  },
];

export const Testimonials = () => {
  return (
    <section className="py-10 md:py-14 bg-gradient-to-b from-pet-navy-light to-background">
      <div className="container mx-auto">
        <div className="text-center mb-8">
          <span className="text-xs font-bold uppercase tracking-wider text-secondary">
            Quem comprou aprovou
          </span>
          <h2 className="font-display font-900 text-2xl md:text-3xl">
            Pets felizes, tutores satisfeitos
          </h2>
          <div className="flex items-center justify-center gap-1 mt-2">
            {Array.from({ length: 5 }).map((_, j) => (
              <Star key={j} className="h-5 w-5 fill-secondary text-secondary" />
            ))}
            <span className="ml-2 text-sm text-muted-foreground font-medium">
              4.9 de 5 · +1.200 avaliações
            </span>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {testimonials.map((t, i) => (
            <div
              key={i}
              className="hover-lift bg-card border border-border rounded-2xl p-6 space-y-4 relative shadow-sm"
            >
              <Quote className="absolute -top-3 -left-3 h-10 w-10 text-secondary bg-card rounded-full p-2 shadow-md" />
              <div className="flex gap-0.5">
                {Array.from({ length: t.stars }).map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-secondary text-secondary" />
                ))}
              </div>
              <p className="text-foreground text-sm leading-relaxed">"{t.text}"</p>
              <div className="pt-2 border-t border-border">
                <p className="font-display font-bold text-sm">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.pet}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
