-- Franquia com pedido na Olist e sem cobrança não fica mais esquecida.
-- O checkout de franquia caía depois de concluir a Shopify e criar o pedido
-- (a automação da Olist gerava a nota antes do "lançar contas") e a sessão
-- voltava para "aguardando pagamento": nenhuma rotina tentava de novo e a
-- Revisão Olist não mostrava. A conciliação agora lança a cobrança dessas
-- sessões e aponta o pedido duplicado pela importação da Shopify.

alter table public.checkout_sessions
  add column if not exists olist_receivable_error text,
  add column if not exists olist_receivable_checked_at timestamptz,
  add column if not exists olist_twin_checks integer not null default 0,
  add column if not exists olist_twin_checked_at timestamptz,
  add column if not exists olist_twin_status text,
  add column if not exists olist_twin_order_numbers text;

alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_olist_twin_status_check;
alter table public.checkout_sessions
  add constraint checkout_sessions_olist_twin_status_check
  check (olist_twin_status is null or olist_twin_status in ('found', 'cancelled', 'resolved'));

create index if not exists checkout_sessions_franchise_receivable_retry_idx
  on public.checkout_sessions (olist_receivable_checked_at)
  where customer_type = 'franchise' and olist_order_id is not null and olist_receivable_id is null;

create or replace function public.admin_sales_fiscal_health(
  p_since timestamptz default '2026-10-07T00:00:00-03:00',
  p_grace_minutes integer default 30
)
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

  with sales as (
    select s.id, s.created_at, s.customer_type, s.total, s.currency,
           s.olist_order_id, s.olist_order_number,
           s.olist_invoice_status, s.olist_invoice_error, s.olist_invoice_checked_at,
           s.olist_payment_synced_at, s.olist_payment_sync_error,
           s.olist_payment_sync_next_attempt_at,
           coalesce(s.customer_snapshot->>'name', '') as customer_name
      from public.checkout_sessions s
     where s.created_at >= p_since
       and s.created_at < now() - make_interval(mins => greatest(p_grace_minutes, 0))
       and (
         (s.customer_type = 'franchise' and s.status = 'credit_approved')
         or (
           s.customer_type in ('common', 'subscriber')
           and s.status = 'shopify_created'
           and exists (
             select 1 from public.payments p
              where p.checkout_session_id = s.id
                and p.provider = 'asaas'
                and p.status in ('confirmed', 'received')
           )
         )
       )
  ),
  -- Pedido criado e cobrança não lançada: o checkout caiu no meio.
  franchise_pending as (
    select s.id, s.created_at, s.customer_type, s.total, s.currency,
           s.olist_order_number, s.olist_invoice_status,
           s.olist_receivable_error, s.olist_receivable_checked_at,
           coalesce(s.customer_snapshot->>'name', '') as customer_name
      from public.checkout_sessions s
     where s.created_at >= p_since
       and s.created_at < now() - make_interval(mins => greatest(p_grace_minutes, 0))
       and s.customer_type = 'franchise'
       and s.status in ('awaiting_payment', 'payment_processing')
       and s.olist_order_id is not null
       and s.olist_receivable_id is null
  ),
  -- Cópia criada pela importação da Shopify e ainda não cancelada.
  franchise_twins as (
    select s.id, s.created_at, s.customer_type, s.total, s.currency,
           s.olist_order_number, s.olist_invoice_status, s.olist_twin_order_numbers,
           coalesce(s.customer_snapshot->>'name', '') as customer_name
      from public.checkout_sessions s
     where s.created_at >= p_since
       and s.customer_type = 'franchise'
       and s.olist_twin_status = 'found'
  ),
  internal as (
    select o.id, o.created_at, o.customer_type, o.total, 'BRL'::text as currency,
           o.olist_order_number, coalesce(o.customer_name, '') as customer_name,
           o.invoice_status, o.invoice_error, o.receivable_id, o.receivable_error,
           o.next_attempt_at
      from public.sales_orders o
     where o.automation_eligible
       and o.created_at < now() - make_interval(mins => greatest(p_grace_minutes, 0))
  ),
  issues as (
    select id, created_at, customer_type, total, currency, olist_order_number,
           customer_name, 'invoice'::text as issue, 'site'::text as origin,
           olist_invoice_status as invoice_status,
           coalesce(
             olist_invoice_error,
             case
               when olist_order_id is null then coalesce(olist_payment_sync_error, 'Pedido ainda não está na Olist')
               when olist_invoice_status = 'pending' then 'Aguardando autorização da SEFAZ'
               when olist_invoice_status = 'generating' then 'Emissão em andamento'
               else 'Emissão ainda não tentada'
             end
           ) as reason,
           (olist_invoice_status = 'rejected'
             or (olist_order_id is null and public.olist_issue_needs_action(olist_payment_sync_error))) as needs_action,
           case
             when olist_invoice_status = 'rejected' then olist_invoice_checked_at + interval '24 hours'
             when olist_order_id is null then olist_payment_sync_next_attempt_at
             else null
           end as next_retry_at
      from sales
     where coalesce(olist_invoice_status, '') <> 'issued'
    union all
    select id, created_at, customer_type, total, currency, olist_order_number,
           customer_name, 'settlement'::text, 'site'::text,
           olist_invoice_status,
           coalesce(olist_payment_sync_error, 'Baixa ainda não confirmada na Olist'),
           public.olist_issue_needs_action(olist_payment_sync_error),
           olist_payment_sync_next_attempt_at
      from sales
     where customer_type in ('common', 'subscriber')
       and olist_payment_synced_at is null
    union all
    select id, created_at, customer_type, total, currency, olist_order_number,
           customer_name, 'invoice'::text, 'olist'::text,
           invoice_status,
           coalesce(
             invoice_error,
             case
               when invoice_status = 'pending' then 'Aguardando autorização da SEFAZ'
               when invoice_status = 'generating' then 'Emissão em andamento'
               else 'Emissão ainda não tentada'
             end
           ),
           (invoice_status = 'rejected' or public.olist_issue_needs_action(invoice_error)),
           next_attempt_at
      from internal
     where coalesce(invoice_status, '') <> 'issued'
    union all
    select id, created_at, customer_type, total, currency, olist_order_number,
           customer_name, 'receivable'::text, 'olist'::text,
           invoice_status,
           coalesce(receivable_error, 'Conta a receber/boleto ainda não criado'),
           public.olist_issue_needs_action(receivable_error),
           next_attempt_at
      from internal
     where customer_type = 'franchise' and receivable_id is null
    union all
    select id, created_at, customer_type, total, currency, olist_order_number,
           customer_name, 'receivable'::text, 'site'::text,
           olist_invoice_status,
           coalesce(olist_receivable_error, 'Pedido criado na Olist; cobrança/boleto ainda não lançado'),
           public.olist_issue_needs_action(olist_receivable_error),
           case
             when public.olist_issue_needs_action(olist_receivable_error)
               then olist_receivable_checked_at + interval '24 hours'
             else null
           end
      from franchise_pending
    union all
    select id, created_at, customer_type, total, currency, olist_order_number,
           customer_name, 'duplicate'::text, 'site'::text,
           olist_invoice_status,
           'Pedido duplicado pela importação da Shopify: cancelar na Olist o pedido ' ||
             coalesce(olist_twin_order_numbers, '?') || ' (em aberto, sem nota e sem conta)',
           true,
           null::timestamptz
      from franchise_twins
  )
  select jsonb_build_object(
    'since', p_since,
    'without_invoice', (select count(*) from issues where issue = 'invoice'),
    'unsettled_paid', (select count(*) from issues where issue = 'settlement'),
    'without_receivable', (select count(*) from issues where issue = 'receivable'),
    'duplicates', (select count(*) from issues where issue = 'duplicate'),
    'needs_action', (select count(*) from issues where needs_action),
    'waiting', (select count(*) from issues where not needs_action),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.needs_action desc, i.created_at)
        from (select * from issues order by needs_action desc, created_at limit 100) i
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_sales_fiscal_health(timestamptz, integer)
  from public, anon;
grant execute on function public.admin_sales_fiscal_health(timestamptz, integer)
  to authenticated;

-- "Já corrigi, tentar agora": antecipa a próxima tentativa (até 10 min).
create or replace function public.admin_retry_olist_issue(
  p_id uuid,
  p_issue text,
  p_origin text default 'site'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Acesso restrito a administradores' using errcode = '42501';
  end if;

  if p_origin = 'olist' then
    update public.sales_orders
       set needs_refresh = true, next_attempt_at = now(), updated_at = now()
     where id = p_id;
    return;
  end if;

  if p_issue = 'receivable' then
    update public.checkout_sessions
       set olist_receivable_checked_at = null
     where id = p_id and olist_receivable_id is null;
    return;
  end if;

  if p_issue = 'duplicate' then
    -- Volta a conferir na próxima rodada (some da lista quando a cópia foi cancelada).
    update public.checkout_sessions
       set olist_twin_checked_at = null
     where id = p_id;
    return;
  end if;

  if p_issue = 'settlement' or p_issue = 'invoice' then
    -- Sem pedido na Olist, a nota depende da baixa/importação: antecipa as duas.
    update public.checkout_sessions
       set olist_payment_sync_next_attempt_at = case
             when olist_payment_synced_at is null then now()
             else olist_payment_sync_next_attempt_at
           end,
           olist_invoice_checked_at = case
             when olist_invoice_status = 'rejected' then now() - interval '25 hours'
             else olist_invoice_checked_at
           end
     where id = p_id;
  end if;
end;
$$;

revoke all on function public.admin_retry_olist_issue(uuid, text, text) from public, anon;
grant execute on function public.admin_retry_olist_issue(uuid, text, text) to authenticated;
