import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

type Category = { id: string; name: string; parent_id: string | null; sort_order: number };
type Rule = { category_id: string; percent: number | string; updated_at: string };

export function SubscriberCategoryMarginsCard({ onPricesChanged }: { onPricesChanged: () => void }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [percent, setPercent] = useState("5");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("admin-subscriber-margins", { body });
    if (error || data?.error) throw new Error(data?.error || error?.message || "Falha ao atualizar percentuais");
    return data;
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await invoke({ action: "list" });
      setCategories(data.categories || []);
      setRules(data.rules || []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao carregar percentuais");
    } finally {
      setLoading(false);
    }
  }, [invoke]);
  useEffect(() => { void load(); }, [load]);

  const paths = useMemo(() => {
    const byId = new Map(categories.map((category) => [category.id, category]));
    return new Map(categories.map((category) => {
      const names: string[] = [];
      let current: Category | undefined = category;
      const seen = new Set<string>();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        names.unshift(current.name);
        current = current.parent_id ? byId.get(current.parent_id) : undefined;
      }
      return [category.id, names.join(" › ")];
    }));
  }, [categories]);

  const save = async () => {
    const numeric = Number(percent.replace(",", "."));
    if (!categoryId || !Number.isFinite(numeric) || numeric < 0 || numeric > 500) {
      toast.error("Escolha a categoria e informe um percentual válido.");
      return;
    }
    setBusyId(categoryId);
    try {
      const data = await invoke({ action: "save", categoryId, percent: numeric });
      toast.success(`Regra salva. ${data.repriced || 0} preços recalculados.`);
      await load();
      onPricesChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar regra");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      const data = await invoke({ action: "delete", categoryId: id });
      toast.success(`Regra removida. ${data.repriced || 0} preços recalculados.`);
      await load();
      onPricesChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover regra");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="p-4 pb-3">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-sky-100 p-2 text-sky-700"><Tags className="h-5 w-5" /></span>
          <div>
            <CardTitle className="text-base">Margem do assinante por categoria</CardTitle>
            <CardDescription>
              Percentual sobre o custo Olist. A categoria mais específica prevalece: Cães › Medicamentos › Antipulgas.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-semibold">Regra automática para o grupo Ração</p>
          <p className="mt-1">Até 7,5 kg: custo Olist + 60%. Acima de 7,5 kg: custo Olist + 40%. Essa regra prevalece sobre o percentual comum da categoria.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_130px_auto]">
          <Select value={categoryId} onValueChange={setCategoryId} disabled={loading || Boolean(busyId)}>
            <SelectTrigger><SelectValue placeholder="Escolha uma categoria" /></SelectTrigger>
            <SelectContent>{categories
              .slice()
              .sort((a, b) => (paths.get(a.id) || "").localeCompare(paths.get(b.id) || "", "pt-BR"))
              .map((category) => <SelectItem key={category.id} value={category.id}>{paths.get(category.id)}</SelectItem>)}</SelectContent>
          </Select>
          <div className="relative"><Input value={percent} onChange={(event) => setPercent(event.target.value)} inputMode="decimal" className="pr-8" aria-label="Percentual sobre o custo" /><span className="absolute right-3 top-2.5 text-sm text-muted-foreground">%</span></div>
          <Button onClick={() => void save()} disabled={loading || Boolean(busyId)}>
            {busyId === categoryId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Salvar regra
          </Button>
        </div>

        {loading ? <div className="flex justify-center py-5"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div> : rules.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhuma regra cadastrada. Todos os produtos usam o padrão de 5% sobre o custo.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {rules.slice().sort((a, b) => (paths.get(a.category_id) || "").localeCompare(paths.get(b.category_id) || "", "pt-BR")).map((rule) => (
              <div key={rule.category_id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <div className="min-w-0"><p className="truncate text-sm font-medium">{paths.get(rule.category_id) || "Categoria removida"}</p><p className="text-xs text-sky-700">Custo + {Number(rule.percent).toLocaleString("pt-BR")} %</p></div>
                <Button variant="ghost" size="icon" className="shrink-0 text-destructive" disabled={Boolean(busyId)} onClick={() => void remove(rule.category_id)} aria-label="Remover regra">
                  {busyId === rule.category_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </Button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Ao salvar ou remover uma regra, todos os produtos com custo importado são recalculados automaticamente.</p>
      </CardContent>
    </Card>
  );
}
