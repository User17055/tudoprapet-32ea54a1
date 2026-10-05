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
  isActive: (id: string) => boolean;
}

export const MegaMenu = ({ items, childrenOf, loading, isActive }: MegaMenuProps) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const [activeChildId, setActiveChildId] = useState<string | null>(null);

  const openItem = (item: MegaMenuItem) => {
    const children = childrenOf.get(item.id) || [];
    setOpenId(children.length > 0 ? item.id : null);
    setActiveChildId(null);
  };

  const close = () => {
    setOpenId(null);
    setActiveChildId(null);
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center gap-8">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-24" />
        ))}
      </div>
    );
  }

  const openItemData = items.find((item) => item.id === openId);
  const openChildren = openItemData ? childrenOf.get(openItemData.id) || [] : [];
  const activeChild = openChildren.find((child) => child.id === activeChildId);
  const activeGrandchildren = activeChild ? childrenOf.get(activeChild.id) || [] : [];

  return (
    <div
      className="relative flex min-w-0 flex-1 items-stretch gap-5"
      onMouseLeave={close}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) close();
      }}
    >
      {items.map((item) => {
        const kids = childrenOf.get(item.id) || [];
        const selected = isActive(item.id) || openId === item.id;

        return (
          <div key={item.id} className="flex items-stretch" onMouseEnter={() => openItem(item)}>
            <Link
              to={`/catalogo?categoria=${item.slug}&categoria_id=${item.id}`}
              onFocus={() => openItem(item)}
              onClick={close}
              aria-expanded={kids.length > 0 ? openId === item.id : undefined}
              className={`group relative flex h-14 items-center whitespace-nowrap px-0 text-base font-bold transition-colors duration-200 after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-full after:origin-left after:scale-x-0 after:rounded-full after:bg-primary after:transition-transform after:duration-200 hover:after:scale-x-100 ${
                selected
                  ? "text-primary after:scale-x-100"
                  : "text-foreground hover:text-primary"
              }`}
            >
              <span className="transition-transform duration-200 group-hover:-translate-y-0.5">
                {item.label}
              </span>
            </Link>
          </div>
        );
      })}

      {openItemData && openChildren.length > 0 && (
        <div className="absolute left-0 top-full z-50 w-[min(260px,calc(100vw-2rem))] origin-top-left animate-in fade-in-0 slide-in-from-top-1 duration-300">
          <div className="relative min-h-[230px] rounded-b-lg bg-card shadow-[0_18px_38px_-18px_rgba(15,23,42,0.32)]">
            <div className="p-3">
              <div className="space-y-0.5">
                {openChildren.map((child) => {
                  const grandchildren = childrenOf.get(child.id) || [];
                  const isSelected = activeChild?.id === child.id;

                  return (
                    <Link
                      key={child.id}
                      to={`/catalogo?categoria=${child.slug}&categoria_id=${child.id}`}
                      onMouseEnter={() => setActiveChildId(child.id)}
                      onFocus={() => setActiveChildId(child.id)}
                      onClick={close}
                      className={`flex min-h-9 items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm transition-colors duration-200 ${
                        isSelected
                          ? "bg-primary/10 font-bold text-primary"
                          : "text-foreground hover:bg-primary/10 hover:text-primary"
                      }`}
                    >
                      <span>{child.name}</span>
                      {grandchildren.length > 0 && <ChevronRight className="h-4 w-4 shrink-0" />}
                    </Link>
                  );
                })}
              </div>
            </div>

            {activeChild && (
              <div
                key={activeChild.id}
                className="absolute left-full top-0 min-h-full w-[min(320px,calc(100vw-292px))] animate-in fade-in-0 rounded-b-lg bg-card p-4 shadow-[0_18px_38px_-18px_rgba(15,23,42,0.32)] duration-150"
              >
                <div className="space-y-0.5">
                  {activeGrandchildren.map((grandchild) => (
                    <Link
                      key={grandchild.id}
                      to={`/catalogo?categoria=${grandchild.slug}&categoria_id=${grandchild.id}`}
                      onClick={close}
                      className="block rounded-md px-3 py-1.5 text-sm text-foreground transition-colors duration-200 hover:bg-primary/10 hover:text-primary"
                    >
                      {grandchild.name}
                    </Link>
                  ))}
                  <Link
                    to={`/catalogo?categoria=${activeChild.slug}&categoria_id=${activeChild.id}`}
                    onClick={close}
                    className="mt-1.5 block px-3 py-1.5 text-sm font-extrabold text-primary hover:underline"
                  >
                    Ver todos
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
