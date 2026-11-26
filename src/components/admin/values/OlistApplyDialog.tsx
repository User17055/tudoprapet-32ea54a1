import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { invokeOlistCatalog } from "@/lib/olistCatalogApi";

export interface ApplyTarget {
  productId: string;
  variantId: string;
  sku: string;
  weightKg: number | null;
  title: string;
  /** Venda normal efetiva (Valor do Cliente ou Shopify), para saber o que fica bloqueado. */
  salePrice: number | null;
}

type BeforeAfter = { before: number | null; after: number | null };
type Plan = {
  variantId: string;
  sku: string;
  status: "ok" | "not_in_catalog" | "no_cost" | "duplicate_sku" | "error";
  olistName: string | null;
  cost: BeforeAfter;
  franchise: BeforeAfter;
  subscriber: BeforeAfter;
  changed: boolean;
  error?: string;
};

const SIMULATE_CHUNK = 100;
const APPLY_CHUNK = 50;

const money = (value: number | null) =>
  value === null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const blocked = (sale: number | null, cost: number | null) => sale !== null && cost !== null && sale <= cost + 0.005;

function Change({ value }: { value: BeforeAfter }) {
  const same = value.before !== null && value.after !== null && Math.abs(value.before - value.after) < 0.005;
  if (same || value.after === null) return <span className="text-muted-foreground">{money(value.before)}</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted-foreground line-through">{money(value.before)}</span>{" "}
      <span className="font-medium">{money(value.after)}</span>
    </span>
  );
}

interface Props {
  targets: ApplyTarget[];
  open: boolean;
  onClose: () => void;
  onApplied: () => void | Promise<void>;
  /** SKUs fora do retrato: consulta 1 a 1 pelo caminho antigo. */
  onFallback: (targets: ApplyTarget[]) => void;
  onBusyChange: (busy: boolean) => void;
}

export function OlistApplyDialog({ targets, open, onClose, onApplied, onFallback, onBusyChange }: Props) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPlans(null);
    setApplied(false);
    let cancelled = false;
    (async () => {
      onBusyChange(true);
      try {
        const all: Plan[] = [];
        for (let index = 0; index < targets.length; index += SIMULATE_CHUNK) {
          if (cancelled) return;
          setProgress({ done: index, total: targets.length, label: "Simulando" });
          const chunk = targets.slice(index, index + SIMULATE_CHUNK).map(({ productId, variantId, sku, weightKg }) => ({ productId, variantId, sku, weightKg }));
          const response = await invokeOlistCatalog({ action: "apply", dryRun: true, items: chunk }) as { results?: Plan[] };
          all.push(...(response.results ?? []));
        }
        if (!cancelled) setPlans(all);
      } catch (error) {
        if (!cancelled) {
          toast.error("Não foi possível simular.", { description: error instanceof Error ? error.message : undefined });
          onClose();
        }
      } finally {
        if (!cancelled) setProgress(null);
        onBusyChange(false);
      }
    })();
    return () => { cancelled = true; };
    // A simulação roda uma vez por abertura, com os itens daquele momento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const byVariant = useMemo(() => new Map(targets.map((target) => [target.variantId, target])), [targets]);

  const summary = useMemo(() => {
    const list = plans ?? [];
    const ok = list.filter((plan) => plan.status === "ok");
    const changes = (key: "cost" | "franchise" | "subscriber") => ok.filter((plan) => {
      const value = plan[key];
      return value.after !== null && (value.before === null || Math.abs(value.before - value.after) >= 0.005);
    }).length;
    const sale = (plan: Plan) => byVariant.get(plan.variantId)?.salePrice ?? null;
    return {
      ok: ok.length,
      changed: ok.filter((plan) => plan.changed).length,
      cost: changes("cost"),
      franchise: changes("franchise"),
      subscriber: changes("subscriber"),
      notInCatalog: list.filter((plan) => plan.status === "not_in_catalog"),
      noCost: list.filter((plan) => plan.status === "no_cost"),
      duplicate: list.filter((plan) => plan.status === "duplicate_sku"),
      errors: list.filter((plan) => plan.status === "error"),
      newlyBlocked: ok.filter((plan) => !blocked(sale(plan), plan.cost.before) && blocked(sale(plan), plan.cost.after)),
      unblocked: ok.filter((plan) => blocked(sale(plan), plan.cost.before) && !blocked(sale(plan), plan.cost.after)),
    };
  }, [plans, byVariant]);

  const apply = async () => {
    if (!plans) return;
    const okIds = new Set(plans.filter((plan) => plan.status === "ok").map((plan) => plan.variantId));
    const items = targets.filter((target) => okIds.has(target.variantId));
    onBusyChange(true);
    let runId: string | undefined;
    const results: Plan[] = [];
    try {
      for (let index = 0; index < items.length; index += APPLY_CHUNK) {
        setProgress({ done: index, total: items.length, label: "Aplicando no site" });
        const chunk = items.slice(index, index + APPLY_CHUNK).map(({ productId, variantId, sku, weightKg }) => ({ productId, variantId, sku, weightKg }));
        const response = await invokeOlistCatalog({ action: "apply", items: chunk, runId }) as { runId?: string; results?: Plan[] };
        runId = response.runId ?? runId;
        results.push(...(response.results ?? []));
      }
      const failed = results.filter((plan) => plan.status === "error").length;
      if (runId) {
        await invokeOlistCatalog({
          action: "finish",
          runId,
          notFound: summary.notInCatalog.length + summary.noCost.length + summary.duplicate.length,
          failed: 0,
        });
      }
      setPlans((current) => (current ?? []).map((plan) => results.find((result) => result.variantId === plan.variantId) ?? plan));
      setApplied(true);
      if (failed) toast.warning(`${results.length - failed} aplicados; ${failed} com erro.`);
      else toast.success(`${results.length} produto${results.length === 1 ? "" : "s"} conferido${results.length === 1 ? "" : "s"} pela Olist.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado";
      if (runId) await invokeOlistCatalog({ action: "finish", runId, error: message }).catch(() => undefined);
      toast.error("A aplicação parou no meio.", { description: `${results.length} de ${items.length} gravados. ${message}`, duration: 12000 });
    } finally {
      setProgress(null);
      onBusyChange(false);
      await onApplied();
    }
  };

  const changedPlans = (plans ?? []).filter((plan) => plan.status === "ok" && plan.changed);
  const fallbackTargets = summary.notInCatalog.map((plan) => byVariant.get(plan.variantId)).filter((target): target is ApplyTarget => Boolean(target));

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !progress) onClose(); }}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{applied ? "Resultado da aplicação" : "Simulação: atualizar pela Olist"}</DialogTitle>
          <DialogDescription>
            {targets.length} variante{targets.length === 1 ? "" : "s"} selecionada{targets.length === 1 ? "" : "s"}. Usa o catálogo já lido;
            não consulta nem altera a Olist. Grava custo, franquia (= custo) e assinante (custo + margem da categoria).
            O preço normal da Shopify e o Valor do Cliente não mudam.
          </DialogDescription>
        </DialogHeader>

        {progress && (
          <div className="space-y-1">
            <Progress value={(progress.done / Math.max(progress.total, 1)) * 100} />
            <p className="text-xs text-muted-foreground">{progress.label}: {progress.done} de {progress.total}</p>
          </div>
        )}

        {plans && (
          <div className="space-y-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Encontrados na Olist</p><p className="text-lg font-bold">{summary.ok}</p><p className="text-xs text-muted-foreground">{summary.changed} com algum valor diferente</p></div>
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Mudam</p><p className="text-sm">{summary.cost} custos · {summary.franchise} franquias · {summary.subscriber} assinantes</p></div>
              <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Venda normal ≤ custo</p><p className="text-sm"><span className="font-medium text-red-700">{summary.newlyBlocked.length} passam a ficar bloqueados</span> · <span className="font-medium text-emerald-700">{summary.unblocked.length} liberados</span></p></div>
            </div>

            {(summary.notInCatalog.length > 0 || summary.noCost.length > 0 || summary.duplicate.length > 0 || summary.errors.length > 0) && (
              <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                {summary.notInCatalog.length > 0 && <p>{summary.notInCatalog.length} SKU fora do catálogo lido (inativo ou inexistente na Olist): {summary.notInCatalog.slice(0, 15).map((plan) => plan.sku).join(", ")}{summary.notInCatalog.length > 15 ? "…" : ""}</p>}
                {summary.noCost.length > 0 && <p>{summary.noCost.length} sem preço de custo na Olist (nada é gravado): {summary.noCost.slice(0, 15).map((plan) => plan.sku).join(", ")}</p>}
                {summary.duplicate.length > 0 && <p>{summary.duplicate.length} SKU repetido na Olist com custos diferentes (nada é gravado): {summary.duplicate.map((plan) => plan.sku).join(", ")}</p>}
                {summary.errors.length > 0 && <p>{summary.errors.length} com erro ao gravar: {summary.errors.map((plan) => `${plan.sku} (${plan.error})`).join("; ")}</p>}
              </div>
            )}

            {summary.newlyBlocked.length > 0 && (
              <p className="text-xs text-red-700">
                Ficam bloqueados para cliente comum (venda normal igual ou abaixo do custo novo):{" "}
                {summary.newlyBlocked.map((plan) => byVariant.get(plan.variantId)?.title ?? plan.sku).join("; ")}
              </p>
            )}

            {changedPlans.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Custo</TableHead><TableHead>Franquia</TableHead><TableHead>Assinante</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {changedPlans.slice(0, 300).map((plan) => (
                      <TableRow key={plan.variantId}>
                        <TableCell className="max-w-[280px]"><p className="truncate text-xs font-medium">{byVariant.get(plan.variantId)?.title ?? plan.olistName}</p><p className="text-[11px] text-muted-foreground">SKU {plan.sku}</p></TableCell>
                        <TableCell className="text-xs"><Change value={plan.cost} /></TableCell>
                        <TableCell className="text-xs"><Change value={plan.franchise} /></TableCell>
                        <TableCell className="text-xs"><Change value={plan.subscriber} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {changedPlans.length > 300 && <p className="p-2 text-xs text-muted-foreground">Mostrando 300 de {changedPlans.length}.</p>}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhum valor muda: aplicar só registra a data de conferência.</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {plans && fallbackTargets.length > 0 && (
            <Button variant="outline" disabled={Boolean(progress)} onClick={() => { onFallback(fallbackTargets); onClose(); }}>
              Consultar na Olist 1 a 1 os {fallbackTargets.length} fora do catálogo
            </Button>
          )}
          {!applied ? (
            <Button disabled={!plans || Boolean(progress) || summary.ok === 0} onClick={apply}>
              {progress ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Aplicar no site ({summary.ok})
            </Button>
          ) : (
            <Button onClick={onClose}>Fechar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
