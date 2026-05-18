import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Dog, Cat, Crown } from "lucide-react";

type SubItem = { label: string; href: string };
type Category = { label: string; href: string; children?: SubItem[] };
type MenuSection = {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  highlight?: boolean;
  categories: Category[];
};

const buildPet = (pet: "cachorro" | "gato"): Category[] => [
  {
    label: "Ração",
    href: `/catalogo?busca=${pet}&categoria=racoes`,
    children: [
      { label: "Ração Seca", href: `/catalogo?busca=${pet}&categoria=racao-seca` },
      { label: "Ração Úmida", href: `/catalogo?busca=${pet}&categoria=racao-umida` },
      { label: "Ração Prescrita", href: `/catalogo?busca=${pet}&categoria=racao-prescrita` },
      { label: "Ração Natural", href: `/catalogo?busca=${pet}&categoria=racao-natural` },
      { label: "Ver todos", href: `/catalogo?busca=${pet}&categoria=racoes` },
    ],
  },
  { label: "Petiscos", href: `/catalogo?busca=${pet}&categoria=petiscos` },
  { label: "Areias e Banheiros", href: `/catalogo?busca=${pet}&categoria=areias` },
  { label: "Farmácia", href: `/catalogo?busca=${pet}&categoria=farmacia` },
  { label: "Arranhadores e Brinquedos", href: `/catalogo?busca=${pet}&categoria=brinquedos` },
  { label: "Beleza e Limpeza", href: `/catalogo?busca=${pet}&categoria=higiene` },
  { label: "Coleiras e Peitorais", href: `/catalogo?busca=${pet}&categoria=coleiras` },
  { label: "Acessórios de Alimentação", href: `/catalogo?busca=${pet}&categoria=alimentacao` },
  { label: "Acessórios de Transporte", href: `/catalogo?busca=${pet}&categoria=transporte` },
  { label: "Camas, Almofadas e Tocas", href: `/catalogo?busca=${pet}&categoria=camas` },
  { label: "Roupas", href: `/catalogo?busca=${pet}&categoria=roupas` },
  { label: "Raças", href: `/catalogo?busca=${pet}&categoria=racas` },
  { label: "Marcas", href: `/catalogo?busca=${pet}&categoria=marcas` },
];

const sections: MenuSection[] = [
  { key: "cachorro", label: "Cachorro", icon: Dog, categories: buildPet("cachorro") },
  { key: "gato", label: "Gato", icon: Cat, categories: buildPet("gato") },
  {
    key: "clube",
    label: "Prapet Club",
    icon: Crown,
    highlight: true,
    categories: [
      { label: "Conheça o Clube", href: "/clube" },
      { label: "Vantagens para assinantes", href: "/clube#vantagens" },
      { label: "Planos", href: "/clube#planos" },
      { label: "Catálogo Clube", href: "/catalogo?clube=1" },
    ],
  },
];

export const MegaMenu = () => {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [hoverCat, setHoverCat] = useState<string | null>(null);

  return (
    <div className="hidden lg:block border-t border-border bg-card relative">
      <div className="container mx-auto flex items-center gap-2">
        {sections.map((sec) => {
          const Icon = sec.icon;
          const isOpen = openKey === sec.key;
          return (
            <div
              key={sec.key}
              className="relative"
              onMouseEnter={() => {
                setOpenKey(sec.key);
                setHoverCat(null);
              }}
              onMouseLeave={() => {
                setOpenKey(null);
                setHoverCat(null);
              }}
            >
              <button
                className={`flex items-center gap-2 px-4 py-3 text-sm font-bold transition-colors ${
                  sec.highlight
                    ? "text-secondary"
                    : isOpen
                      ? "text-secondary"
                      : "text-foreground hover:text-secondary"
                }`}
              >
                <Icon className="h-4 w-4" />
                {sec.label}
              </button>

              {isOpen && (
                <div className="absolute left-0 top-full z-50 flex bg-card border border-border shadow-2xl rounded-b-2xl overflow-hidden animate-fade-in-up min-w-[640px]">
                  <ul className="w-64 py-2 border-r border-border">
                    {sec.categories.map((cat) => {
                      const active = hoverCat === cat.label;
                      return (
                        <li
                          key={cat.label}
                          onMouseEnter={() => setHoverCat(cat.label)}
                        >
                          <Link
                            to={cat.href}
                            className={`flex items-center justify-between px-5 py-2.5 text-sm transition-colors ${
                              active
                                ? "bg-secondary/10 text-secondary font-bold"
                                : "text-foreground hover:bg-muted"
                            }`}
                          >
                            {cat.label}
                            {cat.children && (
                              <ChevronRight className="h-4 w-4 opacity-60" />
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="w-64 py-2 bg-background">
                    {(() => {
                      const cat = sec.categories.find((c) => c.label === hoverCat);
                      if (!cat?.children) {
                        return (
                          <div className="px-5 py-3 text-xs text-muted-foreground">
                            Passe o mouse sobre uma categoria
                          </div>
                        );
                      }
                      return (
                        <ul>
                          {cat.children.map((sub) => (
                            <li key={sub.label}>
                              <Link
                                to={sub.href}
                                className={`block px-5 py-2.5 text-sm transition-colors ${
                                  sub.label === "Ver todos"
                                    ? "text-primary font-bold hover:underline"
                                    : "text-foreground hover:bg-muted"
                                }`}
                              >
                                {sub.label}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
