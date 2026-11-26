import { useState } from "react";
import { AlertTriangle, CloudDownload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { invokeOlistCatalog } from "@/lib/olistCatalogApi";
import type { OlistCatalogData } from "@/lib/olistCatalogData";
import { SNAPSHOT_MAX_AGE_HOURS, shortDateTime, snapshotAgeHours } from "@/lib/olistComparison";

interface Props {
  data: OlistCatalogData | null;
  unavailable: boolean;
  onReloaded: () => void | Promise<void>;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}

export function OlistCatalogPanel({ data, unavailable, onReloaded, busy, onBusyChange }: Props) {
  const [progress, setProgress] = useState<{ page: number; total: number; step: string } | null>(null);
  const run = data?.lastCatalogRun ?? null;
  const applyRun = data?.lastApplyRun ?? null;
  const age = snapshotAgeHours(run?.finishedAt);
  const stale = age === null || age > SNAPSHOT_MAX_AGE_HOURS;

  const readCatalog = async () => {
    onBusyChange(true);
    let runId: string | undefined;
    // Cada pedido faz uma chamada à Olist; quando o limite por minuto enche,
    // a tela avisa e continua sozinha depois da espera.
    let current = { page: 1, total: 1, step: "" };
    const show = (next: typeof current) => {
      current = next;
      setProgress(next);
    };
    const onWait = (seconds: number) =>
      setProgress({
        ...current,
        step: `${current.step} · limite de chamadas da Olist por minuto (o checkout tem prioridade): continua sozinho em ${seconds} s`,
      });
    try {
      let total = 1;
      for (let page = 1; page <= total; page += 1) {
        show({ page, total, step: `Lendo produtos da Olist (página ${page} de ${total})` });
        const response = await invokeOlistCatalog({ action: "catalog_page", page, runId }, onWait);
        runId = response.runId;
        total = Math.max(page, response.totalPages ?? page);
      }
      show({ page: 0, total: 1, step: "Lendo listas de preço da Olist" });
      const lists = await invokeOlistCatalog({ action: "price_lists", runId }, onWait);
      for (const list of lists.priceLists ?? []) {
        let listTotal = 1;
        for (let page = 1; page <= listTotal; page += 1) {
          show({ page, total: listTotal, step: `Lendo a lista "${list.name}" (página ${page} de ${listTotal})` });
          const response = await invokeOlistCatalog({ action: "price_list_page", runId, listId: list.id, page }, onWait);
          listTotal = Math.max(page, response.totalPages ?? page);
        }
      }
      show({ page: 1, total: 1, step: "Conferindo a leitura" });
      const finished = await invokeOlistCatalog({ action: "finish", runId });
      if (finished.failed) throw new Error(finished.error || "Leitura incompleta");
      const listCount = lists.priceLists?.length ?? lists.lists ?? 0;
      toast.success("Catálogo da Olist lido.", {
        description: `${total} página${total === 1 ? "" : "s"} de produtos e ${listCount} lista${listCount === 1 ? "" : "s"} de preço. Nada foi alterado no site nem na Olist.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado";
      if (runId && !/Leitura incompleta/.test(message)) {
        await invokeOlistCatalog({ action: "finish", runId, error: message }).catch(() => undefined);
      }
      toast.error("Não foi possível ler o catálogo da Olist.", { description: message, duration: 12000 });
    } finally {
      setProgress(null);
      onBusyChange(false);
      await onReloaded();
    }
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1 text-sm">
          <p className="font-medium">Catálogo da Olist</p>
          {unavailable ? (
            <p className="text-xs text-muted-foreground">
              Aguardando a publicação das tabelas novas. Até lá, use o botão de cada produto.
            </p>
          ) : run ? (
            <p className={`text-xs ${stale ? "text-amber-700" : "text-muted-foreground"}`}>
              Lido em {shortDateTime(run.finishedAt)} · {data?.products.length ?? run.products} produtos ·{" "}
              {run.priceLists} lista{run.priceLists === 1 ? "" : "s"} de preço ({run.exceptions} preços próprios)
              {stale ? ` · mais de ${SNAPSHOT_MAX_AGE_HOURS} h: leia de novo antes de aplicar` : ""}
            </p>
          ) : (
            <p className="text-xs text-amber-700">Ainda não lido. Leia o catálogo para comparar e aplicar em lote.</p>
          )}
          {applyRun && (
            <p className="text-xs text-muted-foreground">
              Última aplicação: {shortDateTime(applyRun.finishedAt ?? applyRun.startedAt)} · {applyRun.applied} conferidos,{" "}
              {applyRun.changed} com valor alterado
              {applyRun.notFound ? ` · ${applyRun.notFound} fora do catálogo` : ""}
              {applyRun.failed ? ` · ${applyRun.failed} com erro` : ""}
              {applyRun.status === "running" ? " · interrompida" : ""}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Mão única: a Olist alimenta o site. Ler e aplicar nunca alteram nada na Olist. A leitura leva 1 a 2
            minutos (cerca de 23 chamadas, dentro do limite por minuto da Olist).
          </p>
        </div>
        <Button variant="outline" onClick={readCatalog} disabled={busy || unavailable} className="shrink-0">
          {progress ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudDownload className="mr-2 h-4 w-4" />}
          Ler catálogo da Olist
        </Button>
      </div>
      {progress && (
        <div className="mt-3 space-y-1">
          <Progress value={(progress.page / Math.max(progress.total, 1)) * 100} />
          <p className="text-xs text-muted-foreground">{progress.step}</p>
        </div>
      )}
      {!unavailable && run && stale && !progress && (
        <p className="mt-2 flex items-center gap-1 text-xs text-amber-700">
          <AlertTriangle className="h-3 w-3" /> O retrato pode estar desatualizado.
        </p>
      )}
    </div>
  );
}
