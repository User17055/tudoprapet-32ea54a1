import { Dog, Cat, Bird, Fish, Rabbit, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

const pets = [
  {
    icon: Dog,
    label: "Cachorros",
    desc: "Rações, brinquedos e acessórios",
    slug: "cachorro",
    gradient: "from-[hsl(218_58%_27%)] to-[hsl(218_70%_18%)]",
  },
  {
    icon: Cat,
    label: "Gatos",
    desc: "Areia, arranhadores e petiscos",
    slug: "gato",
    gradient: "from-[hsl(40_76%_55%)] to-[hsl(40_85%_42%)]",
  },
  {
    icon: Bird,
    label: "Aves",
    desc: "Sementes, gaiolas e poleiros",
    slug: "ave",
    gradient: "from-[hsl(218_50%_45%)] to-[hsl(218_65%_30%)]",
  },
  {
    icon: Fish,
    label: "Peixes",
    desc: "Aquários, rações e enfeites",
    slug: "peixe",
    gradient: "from-[hsl(218_60%_38%)] to-[hsl(218_75%_22%)]",
  },
  {
    icon: Rabbit,
    label: "Roedores",
    desc: "Coelhos, hamsters e porquinhos",
    slug: "roedor",
    gradient: "from-[hsl(40_60%_50%)] to-[hsl(40_75%_38%)]",
  },
];

export const ShopByPet = () => {
  const navigate = useNavigate();

  return (
    <section className="py-10 md:py-14 bg-muted/30">
      <div className="container mx-auto">
        <div className="text-center mb-8">
          <span className="text-xs font-bold uppercase tracking-wider text-secondary">
            Pra cada um, o melhor
          </span>
          <h2 className="font-display font-900 text-2xl md:text-3xl">
            Compre por tipo de pet
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Encontre tudo que seu companheiro precisa
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
          {pets.map((pet, i) => (
            <button
              key={i}
              onClick={() => navigate(`/catalogo?busca=${pet.slug}`)}
              className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${pet.gradient} text-white p-5 md:p-6 text-left shadow-md hover:shadow-2xl hover:-translate-y-1 transition-all`}
            >
              <pet.icon className="absolute -right-3 -bottom-3 h-24 w-24 text-white/10 group-hover:scale-110 transition-transform" />
              <div className="relative">
                <pet.icon className="h-8 w-8 mb-3" />
                <h3 className="font-display font-900 text-lg md:text-xl mb-1">
                  {pet.label}
                </h3>
                <p className="text-[11px] md:text-xs text-white/80 leading-snug mb-3">
                  {pet.desc}
                </p>
                <span className="inline-flex items-center gap-1 text-xs font-bold opacity-90 group-hover:gap-2 transition-all">
                  Ver produtos <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
