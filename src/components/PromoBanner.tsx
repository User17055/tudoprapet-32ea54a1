import { Tag, Pill, Utensils, Sparkles } from "lucide-react";

const items = [
  { icon: Utensils, label: "Rações", off: "até 30%" },
  { icon: Pill, label: "Medicamentos", off: "até 50%" },
  { icon: Sparkles, label: "Higiene", off: "até 25%" },
  { icon: Tag, label: "Acessórios", off: "até 40%" },
];

export const PromoBanner = () => {
  return (
    <section className="py-10 md:py-14">
      <div className="container mx-auto">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-secondary via-[hsl(40_85%_55%)] to-[hsl(40_90%_48%)] text-primary p-6 md:p-10 shadow-xl">
          {/* Decorative tags */}
          <Tag className="absolute -top-4 -right-4 h-40 w-40 text-primary/10 rotate-12" />
          <Tag className="absolute bottom-2 left-1/3 h-20 w-20 text-primary/5 -rotate-12" />

          <div className="relative text-center mb-6 md:mb-8">
            <span className="inline-block bg-primary text-primary-foreground text-xs font-900 uppercase tracking-wider px-3 py-1 rounded-full mb-3">
              Ofertas da semana
            </span>
            <h2 className="font-display font-900 text-3xl md:text-5xl leading-tight">
              Até <span className="text-primary-foreground bg-primary px-2 rounded-lg">50% OFF</span>
            </h2>
            <p className="font-display font-bold text-base md:text-lg mt-2 text-primary/80">
              em rações, medicamentos e muito mais
            </p>
          </div>

          <div className="relative grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 max-w-3xl mx-auto">
            {items.map((it, i) => (
              <div
                key={i}
                className="flex flex-col items-center gap-2 bg-white/70 backdrop-blur rounded-2xl py-4 md:py-5 px-3 border border-primary/10 shadow-sm"
              >
                <div className="flex items-center justify-center h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-md">
                  <it.icon className="h-6 w-6" />
                </div>
                <p className="font-display font-900 text-sm md:text-base text-primary leading-tight">
                  {it.label}
                </p>
                <p className="text-[11px] md:text-xs font-bold uppercase tracking-wider text-primary/70">
                  {it.off} OFF
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
