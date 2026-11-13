-- 1) Limite de chamadas à API da Olist compartilhado por todas as functions.
--    Cada function tinha seu próprio intervalo (400 ms), então juntas passavam
--    do limite do plano e a Olist respondia "API Bloqueada". Agora cada chamada
--    pede uma vaga aqui; as automações usam só parte do limite e o restante
--    fica reservado para o checkout.
-- 2) Registro da última execução de cada automação (painel do admin).

alter table public.olist_sync_state
  add column if not exists details jsonb;

create table if not exists public.olist_api_rate (
  id boolean primary key default true check (id),
  window_start timestamptz not null default now(),
  calls integer not null default 0,
  blocked_until timestamptz,
  last_blocked_at timestamptz,
  stats_day date not null default current_date,
  calls_today integer not null default 0,
  blocks_today integer not null default 0,
  throttled_today integer not null default 0
);

insert into public.olist_api_rate (id) values (true) on conflict (id) do nothing;

alter table public.olist_api_rate enable row level security;
grant all on table public.olist_api_rate to service_role;

-- Janela fixa de 60 s. Devolve 0 quando a chamada pode seguir, ou quantos
-- milissegundos esperar (janela cheia ou Olist bloqueada).
create or replace function public.claim_olist_api_call(p_limit integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.olist_api_rate;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_row from public.olist_api_rate where id for update;
  if not found then
    insert into public.olist_api_rate (id, window_start, calls, calls_today)
    values (true, v_now, 1, 1) on conflict (id) do nothing;
    return 0;
  end if;

  if v_row.stats_day <> (v_now at time zone 'America/Sao_Paulo')::date then
    update public.olist_api_rate
       set stats_day = (v_now at time zone 'America/Sao_Paulo')::date,
           calls_today = 0, blocks_today = 0, throttled_today = 0
     where id;
  end if;

  if v_row.blocked_until is not null and v_row.blocked_until > v_now then
    update public.olist_api_rate set throttled_today = throttled_today + 1 where id;
    return ceil(extract(epoch from (v_row.blocked_until - v_now)) * 1000)::integer;
  end if;

  if v_now - v_row.window_start >= interval '60 seconds' then
    update public.olist_api_rate
       set window_start = v_now, calls = 1, calls_today = calls_today + 1
     where id;
    return 0;
  end if;

  if v_row.calls < greatest(p_limit, 1) then
    update public.olist_api_rate
       set calls = calls + 1, calls_today = calls_today + 1
     where id;
    return 0;
  end if;

  update public.olist_api_rate set throttled_today = throttled_today + 1 where id;
  return ceil(extract(epoch from (v_row.window_start + interval '60 seconds' - v_now)) * 1000)::integer;
end;
$$;

-- A Olist respondeu "API Bloqueada": todas as functions param pelo tempo dado.
create or replace function public.report_olist_api_block(p_seconds integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.olist_api_rate
     set blocked_until = greatest(coalesce(blocked_until, now()), now() + make_interval(secs => greatest(p_seconds, 1))),
         last_blocked_at = now(),
         blocks_today = blocks_today + 1
   where id;
end;
$$;

revoke all on function public.claim_olist_api_call(integer) from public, anon, authenticated;
revoke all on function public.report_olist_api_block(integer) from public, anon, authenticated;
grant execute on function public.claim_olist_api_call(integer) to service_role;
grant execute on function public.report_olist_api_block(integer) to service_role;

-- Painel do admin: situação de cada automação.
create or replace function public.admin_automation_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Acesso restrito a administradores' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'now', now(),
    'reconcile', (
      select jsonb_build_object('last_run', value, 'details', details)
        from public.olist_sync_state where key = 'reconcile_run'
    ),
    'sales_sync', jsonb_build_object(
      'last_run', (select value from public.olist_sync_state where key = 'sales_sync_run'),
      'details', (select details from public.olist_sync_state where key = 'sales_sync_run'),
      'last_scan', (select value from public.olist_sync_state where key = 'orders_scan'),
      'orders', (select count(*) from public.sales_orders),
      'queue', (select count(*) from public.sales_orders
                 where needs_refresh or next_attempt_at <= now()),
      'waiting', (select count(*) from public.sales_orders
                   where not needs_refresh and next_attempt_at > now()),
      'with_errors', (select count(*) from public.sales_orders where attempts > 0),
      'franchise', (select count(*) from public.sales_orders where customer_type = 'franchise'),
      'automated', (select count(*) from public.sales_orders where automation_eligible),
      'automated_issued', (select count(*) from public.sales_orders
                            where automation_eligible and invoice_status = 'issued')
    ),
    'webhooks', jsonb_build_object(
      'total', (select count(*) from public.olist_webhook_events),
      'last_received', (select max(received_at) from public.olist_webhook_events),
      'pending', (select count(*) from public.olist_webhook_events where processed_at is null),
      'failed', (select count(*) from public.olist_webhook_events
                  where processed_at is null and attempts > 0)
    ),
    'olist_api', (
      select jsonb_build_object(
        'calls_today', calls_today,
        'blocks_today', blocks_today,
        'throttled_today', throttled_today,
        'last_blocked_at', last_blocked_at,
        'blocked_until', blocked_until
      ) from public.olist_api_rate where id
    ),
    'price_reviews', jsonb_build_object(
      'open', (select count(*) from public.franchise_price_reviews where status in ('blocked', 'requested')),
      'requested', (select count(*) from public.franchise_price_reviews where status = 'requested')
    )
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.admin_automation_status() from public, anon;
grant execute on function public.admin_automation_status() to authenticated;
