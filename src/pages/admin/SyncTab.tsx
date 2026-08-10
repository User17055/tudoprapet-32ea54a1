import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, GitBranch, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Commit = {
  sha: string;
  message: string;
  author?: string | null;
  date?: string | null;
  url?: string | null;
};

type SyncStatus = {
  configured: boolean;
  message?: string;
  repo?: string;
  work_branch?: string;
  work_branch_exists?: boolean;
  in_sync?: boolean;
  ahead_by?: number;
  behind_by?: number;
  pending_commits?: Commit[];
  main?: { sha: string; message: string; date?: string | null };
  main_commits?: Commit[];
  work?: { sha: string; message: string; date?: string | null } | null;
  functions_version?: string;
  checked_at?: string;
};


const REFRESH_MS = 60_000;

function when(iso?: string | null) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR");
}

export default function SyncTab() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const wasOutOfSync = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("git-sync-status");
      if (error) throw error;
      const next = data as SyncStatus;
      // Avisa no momento exato em que a main passa a ter todos os commits.
      if (next.configured && next.in_sync && wasOutOfSync.current) {
        toast.success("Commits sincronizados na main", {
          description: "Tudo que estava na branch já está publicado na main.",
        });
      }
      wasOutOfSync.current = Boolean(next.configured && !next.in_sync);
      setStatus(next);
    } catch (e) {
      if (!silent) {
        toast.error("Não foi possível verificar a sincronização", {
          description: e instanceof Error ? e.message : undefined,
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const pending = status?.pending_commits ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Sincronização de código</h2>
          <p className="text-sm text-muted-foreground">
            Verificação automática a cada minuto: mostra se os commits da branch de trabalho já
            chegaram à main.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="ml-2">Verificar</span>
        </Button>
      </div>

      {loading && !status ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Consultando o repositório...
        </div>
      ) : status && !status.configured ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="h-4 w-4" /> Configuração pendente
            </CardTitle>
            <CardDescription>{status.message}</CardDescription>
          </CardHeader>
        </Card>
      ) : status ? (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {status.in_sync ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : (
                  <TriangleAlert className="h-5 w-5 text-amber-600" />
                )}
                {status.in_sync
                  ? "Tudo sincronizado na main"
                  : `${pending.length} commit(s) ainda fora da main`}
              </CardTitle>
              <CardDescription>
                {status.repo} · branch <strong>{status.work_branch}</strong> · última verificação{" "}
                {when(status.checked_at)}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-md border p-3">
                <div className="mb-1 flex items-center gap-2 font-medium">
                  <GitBranch className="h-4 w-4" /> main
                </div>
                <div className="font-mono text-xs">{status.main?.sha}</div>
                <div className="text-muted-foreground">{status.main?.message}</div>
                <div className="text-xs text-muted-foreground">{when(status.main?.date)}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="mb-1 flex items-center gap-2 font-medium">
                  <GitBranch className="h-4 w-4" /> {status.work_branch}
                </div>
                <div className="font-mono text-xs">{status.work?.sha}</div>
                <div className="text-muted-foreground">{status.work?.message}</div>
                <div className="text-xs text-muted-foreground">{when(status.work?.date)}</div>
              </div>
            </CardContent>
          </Card>

          {pending.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Commits pendentes de merge</CardTitle>
                <CardDescription>
                  Abra um Pull Request de {status.work_branch} → main para publicá-los.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {pending.map((c) => (
                  <div key={c.sha} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                    <Badge variant="secondary" className="font-mono">{c.sha}</Badge>
                    <span className="flex-1">{c.message}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.author} · {when(c.date)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <p className="text-xs text-muted-foreground">
            Edge functions publicadas: versão {status.functions_version}
          </p>
        </>
      ) : null}
    </div>
  );
}
