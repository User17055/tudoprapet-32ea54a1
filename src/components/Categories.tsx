import { useNavigate } from "react-router-dom";
import pet1 from "@/assets/pet-1.svg.asset.json";
import pet2 from "@/assets/pet-2.svg.asset.json";

const pets = [
  { label: "Cachorro", slug: "cachorro", img: pet2.url },
  { label: "Gato", slug: "gato", img: pet1.url },
];

interface CategoriesProps {
  overlay?: boolean;
}

export const Categories = ({ overlay = false }: CategoriesProps) => {
  const navigate = useNavigate();

  return (
    <section className={overlay ? "relative z-20 -mt-16 md:-mt-20 pb-4 md:pb-6" : "py-1 md:py-2"}>
      <div className="max-w-[220px] md:max-w-[280px] mx-auto px-3">
        <div className="grid grid-cols-2 gap-2 mx-auto rounded-2xl bg-white/90 p-2 shadow-[0_14px_35px_rgba(17,24,39,0.16)] backdrop-blur">
          {pets.map((p) => (
            <button
              key={p.slug}
              onClick={() => navigate(`/catalogo?pet=${p.label}`)}
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
