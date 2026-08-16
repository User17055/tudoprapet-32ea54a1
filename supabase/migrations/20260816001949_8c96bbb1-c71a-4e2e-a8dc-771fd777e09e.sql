CREATE TABLE public.site_maintenance (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled boolean NOT NULL DEFAULT false,
  ends_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT site_maintenance_enabled_requires_end
    CHECK (NOT enabled OR ends_at IS NOT NULL)
);

GRANT SELECT ON public.site_maintenance TO anon, authenticated;
GRANT UPDATE ON public.site_maintenance TO authenticated;
GRANT ALL ON public.site_maintenance TO service_role;

ALTER TABLE public.site_maintenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view site maintenance"
  ON public.site_maintenance FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admins can update site maintenance"
  ON public.site_maintenance FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.site_maintenance (id, enabled) VALUES (true, false);

CREATE TRIGGER update_site_maintenance_updated_at
  BEFORE UPDATE ON public.site_maintenance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.site_maintenance;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

create or replace function public.invoke_payment_reconciliation()
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_service_role text;
begin
  v_service_role := nullif(current_setting('app.settings.service_role_key', true), '');

  if v_service_role is null then
    begin
      select decrypted_secret
        into v_service_role
        from vault.decrypted_secrets
       where name in ('service_role_key', 'supabase_service_role_key')
       order by case when name = 'service_role_key' then 0 else 1 end
       limit 1;
    exception when undefined_table or invalid_schema_name or insufficient_privilege then
      v_service_role := null;
    end;
  end if;

  if v_service_role is null then
    raise warning 'Conciliacao nao executada: service_role_key ausente no Vault';
    return;
  end if;

  perform net.http_post(
    url := 'https://smvtnflhkvxdmvqbxwrf.supabase.co/functions/v1/asaas-process-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_role
    ),
    body := jsonb_build_object('source', 'pg_cron', 'requested_at', now())
  );
end;
$$;

revoke all on function public.invoke_payment_reconciliation() from public, anon, authenticated;
grant execute on function public.invoke_payment_reconciliation() to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
    from cron.job
   where jobname = 'reconcile-paid-shopify-orders';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'reconcile-paid-shopify-orders',
    '* * * * *',
    'select public.invoke_payment_reconciliation();'
  );
end;
$$;