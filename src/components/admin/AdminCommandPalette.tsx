import { ExternalLink, History, LogOut, PanelLeft, RefreshCw } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { AdminNavGroup, AdminNavItem } from "@/components/admin/AdminSidebarNav";

interface AdminCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: AdminNavGroup[];
  /** Seções visitadas por último, mais recente primeiro. */
  recentIds: string[];
  activeId: string;
  onSelectSection: (id: string) => void;
  onRefresh: () => void;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
  onOpenStore: () => void;
  onLogout: () => void;
}

const itemClass =
  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 aria-selected:bg-accent aria-selected:text-accent-foreground";

const normalize = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Ranking da busca: nome da seção antes da descrição, e sem diferenciar acento
 * ("preco" acha "Preços"). O filtro difuso padrão do cmdk casava letras soltas
 * da descrição e punha "Administradores" acima de "Pedidos" ao digitar "ped".
 */
const rankCommand = (value: string, search: string, keywords?: string[]) => {
  const query = normalize(search.trim());
  if (!query) return 1;
  const name = normalize(value.replace(/^recente /, ""));
  const extra = normalize((keywords || []).join(" "));
  const startsWord = (text: string) => text.split(/\s+/).some((word) => word.startsWith(query));
  if (startsWord(name)) return 1;
  if (name.includes(query)) return 0.8;
  if (startsWord(extra)) return 0.5;
  if (extra.includes(query)) return 0.3;
  return 0;
};

/**
 * Paleta de comandos (Ctrl/⌘ + K): pula para qualquer seção do painel pelo nome
 * ou pela descrição, e reúne as ações da barra superior.
 */
export function AdminCommandPalette({
  open,
  onOpenChange,
  groups,
  recentIds,
  activeId,
  onSelectSection,
  onRefresh,
  onToggleSidebar,
  sidebarCollapsed,
  onOpenStore,
  onLogout,
}: AdminCommandPaletteProps) {
  const allItems = groups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label })));
  const recents = recentIds
    .filter((id) => id !== activeId)
    .map((id) => allItems.find((item) => item.id === id))
    .filter((item): item is AdminNavItem & { group: string } => Boolean(item))
    .slice(0, 4);

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  const sectionItem = (item: AdminNavItem & { group: string }, valuePrefix = "") => {
    const Icon = item.icon;
    return (
      <CommandItem
        key={`${valuePrefix}${item.id}`}
        value={`${valuePrefix}${item.group} ${item.label}`}
        keywords={[item.description, item.id]}
        onSelect={() => run(() => onSelectSection(item.id))}
        className={itemClass}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
          <Icon className="!h-4 !w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{item.label}</span>
          <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
        </span>
        {item.id === activeId && (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">Aberta</span>
        )}
      </CommandItem>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12vh] max-w-xl translate-y-0 gap-0 overflow-hidden p-0 data-[state=closed]:slide-out-to-top-[2%] data-[state=open]:slide-in-from-top-[2%]">
        <DialogTitle className="sr-only">Buscar no painel</DialogTitle>
        <DialogDescription className="sr-only">
          Digite o nome de uma seção ou de uma ação e pressione Enter.
        </DialogDescription>
        <Command filter={rankCommand} className="rounded-none [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.16em] [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]]:px-4 [&_[cmdk-input]]:h-14 [&_[cmdk-input]]:text-base">
          <CommandInput placeholder="Buscar seção ou ação..." />
          <CommandList className="max-h-[min(60vh,440px)] pb-2">
            <CommandEmpty className="py-10 text-center text-sm text-muted-foreground">
              Nada encontrado com esse nome.
            </CommandEmpty>

            {recents.length > 0 && (
              <CommandGroup heading="Recentes">
                {recents.map((item) => sectionItem(item, "recente "))}
              </CommandGroup>
            )}

            {groups.map((group) => (
              <CommandGroup key={group.label} heading={group.label}>
                {group.items.map((item) => sectionItem({ ...item, group: group.label }))}
              </CommandGroup>
            ))}

            <CommandSeparator className="my-1" />
            <CommandGroup heading="Ações">
              <CommandItem value="acao atualizar secao" keywords={["recarregar", "atualizar"]} onSelect={() => run(onRefresh)} className={itemClass}>
                <RefreshCw className="!h-4 !w-4 text-muted-foreground" />
                Atualizar a seção aberta
              </CommandItem>
              <CommandItem value="acao menu lateral" keywords={["sidebar", "recolher", "expandir"]} onSelect={() => run(onToggleSidebar)} className={itemClass}>
                <PanelLeft className="!h-4 !w-4 text-muted-foreground" />
                {sidebarCollapsed ? "Expandir o menu lateral" : "Recolher o menu lateral"}
              </CommandItem>
              <CommandItem value="acao ver loja" keywords={["site", "vitrine"]} onSelect={() => run(onOpenStore)} className={itemClass}>
                <ExternalLink className="!h-4 !w-4 text-muted-foreground" />
                Ver a loja
              </CommandItem>
              <CommandItem value="acao sair" keywords={["logout", "desconectar"]} onSelect={() => run(onLogout)} className={itemClass}>
                <LogOut className="!h-4 !w-4 text-destructive" />
                Sair da conta
              </CommandItem>
            </CommandGroup>
          </CommandList>
          <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/50 px-4 py-2.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <History className="h-3.5 w-3.5" />
              Recentes ficam salvas neste navegador
            </span>
            <span className="hidden items-center gap-1.5 sm:flex">
              <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-sans text-[10px] font-semibold">↑↓</kbd>
              navegar
              <kbd className="rounded border border-border bg-background px-1.5 py-0.5 font-sans text-[10px] font-semibold">Enter</kbd>
              abrir
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
