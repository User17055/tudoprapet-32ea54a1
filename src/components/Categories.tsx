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
    <section className="py-1 md:py-2">
      <div className="container mx-auto">
        <div className="grid grid-cols-2 gap-1 max-w-[260px] mx-auto">
          {pets.map((p) => (
            <button
              key={p.slug}
              onClick={() => navigate(`/catalogo?pet=${p.label}`)}
              className="group flex flex-col items-center gap-0.5"
            >
              <div className="w-14 h-14 md:w-16 md:h-16 overflow-hidden rounded-xl bg-white">
                <img
                  src={p.img}
                  alt={p.label}
                  className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                />
              </div>
              <span className="text-xs font-medium text-primary">{p.label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
