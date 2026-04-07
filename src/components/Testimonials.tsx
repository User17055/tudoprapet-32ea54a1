import { Star, Quote } from "lucide-react";

const testimonials = [
  {
    name: "Maria S.",
    text: "Comprei a ração premium pela metade do preço que encontrava em outras lojas. Meu cachorro amou!",
    stars: 5,
  },
  {
    name: "João P.",
    text: "Entrega super rápida e produtos de excelente qualidade. Minha gatinha ficou muito feliz com o brinquedo novo.",
    stars: 5,
  },
  {
    name: "Ana L.",
    text: "Melhor custo-benefício! Já comprei várias vezes e sempre fui muito bem atendida. Recomendo demais!",
    stars: 5,
  },
];

export const Testimonials = () => {
  return (
    <section className="py-12 md:py-16">
      <div className="container mx-auto">
        <h2 className="font-display font-800 text-2xl md:text-3xl text-center mb-8">
          O que nossos <span className="text-primary">clientes</span> dizem
        </h2>
        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((t, i) => (
            <div
              key={i}
              className="hover-lift bg-card border border-border rounded-2xl p-6 space-y-4"
            >
              <Quote className="h-8 w-8 text-primary/30" />
              <p className="text-muted-foreground text-sm leading-relaxed">"{t.text}"</p>
              <div className="flex items-center justify-between">
                <span className="font-display font-bold text-sm">{t.name}</span>
                <div className="flex gap-0.5">
                  {Array.from({ length: t.stars }).map((_, j) => (
                    <Star key={j} className="h-4 w-4 fill-accent text-accent" />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
