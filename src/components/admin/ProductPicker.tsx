import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Package, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import type { ShopifyProduct } from "@/lib/shopify";
import { isProductAvailable } from "@/lib/productAvailability";

interface Props {
  products: ShopifyProduct[];
  value: string;
  onChange: (productId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  excludeIds?: Set<string>;
  showAvailability?: boolean;
}

/**
 * Seletor de produto com busca e preview da imagem.
 * Usado em telas do admin onde antes tínhamos um <Select> simples.
 */
export function ProductPicker({
  products,
  value,
  onChange,
  placeholder = "Selecione um produto...",
  disabled,
  excludeIds,
  showAvailability = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const selected = products.find((p) => p.node.id === value)?.node;
  const selectedIsOutOfStock = selected
    ? !isProductAvailable({ node: selected })
    : false;

  const filtered = useMemo(() => {
    const normalize = (value: string) => value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    const q = normalize(query.trim());
    return products
      .filter((p) => (excludeIds ? !excludeIds.has(p.node.id) : true))
      .filter((p) => (q ? normalize(p.node.title).includes(q) : true))
      .slice(0, 100);
  }, [products, query, excludeIds]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="h-10 w-full justify-between px-3 font-normal"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
              {selected?.images.edges[0]?.node ? (
                <img
                  src={selected.images.edges[0].node.url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <Package className="h-4 w-4 text-muted-foreground" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-left" title={selected?.title}>
              {selected?.title || <span className="text-muted-foreground">{placeholder}</span>}
            </span>
            {showAvailability && selectedIsOutOfStock && (
              <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">
                Acabou
              </span>
            )}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-2rem)] max-w-[36rem] p-0"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-center gap-2 border-b p-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="Buscar produto..."
            className="h-9 min-w-0 flex-1 border-0 p-0 focus-visible:ring-0"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              Nenhum produto encontrado.
            </div>
          ) : (
            filtered.map((p) => {
              const img = p.node.images.edges[0]?.node;
              const isSelected = p.node.id === value;
              const isOutOfStock = !isProductAvailable(p);
              return (
                <button
                  key={p.node.id}
                  type="button"
                  onClick={() => {
                    onChange(p.node.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`flex w-full items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors ${
                    showAvailability && isOutOfStock
                      ? "border-red-200 bg-red-50 text-red-800 hover:bg-red-100"
                      : "border-transparent hover:bg-accent"
                  } ${
                    isSelected ? (showAvailability && isOutOfStock ? "ring-1 ring-red-400" : "bg-accent") : ""
                  }`}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {img ? (
                      <img src={img.url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Package className="h-4 w-4 text-muted-foreground" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{p.node.title}</span>
                  {showAvailability && isOutOfStock && (
                    <span className="shrink-0 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                      Acabou
                    </span>
                  )}
                  {isSelected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
