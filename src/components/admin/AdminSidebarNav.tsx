import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface AdminNavItem {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

interface AdminSidebarNavProps {
  groups: AdminNavGroup[];
  activeId: string;
  /** Só ícones: o nome aparece no tooltip. */
  collapsed?: boolean;
  onSelect: (id: string) => void;
}

/** Lista de seções do painel, usada no menu lateral e na gaveta do celular. */
export function AdminSidebarNav({ groups, activeId, collapsed = false, onSelect }: AdminSidebarNavProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Seções do fim da lista (Relatório, Manutenção) ficavam fora da área visível
  // do menu quando abertas por link ou pela busca.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeId, collapsed]);

  return (
    <nav aria-label="Seções do painel" className="space-y-5">
      {groups.map((group) => (
        <div key={group.label}>
          {collapsed ? (
            <div className="mx-auto mb-2 h-px w-6 bg-[hsl(var(--admin-sidebar-border))]" aria-hidden="true" />
          ) : (
            <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[hsl(var(--admin-sidebar-muted))]">
              {group.label}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const selected = item.id === activeId;
              const button = (
                <button
                  ref={selected ? activeRef : undefined}
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-current={selected ? "page" : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={cn(
                    "group relative flex w-full items-center gap-3 rounded-lg text-left text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[hsl(var(--admin-gold))]",
                    collapsed ? "h-10 justify-center" : "px-3 py-2",
                    selected
                      ? "bg-[hsl(var(--admin-sidebar-active))] text-white"
                      : "text-[hsl(var(--admin-sidebar-foreground))] hover:bg-[hsl(var(--admin-sidebar-hover))] hover:text-white",
                  )}
                >
                  {selected && (
                    <span
                      className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-[hsl(var(--admin-gold))]"
                      aria-hidden="true"
                    />
                  )}
                  <Icon
                    className={cn(
                      "h-[18px] w-[18px] shrink-0 transition-colors",
                      selected
                        ? "text-[hsl(var(--admin-gold))]"
                        : "text-[hsl(var(--admin-sidebar-muted))] group-hover:text-white",
                    )}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </button>
              );

              return (
                <li key={item.id}>
                  {collapsed ? (
                    <Tooltip delayDuration={100}>
                      <TooltipTrigger asChild>{button}</TooltipTrigger>
                      <TooltipContent side="right" sideOffset={10}>
                        <p className="font-semibold">{item.label}</p>
                        <p className="text-xs text-muted-foreground">{item.description}</p>
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    button
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
