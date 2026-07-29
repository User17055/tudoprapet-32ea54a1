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
    const children = childrenOf.get(item.id) || [];
    setOpenId(children.length > 0 ? item.id : null);
    setActiveChildId(children[0]?.id ?? null);
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
  const activeChild = openChildren.find((child) => child.id === activeChildId) || openChildren[0];
  const activeGrandchildren = activeChild ? childrenOf.get(activeChild.id) || [] : [];

  return (
    <div
      className="relative flex min-w-0 flex-1 items-stretch gap-7 xl:gap-10"
      onMouseLeave={close}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) close();
      }}
    >
      {items.map((item) => {
        const kids = childrenOf.get(item.id) || [];
        const selected = isActive(item.slug) || openId === item.id;

        return (
          <div key={item.id} className="flex items-stretch" onMouseEnter={() => openItem(item)}>
            <Link
              to={`/catalogo?categoria=${item.slug}&categoria_id=${item.id}`}
              onFocus={() => openItem(item)}
              onClick={close}
              aria-expanded={kids.length > 0 ? openId === item.id : undefined}
              className={`relative flex h-14 items-center whitespace-nowrap border-b-[3px] px-0 text-base font-bold transition-colors ${
                selected
                  ? "border-primary text-primary"
                  : "border-transparent text-foreground hover:border-primary/40 hover:text-primary"
              }`}
            >
              {item.label}
            </Link>
          </div>
        );
      })}

      {openItemData && activeChild && (
        <div className="absolute left-0 top-full z-50 w-[min(820px,calc(100vw-2rem))]">
          <div className="grid min-h-[300px] grid-cols-[minmax(280px,1fr)_minmax(260px,1fr)] overflow-hidden rounded-b-xl border border-t-0 border-border bg-card shadow-[0_20px_45px_-18px_rgba(15,23,42,0.35)]">
            <div className="border-r border-border/70 p-5">
              <div className="space-y-1">
                {openChildren.map((child) => {
                  const grandchildren = childrenOf.get(child.id) || [];
                  const isSelected = activeChild.id === child.id;

                  return (
                    <Link
                      key={child.id}
                      to={`/catalogo?categoria=${child.slug}&categoria_id=${child.id}`}
                      onMouseEnter={() => setActiveChildId(child.id)}
                      onFocus={() => setActiveChildId(child.id)}
                      onClick={close}
                      className={`flex min-h-11 items-center justify-between gap-3 rounded-md px-4 py-2.5 text-[15px] transition-colors ${
                        isSelected
                          ? "bg-primary/10 font-bold text-primary"
                          : "text-foreground hover:bg-muted hover:text-primary"
                      }`}
                    >
                      <span>{child.name}</span>
                      {grandchildren.length > 0 && <ChevronRight className="h-4 w-4 shrink-0" />}
                    </Link>
                  );
                })}
              </div>
            </div>

            <div className="p-7">
              <h3 className="mb-4 text-sm font-extrabold uppercase tracking-wide text-primary">
                {activeChild.name}
              </h3>
              <div className="space-y-1">
                {activeGrandchildren.map((grandchild) => (
                  <Link
                    key={grandchild.id}
                    to={`/catalogo?categoria=${grandchild.slug}&categoria_id=${grandchild.id}`}
                    onClick={close}
                    className="block rounded-md px-2 py-2.5 text-[15px] text-foreground transition-colors hover:bg-muted hover:text-primary"
                  >
                    {grandchild.name}
                  </Link>
                ))}
                <Link
                  to={`/catalogo?categoria=${activeChild.slug}&categoria_id=${activeChild.id}`}
                  onClick={close}
                  className="mt-2 block px-2 py-2.5 text-[15px] font-extrabold text-primary hover:underline"
                >
                  Ver todos
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
