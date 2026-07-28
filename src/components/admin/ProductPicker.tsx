import { useMemo, useState } from "react";
import { Check, ChevronDown, Package, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import type { ShopifyProduct } from "@/lib/shopify";

interface Props {
  products: ShopifyProduct[];
  value: string;
  onChange: (productId: string) => void;
  placeholder?: string;
  disabled?: boolean;
  excludeIds?: Set<string>;
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
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = products.find((p) => p.node.id === value)?.node;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products
      .filter((p) => (excludeIds ? !excludeIds.has(p.node.id) : true))
      .filter((p) => (q ? p.node.title.toLowerCase().includes(q) : true))
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
          <span className="flex min-w-0 items-center gap-2">
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
            <span className="truncate">
              {selected?.title || <span className="text-muted-foreground">{placeholder}</span>}
            </span>
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="flex items-center gap-2 border-b p-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar produto..."
            className="h-8 border-0 p-0 focus-visible:ring-0"
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
              return (
                <button
                  key={p.node.id}
                  type="button"
                  onClick={() => {
                    onChange(p.node.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={`flex w-full items-center gap-2 rounded-md p-2 text-left text-sm hover:bg-accent ${
                    isSelected ? "bg-accent" : ""
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
