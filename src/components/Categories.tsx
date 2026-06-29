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
    <section className="py-4 md:py-6">
      <div className="container mx-auto">
        <div className="grid grid-cols-2 gap-2 md:gap-4 max-w-xl mx-auto">
          {pets.map((p) => (
            <button
              key={p.slug}
              onClick={() => navigate(`/catalogo?busca=${p.slug}`)}
              className="group overflow-hidden rounded-2xl"
            >
              <img
                src={p.img}
                alt={p.label}
                className="w-full h-auto object-contain group-hover:scale-105 transition-transform"
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
