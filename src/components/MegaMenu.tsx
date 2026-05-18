import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Dog, Cat, Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Category = {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
};

type SectionKey = "cachorro" | "gato" | "clube";

const staticSections: { key: SectionKey; label: string; icon: React.ComponentType<{ className?: string }>; highlight?: boolean }[] = [
  { key: "cachorro", label: "Cachorro", icon: Dog },
  { key: "gato", label: "Gato", icon: Cat },
  { key: "clube", label: "Prapet Club", icon: Crown, highlight: true },
];

export const MegaMenu = () => {
  const [openKey, setOpenKey] = useState<SectionKey | null>(null);
  const [hoverCat, setHoverCat] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    supabase
      .from("categories")
      .select("id, name, slug, parent_id, sort_order")
      .order("sort_order", { ascending: true })
      .then(({ data }) => setCategories((data as Category[]) || []));
  }, []);

  const rootCats = categories.filter((c) => !c.parent_id);
  const childrenOf = (id: string) => categories.filter((c) => c.parent_id === id);

  const buildHref = (catSlug: string, sec: SectionKey) =>
    sec === "clube"
      ? `/catalogo?clube=1&categoria=${catSlug}`
      : `/catalogo?busca=${sec}&categoria=${catSlug}`;

  return (
    <div className="hidden lg:block border-t border-border bg-card relative">
      <div className="container mx-auto flex items-center gap-2">
        {staticSections.map((sec) => {
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
                  sec.highlight || isOpen
                    ? "text-secondary"
                    : "text-foreground hover:text-secondary"
                }`}
              >
                <Icon className="h-4 w-4" />
                {sec.label}
              </button>

              {isOpen && (
                <div className="absolute left-0 top-full z-50 flex bg-card border border-border shadow-2xl rounded-b-2xl overflow-hidden animate-fade-in-up min-w-[640px]">
                  <ul className="w-64 py-2 border-r border-border max-h-[70vh] overflow-y-auto">
                    {rootCats.length === 0 && (
                      <li className="px-5 py-3 text-xs text-muted-foreground">
                        Nenhuma categoria cadastrada
                      </li>
                    )}
                    {rootCats.map((cat) => {
                      const active = hoverCat === cat.id;
                      const subs = childrenOf(cat.id);
                      return (
                        <li key={cat.id} onMouseEnter={() => setHoverCat(cat.id)}>
                          <Link
                            to={buildHref(cat.slug, sec.key)}
                            className={`flex items-center justify-between px-5 py-2.5 text-sm transition-colors ${
                              active
                                ? "bg-secondary/10 text-secondary font-bold"
                                : "text-foreground hover:bg-muted"
                            }`}
                          >
                            {cat.name}
                            {subs.length > 0 && <ChevronRight className="h-4 w-4 opacity-60" />}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="w-64 py-2 bg-background max-h-[70vh] overflow-y-auto">
                    {(() => {
                      if (!hoverCat) {
                        return (
                          <div className="px-5 py-3 text-xs text-muted-foreground">
                            Passe o mouse sobre uma categoria
                          </div>
                        );
                      }
                      const subs = childrenOf(hoverCat);
                      if (subs.length === 0) {
                        return (
                          <div className="px-5 py-3 text-xs text-muted-foreground">
                            Sem subcategorias
                          </div>
                        );
                      }
                      return (
                        <ul>
                          {subs.map((sub) => (
                            <li key={sub.id}>
                              <Link
                                to={buildHref(sub.slug, sec.key)}
                                className="block px-5 py-2.5 text-sm text-foreground hover:bg-muted transition-colors"
                              >
                                {sub.name}
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
