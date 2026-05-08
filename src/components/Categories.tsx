import { Utensils, Gamepad2, BedDouble, Pill, Sparkles, Bone } from "lucide-react";
import { useNavigate } from "react-router-dom";

const categories = [
  { icon: Utensils, label: "Rações", slug: "racoes" },
  { icon: Pill, label: "Farmácia", slug: "farmacia" },
  { icon: Gamepad2, label: "Brinquedos", slug: "brinquedos" },
  { icon: BedDouble, label: "Camas", slug: "camas" },
  { icon: Sparkles, label: "Higiene", slug: "higiene" },
  { icon: Bone, label: "Petiscos", slug: "petiscos" },
];

export const Categories = () => {
  const navigate = useNavigate();

  return (
    <section className="py-10 md:py-14">
      <div className="container mx-auto">
        <div className="flex items-end justify-between mb-6">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-secondary">
              Compre por categoria
            </span>
            <h2 className="font-display font-900 text-2xl md:text-3xl text-foreground">
              Tudo o que seu pet ama
            </h2>
          </div>
          <button
            onClick={() => navigate("/catalogo")}
            className="hidden md:inline text-sm font-bold text-primary hover:underline"
          >
            Ver tudo →
          </button>
        </div>

        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 md:gap-5">
          {categories.map((cat, i) => (
            <button
              key={i}
              onClick={() => navigate(`/catalogo?categoria=${cat.slug}`)}
              className="group flex flex-col items-center gap-3 p-4 md:p-5 rounded-2xl bg-card border border-border hover:border-secondary hover:-translate-y-1 transition-all duration-300 shadow-sm hover:shadow-xl"
            >
              {/* Ícone com efeito mais bonito */}
              <div className="relative">
                {/* Halo dourado por trás */}
                <span className="absolute inset-0 bg-secondary/30 blur-xl rounded-full group-hover:bg-secondary/50 transition-colors" />
                {/* Círculo principal */}
                <div className="relative flex items-center justify-center h-16 w-16 md:h-20 md:w-20 rounded-full bg-gradient-to-br from-primary via-primary to-[hsl(218_70%_18%)] shadow-lg ring-4 ring-secondary/20 group-hover:ring-secondary/50 group-hover:scale-110 transition-all">
                  <cat.icon
                    className="h-8 w-8 md:h-10 md:w-10 text-white"
                    strokeWidth={2.2}
                  />
                </div>
              </div>
              <span className="font-display font-bold text-xs md:text-sm text-center leading-tight text-foreground group-hover:text-primary transition-colors">
                {cat.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
