-- Executa a conciliacao continuamente para que uma confirmacao financeira nao
-- dependa de um unico webhook/disparo em background para virar pedido Shopify.
-- A service role nao e gravada no repositorio: e lida da configuracao do projeto
-- ou do Supabase Vault.

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
