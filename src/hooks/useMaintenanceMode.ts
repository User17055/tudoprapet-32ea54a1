import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface MaintenanceStatus {
  enabled: boolean;
  endsAt: string | null;
}

const INACTIVE: MaintenanceStatus = { enabled: false, endsAt: null };

export function useMaintenanceMode() {
  const [status, setStatus] = useState<MaintenanceStatus>(INACTIVE);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, error: queryError } = await supabase
        .from("site_maintenance")
        .select("enabled, ends_at")
        .eq("id", true)
        .maybeSingle();

      // Em uma indisponibilidade do banco, a loja permanece aberta (fail-open).
      if (queryError) {
        setStatus(INACTIVE);
        setError(queryError.message);
      } else {
        setError(null);
        setStatus(data ? { enabled: data.enabled, endsAt: data.ends_at } : INACTIVE);
      }
    } catch (loadError) {
      setStatus(INACTIVE);
      setError(loadError instanceof Error ? loadError.message : "Falha ao consultar o modo de manutenção.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    const refresh = window.setInterval(load, 30_000);
    const channel = supabase
      .channel("site-maintenance-status")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "site_maintenance" },
        () => load(),
      )
      .subscribe();

    return () => {
      window.clearInterval(clock);
      window.clearInterval(refresh);
      supabase.removeChannel(channel);
    };
  }, [load]);

  const endTime = status.endsAt ? new Date(status.endsAt).getTime() : 0;
  const active = status.enabled && Number.isFinite(endTime) && endTime > now;
  const remainingSeconds = active ? Math.max(0, Math.ceil((endTime - now) / 1_000)) : 0;

  return { ...status, active, remainingSeconds, loading, error, reload: load };
}
