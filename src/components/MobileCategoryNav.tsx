import { useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import type { Category } from "@/hooks/useCategoryTree";
import type { MegaMenuItem } from "@/components/MegaMenu";

const catalogHref = (slug: string, id: string) => `/catalogo?categoria=${slug}&categoria_id=${id}`;

interface MobileCategoryNavProps {
  items: MegaMenuItem[];
  childrenOf: Map<string, Category[]>;
  isActive: (slug: string) => boolean;
  /** Fecha o menu hamburguer depois que o usuario escolhe uma categoria. */
  onNavigate: () => void;
}

/**
 * Navegacao de categorias do mobile, com os mesmos tres niveis que o MegaMenu
 * mostra no desktop.
 *
 * Os dois primeiros niveis ficam na sanfona do menu hamburguer. O terceiro abre
 * num painel de tela cheia: empilhar uma terceira sanfona deixaria o texto
 * espremido contra a margem e a rolagem longa demais numa tela de celular.
 */
export const MobileCategoryNav = ({ items, childrenOf, isActive, onNavigate }: MobileCategoryNavProps) => {
  const [drilldown, setDrilldown] = useState<Category | null>(null);
  const drilldownChildren = drilldown ? childrenOf.get(drilldown.id) || [] : [];

  const handleNavigate = () => {
    setDrilldown(null);
    onNavigate();
  };

  return (
    <>
      <Accordion type="single" collapsible>
        {items.map((item) => {
          const kids = childrenOf.get(item.id) || [];

          if (kids.length === 0) {
            return (
              <Link
                key={item.id}
                to={catalogHref(item.slug, item.id)}
                onClick={handleNavigate}
                className={`block border-b border-border py-3 text-sm font-medium transition-colors ${
                  isActive(item.slug) ? "text-primary font-semibold" : "text-foreground hover:text-primary"
                }`}
              >
                {item.label}
              </Link>
            );
          }

          return (
            <AccordionItem key={item.id} value={item.id}>
              <AccordionTrigger className="py-3 text-sm font-medium hover:no-underline">
                {item.label}
              </AccordionTrigger>
              <AccordionContent>
                <div className="flex flex-col gap-1 border-l border-border pl-3">
                  {/* Sem esta linha a categoria-mae fica inalcancavel no celular:
                      o gatilho da sanfona so expande, nunca navega. */}
                  <Link
                    to={catalogHref(item.slug, item.id)}
                    onClick={handleNavigate}
                    className="py-1.5 text-sm font-semibold text-primary"
                  >
                    Ver tudo em {item.label}
                  </Link>

                  {kids.map((kid) => {
                    const grandchildren = childrenOf.get(kid.id) || [];

                    if (grandchildren.length === 0) {
                      return (
                        <Link
                          key={kid.id}
                          to={catalogHref(kid.slug, kid.id)}
                          onClick={handleNavigate}
                          className="py-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
                        >
                          {kid.name}
                        </Link>
                      );
                    }

                    return (
                      <button
                        key={kid.id}
                        type="button"
                        onClick={() => setDrilldown(kid)}
                        className="flex items-center justify-between gap-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:text-primary"
                      >
                        <span>{kid.name}</span>
                        <ChevronRight className="h-4 w-4 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* Portal no body: o <nav> do menu usa animate-fade-in-up, e um ancestral com
          transform vira o bloco de contencao de qualquer position:fixed dentro dele —
          sem o portal o painel cobriria so a area do menu, nao a tela. */}
      {drilldown &&
        createPortal(
        <div
          role="dialog"
          aria-label={drilldown.name}
          className="fixed inset-0 z-50 flex flex-col bg-background duration-200 animate-in slide-in-from-right lg:hidden"
        >
          <div className="flex shrink-0 items-center border-b border-border px-4 py-3">
            <button
              type="button"
              onClick={() => setDrilldown(null)}
              className="-ml-1 flex items-center gap-1 text-sm font-medium text-primary"
            >
              <ChevronLeft className="h-5 w-5" />
              Voltar
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
            <h2 className="py-4 font-display text-lg font-bold">{drilldown.name}</h2>

            <Link
              to={catalogHref(drilldown.slug, drilldown.id)}
              onClick={handleNavigate}
              className="block border-b border-border py-3 text-sm font-semibold text-primary"
            >
              Ver tudo em {drilldown.name}
            </Link>

            {drilldownChildren.map((grandchild) => (
              <Link
                key={grandchild.id}
                to={catalogHref(grandchild.slug, grandchild.id)}
                onClick={handleNavigate}
                className="block border-b border-border py-3 text-sm text-foreground transition-colors hover:text-primary"
              >
                {grandchild.name}
              </Link>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
