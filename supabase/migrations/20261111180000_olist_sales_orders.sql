-- Vendas lançadas direto na Olist (pedido de venda interno/presencial) passam a
-- existir na TPP. Os pedidos do site continuam em checkout_sessions; aqui ficam
-- só os pedidos sem número de e-commerce. Toda venda precisa de NF-e e, quando
-- é de franquia, da conta a receber com boleto na Olist.

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  olist_order_id text not null unique,
  olist_order_number text,
  user_id uuid references auth.users(id) on delete set null,
  customer_type text not null default 'unknown'
    check (customer_type in ('franchise', 'common', 'unknown')),
  customer_name text,
  customer_cpf_cnpj text,
  situation text,
  order_date date,
  total numeric(12, 2),
  items jsonb not null default '[]'::jsonb,
  tracking_code text,
  invoice_id text,
  invoice_number text,
  invoice_url text,
  invoice_status text
    check (invoice_status is null or invoice_status in ('generating', 'issued', 'pending', 'rejected')),
  invoice_error text,
  invoice_checked_at timestamptz,
  receivable_id text,
  receivable_status text,
  receivable_due_date text,
  receivable_amount numeric(12, 2),
  boleto_url text,
  receivable_error text,
  -- Automação (boleto + NF-e) só para pedidos aprovados a partir da data de
  -- corte. Pedidos antigos aparecem no painel, mas não são faturados sozinhos.
  automation_eligible boolean not null default false,
  needs_refresh boolean not null default true,
  refreshed_at timestamptz,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  processing_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sales_orders is
  'Pedidos de venda lançados direto na Olist (sem número de e-commerce), espelhados na TPP com NF-e e boleto.';

create index if not exists sales_orders_user_idx
  on public.sales_orders (user_id, order_date desc);
-- Fila de trabalho: pedido novo/alterado (needs_refresh) ou com retentativa
-- agendada (NF-e pendente, boleto aguardando pagamento, erro com backoff).
create index if not exists sales_orders_work_idx
  on public.sales_orders (next_attempt_at nulls first)
  where needs_refresh or next_attempt_at is not null;

alter table public.sales_orders enable row level security;

drop policy if exists "Users read own sales orders" on public.sales_orders;
create policy "Users read own sales orders" on public.sales_orders
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Admins read all sales orders" on public.sales_orders;
create policy "Admins read all sales orders" on public.sales_orders
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- Avisos recebidos da Olist. Gravados antes de processar, para responder 200
-- rápido e para a conciliação reprocessar o que tiver falhado.
create table if not exists public.olist_webhook_events (
  id bigint generated always as identity primary key,
  event text not null,
  dedupe_key text not null unique,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text
);

create index if not exists olist_webhook_events_pending_idx
  on public.olist_webhook_events (received_at)
  where processed_at is null;

alter table public.olist_webhook_events enable row level security;

create table if not exists public.olist_sync_state (
  key text primary key,
  value timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.olist_sync_state enable row level security;

-- Um pedido por vez: webhook e conciliação podem chegar juntos. A trava vence
-- sozinha em 10 minutos se o processo cair.
create or replace function public.claim_sales_order(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  update public.sales_orders
     set processing_until = now() + interval '10 minutes'
   where id = p_id
     and (processing_until is null or processing_until < now());
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.claim_sales_order(uuid) from public, anon, authenticated;
grant execute on function public.claim_sales_order(uuid) to service_role;

-- Painel: inclui as vendas internas aprovadas (elegíveis à automação) sem NF-e
-- e as de franquia sem boleto.
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
           s.olist_invoice_status, s.olist_invoice_error,
           s.olist_payment_synced_at, s.olist_payment_sync_error,
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
  internal as (
    select o.id, o.created_at, o.customer_type, o.total, 'BRL'::text as currency,
           o.olist_order_number, coalesce(o.customer_name, '') as customer_name,
           o.invoice_status, o.invoice_error, o.receivable_id, o.receivable_error
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
           ) as reason
      from sales
     where coalesce(olist_invoice_status, '') <> 'issued'
    union all
    select id, created_at, customer_type, total, currency, olist_order_number,
           customer_name, 'settlement'::text, 'site'::text,
           olist_invoice_status,
           coalesce(olist_payment_sync_error, 'Baixa ainda não confirmada na Olist')
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
           )
      from internal
     where coalesce(invoice_status, '') <> 'issued'
    union all
    select id, created_at, customer_type, total, currency, olist_order_number,
           customer_name, 'receivable'::text, 'olist'::text,
           invoice_status,
           coalesce(receivable_error, 'Conta a receber/boleto ainda não criado')
      from internal
     where customer_type = 'franchise' and receivable_id is null
  )
  select jsonb_build_object(
    'since', p_since,
    'without_invoice', (select count(*) from issues where issue = 'invoice'),
    'unsettled_paid', (select count(*) from issues where issue = 'settlement'),
    'without_receivable', (select count(*) from issues where issue = 'receivable'),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.created_at)
        from (select * from issues order by created_at limit 100) i
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_sales_fiscal_health(timestamptz, integer)
  from public, anon;
grant execute on function public.admin_sales_fiscal_health(timestamptz, integer)
  to authenticated;
