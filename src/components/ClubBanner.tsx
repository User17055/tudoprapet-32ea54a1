import { Crown, Check } from "lucide-react";
import { Link } from "react-router-dom";

const perks = [
  "Preços exclusivos em todo o site",
  "Frete R$ 10,00 em Presidente Prudente",
  "Atendimento prioritário no WhatsApp",
];

export const ClubBanner = () => {
  return (
    <section className="py-10 md:py-14">
      <div className="container mx-auto">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-[hsl(218_70%_15%)] text-white p-6 md:p-10 shadow-2xl">
          {/* Decorative crown */}
          <Crown className="absolute -right-8 -top-8 h-56 w-56 text-white/10 rotate-12" />
          <Crown className="absolute right-32 bottom-4 h-20 w-20 text-white/5 -rotate-12" />

          <div className="relative grid md:grid-cols-[1.4fr_1fr] gap-6 items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 bg-secondary text-primary text-xs font-900 uppercase tracking-wider px-3 py-1 rounded-full mb-4">
                <Crown className="h-3.5 w-3.5" /> Clube TudoPraPet 🎪
              </span>
              <h2 className="font-display font-900 text-2xl md:text-4xl leading-tight mb-3">
                Caia no forró da economia todo mês 🔥
              </h2>
              <p className="text-sm md:text-base text-white/90 mb-5 max-w-xl">
                Vire membro do nosso arraiá e tenha preços de quermesse em
                centenas de produtos. Sem fidelidade, cancele quando quiser.
              </p>

              <ul className="space-y-2 mb-6">
                {perks.map((perk, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="flex items-center justify-center h-5 w-5 rounded-full bg-secondary text-primary shrink-0">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    {perk}
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap gap-3">
                <Link
                  to="/clube"
                  className="inline-flex items-center gap-2 bg-secondary text-primary font-display font-900 px-6 py-3 rounded-full hover:bg-white transition-colors shadow-lg"
                >
                  <Crown className="h-4 w-4" /> Quero ser membro
                </Link>
                <Link
                  to="/catalogo"
                  className="inline-flex items-center gap-2 bg-white/10 backdrop-blur border border-white/30 font-display font-bold px-6 py-3 rounded-full hover:bg-white/20 transition-colors"
                >
                  Ver produtos
                </Link>
              </div>
            </div>

            {/* Card de preço de exemplo */}
            <div className="hidden md:block">
              <div className="bg-white text-foreground rounded-2xl p-5 shadow-2xl rotate-2 hover:rotate-0 transition-transform">
                <p className="text-xs text-muted-foreground line-through tabular-nums">
                  De R$ 189,90
                </p>
                <p className="font-display font-900 text-3xl tabular-nums">
                  R$ 159,90
                </p>
                <div className="mt-2 pt-2 border-t border-border">
                  <p className="text-[11px] text-sky-600 font-bold uppercase tracking-wider mb-1">
                    Preço do clube
                  </p>
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-display font-900 text-2xl text-sky-500 tabular-nums">
                      R$ 134,90
                    </span>
                    <Crown className="h-4 w-4 text-sky-500" />
                  </div>
                  <p className="text-[10px] text-sky-500/80 font-medium">
                    para assinantes
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
