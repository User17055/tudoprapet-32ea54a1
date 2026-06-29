import { useNavigate } from "react-router-dom";
import pet1 from "@/assets/pet-1.svg.asset.json";
import pet2 from "@/assets/pet-2.svg.asset.json";

const pets = [
  { label: "Cachorro", slug: "cachorro", img: pet1.url },
  { label: "Gato", slug: "gato", img: pet2.url },
];

export const Categories = () => {
  const navigate = useNavigate();

  return (
    <section className="py-8 md:py-12">
      <div className="container mx-auto">
        <div className="text-center mb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-secondary">
            Compre por pet
          </span>
          <h2 className="font-display font-900 text-2xl md:text-3xl text-foreground">
            Pra quem é hoje?
          </h2>
        </div>

        <div className="grid grid-cols-2 gap-3 md:gap-6 max-w-3xl mx-auto">
          {pets.map((p) => (
            <button
              key={p.slug}
              onClick={() => navigate(`/catalogo?busca=${p.slug}`)}
              className="group flex flex-col items-center gap-2 p-3 md:p-5 rounded-3xl bg-card border-2 border-border hover:border-primary hover:-translate-y-1 transition-all duration-300 shadow-sm hover:shadow-xl"
            >
              <div className="aspect-square w-full flex items-center justify-center overflow-hidden">
                <img
                  src={p.img}
                  alt={p.label}
                  className="h-full w-full object-contain group-hover:scale-105 transition-transform"
                />
              </div>
              <span className="font-display font-900 text-lg md:text-2xl text-primary">
                {p.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
