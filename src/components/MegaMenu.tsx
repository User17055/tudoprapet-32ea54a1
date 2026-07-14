import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { Category } from "@/hooks/useCategoryTree";

export interface MegaMenuItem {
  id: string;
  slug: string;
  label: string;
}

interface MegaMenuProps {
  items: MegaMenuItem[];
  childrenOf: Map<string, Category[]>;
  loading: boolean;
  isActive: (slug: string) => boolean;
}

export const MegaMenu = ({ items, childrenOf, loading, isActive }: MegaMenuProps) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const [activeChildId, setActiveChildId] = useState<string | null>(null);

  const openItem = (item: MegaMenuItem) => {
    setOpenId(item.id);
    setActiveChildId((childrenOf.get(item.id) || [])[0]?.id ?? null);
  };

  const close = () => {
    setOpenId(null);
    setActiveChildId(null);
  };

  if (loading) {
    return (
      <>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-16 rounded-full" />
        ))}
      </>
    );
  }

  return (
    <>
      {items.map((item) => {
        const kids = childrenOf.get(item.id) || [];
        const active = isActive(item.slug);
        const activeKid = kids.find((k) => k.id === activeChildId);
        const grandkids = activeKid ? childrenOf.get(activeKid.id) || [] : [];

        return (
          <div
            key={item.id}
            className="relative"
            onMouseEnter={() => openItem(item)}
            onMouseLeave={close}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) close();
            }}

            
          >
            <Link
              to={`/catalogo?categoria=${item.slug}&categoria_id=${item.id}`}
              onFocus={() => openItem(item)}
              aria-expanded={kids.length > 0 ? openId === item.id : undefined}
              className={`block rounded-full px-3 py-2 text-base font-semibold transition-all duration-200 ${
                active
                  ? "bg-primary/10 text-primary"
                  : "text-foreground hover:-translate-y-0.5 hover:bg-primary/5 hover:text-primary"
              }`}
            >
              {item.label}
            </Link>

            {openId === item.id && kids.length > 0 && (
              <div className="absolute left-0 top-full z-50 pt-2">
                <div className="flex bg-card shadow-xl overflow-hidden">
                  <div className="w-52 py-3">
                    {kids.map((kid) => {
                      const kidGrandkids = childrenOf.get(kid.id) || [];
                      return (
                        <Link
                          key={kid.id}
                          to={`/catalogo?categoria=${kid.slug}&categoria_id=${kid.id}`}
                          onMouseEnter={() => setActiveChildId(kid.id)}
                          className={`flex items-center justify-between gap-2 px-4 py-2 text-sm transition-colors ${
                            activeChildId === kid.id ? "text-primary font-semibold" : "hover:text-primary"
                          }`}
                        >
                          {kid.name}
                          {kidGrandkids.length > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                        </Link>
                      );
                    })}
                  </div>

                  {activeKid && grandkids.length > 0 && (
                    <div className="w-52 py-3">
                      {grandkids.map((gk) => (
                        <Link
                          key={gk.id}
                          to={`/catalogo?categoria=${gk.slug}&categoria_id=${gk.id}`}
                          className="block px-4 py-2 text-sm transition-colors hover:text-primary"
                        >
                          {gk.name}
                        </Link>
                      ))}
                      <Link
                        to={`/catalogo?categoria=${activeKid.slug}&categoria_id=${activeKid.id}`}
                        className="block px-4 py-2 text-sm font-semibold text-primary hover:underline"
                      >
                        Ver todos
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
};
