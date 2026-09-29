import { useEffect, useState } from "react";
import { Clock3, Loader2, Power, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useMaintenanceMode } from "@/hooks/useMaintenanceMode";
import { siteMaintenanceTable } from "@/lib/maintenanceTable";

function remainingLabel(seconds: number) {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.ceil((seconds % 3_600) / 60);
  return hours ? `${hours}h ${minutes}min` : `${minutes} minuto${minutes === 1 ? "" : "s"}`;
}

export default function MaintenanceTab() {
  const { user } = useAuth();
  const maintenance = useMaintenanceMode();
  const [minutes, setMinutes] = useState("30");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (maintenance.active && maintenance.endsAt) {
      const remainingMinutes = Math.ceil((new Date(maintenance.endsAt).getTime() - Date.now()) / 60_000);
      setMinutes(String(Math.max(1, remainingMinutes)));
    }
  }, [maintenance.active, maintenance.endsAt]);

  const activate = async () => {
    const duration = Number(minutes);
    if (!Number.isInteger(duration) || duration < 1 || duration > 10_080) {
      toast.error("Informe um tempo entre 1 e 10.080 minutos.");
      return;
    }
    setSaving(true);
    const { error } = await siteMaintenanceTable()
      .update({
        enabled: true,
        ends_at: new Date(Date.now() + duration * 60_000).toISOString(),
        updated_by: user?.id ?? null,
      })
      .eq("id", true);

    setSaving(false);
    if (error) return toast.error(`Não foi possível ativar: ${error.message}`);
    await maintenance.reload();
    toast.success(`Site bloqueado por ${duration} minuto${duration === 1 ? "" : "s"}.`);
  };

  const disable = async () => {
    setSaving(true);
    const { error } = await siteMaintenanceTable()
      .update({ enabled: false, ends_at: null, updated_by: user?.id ?? null })
      .eq("id", true);

    setSaving(false);
    if (error) return toast.error(`Não foi possível liberar o site: ${error.message}`);
    await maintenance.reload();
    toast.success("Site liberado para todos.");
  };

  if (maintenance.loading) return <Loader2 className="h-6 w-6 animate-spin text-primary" />;

  if (maintenance.error) {
    return (
      <Card className="max-w-2xl border-red-200 bg-red-50 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-900">
            <TriangleAlert className="h-5 w-5" />
            Configuração do banco pendente
          </CardTitle>
          <CardDescription className="text-red-800/75">
            O painel continua disponível, mas o modo de manutenção só poderá ser usado depois que a migração do banco for aplicada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => maintenance.reload()} className="border-red-300 bg-white">
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid max-w-4xl gap-6 lg:grid-cols-[1.2fr_0.8fr]">
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-foreground"><Power className="h-5 w-5" /> Controle de acesso</CardTitle>
          <CardDescription>Bloqueie toda a loja temporariamente. Administradores continuam com acesso normal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="maintenance-minutes">Tempo de manutenção (minutos)</Label>
            <Input
              id="maintenance-minutes"
              type="number"
              min={1}
              max={10080}
              step={1}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">Mínimo de 1 minuto e máximo de 7 dias.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button onClick={activate} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <TriangleAlert className="h-4 w-4" />}
              {maintenance.active ? "Atualizar tempo" : "Ativar manutenção"}
            </Button>
            {maintenance.active && (
              <Button onClick={disable} disabled={saving} variant="outline">Encerrar agora</Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className={maintenance.active ? "border-amber-300 bg-amber-50 shadow-sm" : "border-emerald-200 bg-emerald-50 shadow-sm"}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {maintenance.active ? <Clock3 className="h-5 w-5 text-amber-700" /> : <ShieldCheck className="h-5 w-5 text-emerald-700" />}
            {maintenance.active ? "Manutenção ativa" : "Site liberado"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {maintenance.active
              ? `Visitantes estão bloqueados. Liberação automática em ${remainingLabel(maintenance.remainingSeconds)}.`
              : "Todos os visitantes podem acessar a loja normalmente."}
          </p>
          {maintenance.active && maintenance.endsAt && (
            <p className="mt-3 text-xs font-medium text-amber-800">
              Término previsto: {new Date(maintenance.endsAt).toLocaleString("pt-BR")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
