import { Utensils, Gamepad2, BedDouble, Pill, Sparkles } from "lucide-react";

const categories = [
  { icon: Utensils, label: "Rações", color: "bg-pet-orange-light text-primary" },
  { icon: Gamepad2, label: "Brinquedos", color: "bg-pet-blue-light text-secondary" },
  { icon: BedDouble, label: "Camas & Casinhas", color: "bg-pet-orange-light text-primary" },
  { icon: Pill, label: "Farmácia", color: "bg-pet-blue-light text-secondary" },
  { icon: Sparkles, label: "Higiene", color: "bg-pet-orange-light text-primary" },
];

export const Categories = () => {
  return (
    <section className="py-12 md:py-16">
      <div className="container mx-auto">
        <h2 className="font-display font-800 text-2xl md:text-3xl text-center mb-8">
          Navegue por <span className="text-primary">Categoria</span>
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {categories.map((cat, i) => (
            <button
              key={i}
              className={`hover-lift flex flex-col items-center gap-3 p-6 rounded-2xl ${cat.color} cursor-pointer border-2 border-transparent hover:border-primary/30`}
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
