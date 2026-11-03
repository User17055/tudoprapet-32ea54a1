-- A conciliacao Olist passa a ser chamada pelo worker Asaas, que usa a
-- SUPABASE_SERVICE_ROLE_KEY atual do ambiente. Isso remove a copia da chave no
-- Vault que ficou desatualizada e fazia o cron direto receber HTTP 401.
-- O worker `reconcile-paid-shopify-orders` ja roda a cada 10 minutos.

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
    from cron.job
   where jobname = 'reconcile-olist-franchise-receivables';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end;
$$;

drop function if exists public.invoke_olist_franchise_reconciliation();
