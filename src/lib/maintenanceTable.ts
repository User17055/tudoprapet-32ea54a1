import { supabase } from "@/integrations/supabase/client";

export interface SiteMaintenanceRow {
  enabled: boolean;
  ends_at: string | null;
}

interface MaintenanceQuery {
  select: (columns: string) => {
    eq: (column: string, value: boolean) => { maybeSingle: () => Promise<{ data: SiteMaintenanceRow | null; error: { message: string } | null }> };
  };
  update: (values: Record<string, unknown>) => {
    eq: (column: string, value: boolean) => Promise<{ error: { message: string } | null }>;
  };
}

// A tabela site_maintenance ainda nao aparece nos tipos gerados do backend,
// por isso acessamos com um contrato minimo e explicito.
export const siteMaintenanceTable = () =>
  (supabase as unknown as { from: (table: string) => MaintenanceQuery }).from("site_maintenance");
