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

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("site_maintenance")
      .select("enabled, ends_at")
      .eq("id", true)
      .maybeSingle();

    // Em uma indisponibilidade do banco, a loja permanece aberta (fail-open).
    if (!error && data) {
      setStatus({ enabled: data.enabled, endsAt: data.ends_at });
    }
    setLoading(false);
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

  return { ...status, active, remainingSeconds, loading, reload: load };
}
