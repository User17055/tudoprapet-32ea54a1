import { useNavigate } from "react-router-dom";
import pet1 from "@/assets/pet-1.svg.asset.json";
import pet2 from "@/assets/pet-2.svg.asset.json";

const pets = [
  { label: "Cachorro", slug: "cachorro", img: pet2.url },
  { label: "Gato", slug: "gato", img: pet1.url },
];

export const Categories = () => {
  const navigate = useNavigate();

  return (
    <section className="py-1 md:hidden">
      <div className="max-w-[220px] md:max-w-[280px] mx-auto px-3">
        <div className="grid grid-cols-2 gap-2 mx-auto">
          {pets.map((p) => (
            <button
              key={p.slug}
              onClick={() => navigate(`/catalogo?categoria=${p.slug}`)}
              className="group flex flex-col items-center gap-0 rounded-xl transition-transform hover:-translate-y-0.5"
            >
              <div className="w-20 h-20 md:w-28 md:h-28 overflow-hidden rounded-xl bg-white">
                <img
                  src={p.img}
                  alt={p.label}
                  className="w-full h-full object-contain group-hover:scale-105 transition-transform"
                />
              </div>
              <span className="text-xs font-bold text-primary font-[var(--font-body)]">{p.label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
