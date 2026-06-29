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
    <section className="py-2 md:py-4">
      <div className="container mx-auto">
        <div className="grid grid-cols-2 gap-3 md:gap-4 max-w-xs mx-auto">
          {pets.map((p) => (
            <button
              key={p.slug}
              onClick={() => navigate(`/catalogo?busca=${p.slug}`)}
              className="group flex flex-col items-center gap-1"
            >
              <div className="w-20 h-20 md:w-24 md:h-24 overflow-hidden rounded-xl bg-white">
                <img
                  src={p.img}
                  alt={p.label}
                  className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                />
              </div>
              <span className="text-sm font-medium text-primary">{p.label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
