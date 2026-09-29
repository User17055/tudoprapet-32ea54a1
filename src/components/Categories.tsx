import { useNavigate } from "react-router-dom";
import { Cat, Dog } from "lucide-react";

const pets = [
  { label: "Cachorro", slug: "cachorro", Icon: Dog },
  { label: "Gato", slug: "gato", Icon: Cat },
];

export const Categories = () => {
  const navigate = useNavigate();

  return (
    <section className="py-1 md:py-2">
      <div className="max-w-[220px] md:max-w-[280px] mx-auto px-3">
        <div className="grid grid-cols-2 gap-2 mx-auto">
          {pets.map((p) => (
            <button
              key={p.slug}
              onClick={() => navigate(`/catalogo?categoria=${p.slug}`)}
              className="group flex flex-col items-center gap-0 rounded-xl transition-transform hover:-translate-y-0.5"
            >
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground md:h-28 md:w-28">
                <p.Icon
                  aria-hidden="true"
                  strokeWidth={1.8}
                  className="h-11 w-11 transition-transform group-hover:scale-105 md:h-16 md:w-16"
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
