-- Pedidos de franquia nascem na TudoPraPet, mas o pedido de venda e o contas a
-- receber ficam na Olist. Os identificadores separados permitem retomar uma
-- falha parcial sem criar outro pedido ou outra cobrança.

alter table public.checkout_sessions
  add column if not exists olist_order_id text,
  add column if not exists olist_order_number text,
  add column if not exists olist_receivable_id text,
  add column if not exists olist_invoice_id text,
  add column if not exists olist_invoice_number text;

create unique index if not exists checkout_sessions_olist_order_id_uidx
  on public.checkout_sessions (olist_order_id)
  where olist_order_id is not null;

create unique index if not exists checkout_sessions_olist_receivable_id_uidx
  on public.checkout_sessions (olist_receivable_id)
  where olist_receivable_id is not null;

comment on column public.checkout_sessions.olist_order_id is
  'Identificador do pedido de venda da franquia no ERP Olist.';
comment on column public.checkout_sessions.olist_receivable_id is
  'Identificador da conta a receber em aberto na Olist.';
comment on column public.checkout_sessions.olist_invoice_id is
  'Identificador da NF-e gerada e emitida pela Olist.';

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net;

create or replace function public.invoke_olist_franchise_reconciliation()
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
      select decrypted_secret into v_service_role
        from vault.decrypted_secrets
       where name in ('service_role_key', 'supabase_service_role_key')
       order by case when name = 'service_role_key' then 0 else 1 end
       limit 1;
    exception when undefined_table or invalid_schema_name or insufficient_privilege then
      v_service_role := null;
    end;
  end if;
  if v_service_role is null then
    raise warning 'Conciliacao Olist nao executada: service_role_key ausente';
    return;
  end if;
  perform net.http_post(
    url := 'https://smvtnflhkvxdmvqbxwrf.supabase.co/functions/v1/olist-reconcile-franchise',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_role),
    body := jsonb_build_object('source', 'pg_cron', 'requested_at', now())
  );
end;
$$;

revoke all on function public.invoke_olist_franchise_reconciliation() from public, anon, authenticated;
grant execute on function public.invoke_olist_franchise_reconciliation() to service_role;

do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'reconcile-olist-franchise-receivables';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
  perform cron.schedule(
    'reconcile-olist-franchise-receivables',
    '*/10 * * * *',
    'select public.invoke_olist_franchise_reconciliation();'
  );
end;
$$;
