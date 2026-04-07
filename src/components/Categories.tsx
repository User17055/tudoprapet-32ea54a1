import { Utensils, Gamepad2, BedDouble, Pill, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

const categories = [
  { icon: Utensils, label: "Rações", slug: "racoes", color: "bg-pet-gold-light text-primary" },
  { icon: Gamepad2, label: "Brinquedos", slug: "brinquedos", color: "bg-pet-navy-light text-primary" },
  { icon: BedDouble, label: "Camas & Casinhas", slug: "camas", color: "bg-pet-gold-light text-primary" },
  { icon: Pill, label: "Farmácia", slug: "farmacia", color: "bg-pet-navy-light text-primary" },
  { icon: Sparkles, label: "Higiene", slug: "higiene", color: "bg-pet-gold-light text-primary" },
];

export const Categories = () => {
  const navigate = useNavigate();

  return (
    <section className="py-12 md:py-16">
      <div className="container mx-auto">
        <h2 className="font-display font-800 text-2xl md:text-3xl text-center mb-8">
          Navegue por <span className="text-secondary">Categoria</span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {categories.map((cat, i) => (
            <button
              key={i}
              onClick={() => navigate(`/catalogo?categoria=${cat.slug}`)}
              className={`hover-lift flex flex-col items-center gap-3 p-6 rounded-2xl ${cat.color} cursor-pointer border-2 border-transparent hover:border-secondary/40`}
            >
              <cat.icon className="h-10 w-10" />
              <span className="font-display font-bold text-sm">{cat.label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
