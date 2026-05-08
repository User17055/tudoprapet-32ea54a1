import { Utensils, Gamepad2, BedDouble, Pill, Sparkles, Bone } from "lucide-react";
import { useNavigate } from "react-router-dom";

const categories = [
  { icon: Utensils, label: "Rações", slug: "racoes", from: "from-amber-400", to: "to-amber-600" },
  { icon: Pill, label: "Farmácia", slug: "farmacia", from: "from-emerald-400", to: "to-emerald-600" },
  { icon: Gamepad2, label: "Brinquedos", slug: "brinquedos", from: "from-rose-400", to: "to-rose-600" },
  { icon: BedDouble, label: "Camas", slug: "camas", from: "from-indigo-400", to: "to-indigo-600" },
  { icon: Sparkles, label: "Higiene", slug: "higiene", from: "from-sky-400", to: "to-sky-600" },
  { icon: Bone, label: "Petiscos", slug: "petiscos", from: "from-orange-400", to: "to-orange-600" },
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

        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 md:gap-4">
          {categories.map((cat, i) => (
            <button
              key={i}
              onClick={() => navigate(`/catalogo?categoria=${cat.slug}`)}
              className="group relative flex flex-col items-center gap-3 p-4 md:p-5 rounded-2xl bg-card border border-border hover:border-secondary hover:-translate-y-1 transition-all duration-300 shadow-sm hover:shadow-lg"
            >
              <div
                className={`flex items-center justify-center h-14 w-14 md:h-16 md:w-16 rounded-2xl bg-gradient-to-br ${cat.from} ${cat.to} shadow-md group-hover:scale-110 transition-transform`}
              >
                <cat.icon className="h-7 w-7 md:h-8 md:w-8 text-white" />
              </div>
              <span className="font-display font-bold text-xs md:text-sm text-center leading-tight">
                {cat.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
