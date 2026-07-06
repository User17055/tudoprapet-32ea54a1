import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Category } from "@/hooks/useCategoryTree";

export default function CategoriesTab() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .order("sort_order")
      .order("name");
    if (error) toast.error(error.message);
    setCategories((data || []) as Category[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Category[]>();
    for (const c of categories) {
      const key = c.parent_id ?? null;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return map;
  }, [categories]);

  const move = async (siblings: Category[], idx: number, dir: -1 | 1) => {
    if (!siblings[idx + dir]) return;

    const reordered = [...siblings];
    [reordered[idx], reordered[idx + dir]] = [reordered[idx + dir], reordered[idx]];

    // Regrava sort_order sequencial (0,1,2...) para o grupo: além de trocar as
    // duas posições, normaliza valores duplicados que impediriam a ordenação
    const changes = reordered
      .map((c, i) => ({ id: c.id, sort_order: i }))
      .filter((ch, i) => reordered[i].sort_order !== ch.sort_order);

    setSaving(true);
    const results = await Promise.all(
      changes.map((ch) =>
        supabase.from("categories").update({ sort_order: ch.sort_order }).eq("id", ch.id)
      )
    );
    setSaving(false);

    const failed = results.find((r) => r.error);
    if (failed?.error) {
      toast.error("Erro ao reordenar: " + failed.error.message);
      return;
    }
    load();
  };

  const renderGroup = (parentId: string | null, depth: number) => {
    const siblings = childrenOf.get(parentId) || [];
    return siblings.map((cat, i) => (
      <div key={cat.id} className="space-y-1">
        <div
          className="flex items-center gap-1 rounded-md border bg-card px-3 py-1.5"
          style={{ marginLeft: depth * 24 }}
        >
          <span className={`flex-1 text-sm ${depth === 0 ? "font-semibold" : ""}`}>
            {cat.name}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => move(siblings, i, -1)}
            disabled={saving || i === 0}
            title="Mover para cima"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => move(siblings, i, 1)}
            disabled={saving || i === siblings.length - 1}
            title="Mover para baixo"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
        </div>
        {renderGroup(cat.id, depth + 1)}
      </div>
    ));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ordem das Categorias</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Use as setas para reordenar. As categorias principais definem a ordem do menu no
          topo do site; as subcategorias, a ordem dentro de cada menu.
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : categories.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            Nenhuma categoria cadastrada.
          </p>
        ) : (
          <div className="space-y-1">{renderGroup(null, 0)}</div>
        )}
      </CardContent>
    </Card>
  );
}
